# 39 — Release Roadmap v2 & Architecture Review

> **⚠️ Release map superseded by `54`.** The release-tag authority is now `54`
> (release strategy), which maps the re-sequenced **execution phases EP-1…EP-11** (`41`) to
> tags. The §1 release table below is the *provisional, architecture-era* map (ordered to
> `37`'s phases, which built the LLM before voice); `54` reorders it (voice at v0.4, chat at
> v0.5) to match the execution build order. **Use `54` for release sequencing.** The
> **Architecture Review in §4 of this doc remains fully valid** and is not superseded.

> Maps the development phases (`37`) to shippable releases, states the privacy/consent
> posture and go/no-go gate for each, and closes with the **Architecture Review** the brief
> requires: does the v2 design (docs `31`–`36`) actually scale for everything the product
> wants to become?

---

## 1. Release map (phases → versions)

| Release | Phases (`37`) | Theme | Ships |
| --- | --- | --- | --- |
| **v0.1** | (pre-v2) | Finish the offline MVP | Signing, fresh-VM QA, first public GitHub release |
| **v0.2** | P1 + carry-overs from `24` | Conversation shell (offline) + trust repayments | Message UI, provider seam, auto-update, monthly recurrence, code signing |
| **v0.3** | P2 | OpenAI conversation | BYO-key chat/question/intent, key mgmt, consent, network gating |
| **v0.4** | P3 + P4 | Cloud voice | OpenAI STT (batch) + OpenAI TTS + voice picker/preview |
| **v0.5** | P5 | Voice confirmation + full dispatcher | Say-"yes", generalised action pipeline |
| **v0.6** | P6 | Memory foundation | "What do you remember" + confirmed memory save/recall (FTS5) |
| **v0.7** | P7 | Research foundation | Weather (Open-Meteo) first; the `ResearchProvider` seam |
| **v0.8** | — | Local LLM | `OllamaLlmProvider` — cloud-quality conversation, zero egress (`24`'s v0.4 vision) |
| **v1.0** | — | Earned | Stability + trust proven over real use (`24`'s v1.0 vision) |

`MVP DECISION` — This **reorders the brief's phase list** (which put OpenAI Speech/TTS
before "Reminder Conversation"). Reason: ship the **offline conversation shell first** (P1,
v0.2) so the app is releasable and better *before* any cloud risk; then add cloud in isolated,
independently-verifiable increments (LLM → STT → TTS), each behind its own consent and each
degrading to the offline path. Voice confirmation (P5) comes **after** the dispatcher is
generalised, because "say yes" only makes sense once proposals flow through one gate (`36`).
The reasoning is expanded in `37`.

`MVP DECISION` — **This map is the single authority for v2 release versions.** It
**resequences** `24`'s roadmap rather than matching its numbers: the conversation pivot
legitimately consumes v0.2–v0.5, which pushes memory, research, and Ollama *later* than the
pre-pivot estimates in `24` (which slotted them at its own v0.3 / v0.5 / v0.4). So `24`'s
"v0.3 memory", "v0.4 Ollama", "v0.5 research" are **feature-tier visions**, not release
numbers — the same features ship at the releases in the table above. Where docs `24`, `31`,
`33`, `36`, `37`, and `38` write "v0.3"/"v0.4"/"v0.5" they mean `24`'s feature tier; the
release version is whatever this table assigns. Doc `37`'s **phase numbers (P1–P7)** own the
sequencing; this doc owns the version labels.

---

## 2. Per-release posture & go/no-go gate

| Release | Privacy/consent posture | Go/no-go gate (all must pass) |
| --- | --- | --- |
| **v0.1** | Fully offline; no network path active | Fresh-VM install, no UAC; Wireshark zero packets; **signed** installer; core loop passes; README/PRIVACY/checksums |
| **v0.2** | Still offline by default; conversation shell runs on the **local parser** — no cloud yet | 96+ tests green incl. new component tests; Wireshark **still** zero packets; confirmation gate intact; auto-update feed produced and consumed |
| **v0.3** | Cloud **chat** opt-in, keyed, consented; off by default | `settings:get` leaks no key; Wireshark clean with cloud off / OpenAI-only with cloud on; `AssistantTurn` gates green; degrade-to-offline verified |
| **v0.4** | Cloud **STT/TTS** each separately consented; the "your voice is sent" disclosure shown | audio never on disk; `audio:playBytes` bytes-not-path; fallback to Windows voice; zero-voices degrade |
| **v0.5** | Same; voice-confirm matched locally | pending-proposal invariant; voice-yes not model-interpreted; timeout=cancel |
| **v0.6** | Memory confirmed-only; sensitive never sent; manage/delete screen ships first | memory gate = reminder gate; sensitive-exclusion test green |
| **v0.7** | Each research provider individually consented + its own allowlist origin | per-provider consent; medical/legal disclaimers; Wireshark shows only enabled origins |

`MVP DECISION` — **Two gates are non-negotiable at every release:** (1) the **Wireshark
zero-packets-with-cloud-off** proof (`11` §14 SEC-10) — the moment a build phones home with
everything off, it is not shippable; and (2) the **confirmation gate intact** — nothing
data-modifying persists without a human/voice confirm (`36`, `24`).

---

## 3. Release mechanics (building on what exists)

The audit found a working but incomplete pipeline:

- **electron-builder** → NSIS + portable, `perMachine:false` (no admin), STT model as
  `extraResources`, native addon `asarUnpack`'d. **Keep as-is.**
- **Unsigned — the #1 ship gap (`30` §7 S6).** `RISK (high, ship-blocking)` — no Authenticode
  anywhere; SmartScreen "unknown publisher"; the auto-update feed is integrity-checked
  (sha512) but **not authenticity-checked**. `MVP DECISION` — add **Azure Trusted Signing**
  (~$120/yr, `24` v0.2) in v0.1/v0.2 via `CSC_*`/`signtoolOptions` in `release.yml`. This is
  the single highest-value release change.
- **GitHub release workflow** (`release.yml`): `npm ci` → typecheck → lint → test →
  `fetch:model` → `electron-builder --win --publish always` (draft release) → generate
  `SHA256SUMS.txt` → attach. **Keep**, and add the signing step + the E2E smoke gate (`38`
  §9) so a green pipeline implies "packages **and** launches."
- **Auto-update:** `latest.yml` + `.blockmap` are produced, but **`electron-updater` runtime
  code is NOT present** (`30` build audit). `RISK` — the feed exists with no consumer.
  `MVP DECISION` — wire `electron-updater` in v0.2 (check-on-launch, user-approved install,
  off-by-default background download to honour "nothing silent", `24`/`11` §13). Auto-update
  authenticity depends on signing (above) — do them together.
- **Model fetch:** `fetch:model` downloads the ~68 MB STT model with **no checksum** (`30`
  S7). `MVP DECISION` — pin a SHA-256 in `fetch-stt-model.mjs` before v0.1.
- **CI:** add the `jsdom` component project (`38` §1) and a build+smoke job (`38` §9).

---

## 4. Architecture Review (mandatory)

Does the v2 architecture — the Conversation Engine (`31`), provider interfaces (`33`), the
intent taxonomy (`31` §2), the Action Dispatcher (`36`), and the sliding-window context
(`31` §4.3) — scale for the brief's ambitions? Verdict per dimension, grounded in the actual
interfaces:

| Ambition | Verdict | Why (grounded in the design) |
| --- | --- | --- |
| **Long conversations** | ✅ Scales | Context is a bounded sliding window of `K` turns (`31` §4.3); persisted turns are read-only history, never replayed. Cost/latency stay flat regardless of total history. |
| **Multiple AI providers** | ✅ Scales | `LlmProvider` (`33` §4) is a clean seam with a factory + fallback decorator; providers are swaps, not rewrites. |
| **Local LLM (Ollama)** | ✅ Scales | `OllamaLlmProvider` behind the same interface, `isLocal:true`, no allowlist/consent needed — it *collapses* the consent apparatus (`24`'s v0.4 vision; release v0.8). The interface was designed for exactly this. |
| **OpenAI** | ✅ Scales | First-class (`32`); the whole gating/consent/network apparatus is built around it. |
| **Gemini / Claude** | ✅ Scales-with-work | Each is a new `LlmProvider` **plus** its own consented `connect-src` origin in `session.ts` and its own key slot. The seam is ready; each provider is a bounded, repeatable unit of work — not a redesign. |
| **Memory** | ✅ Scales | New intents (`memory_save`/`memory_query`), action schemas (`31` §3), a dispatcher branch (`36` §5), and the **already-existing** `memories` table (`10`). FTS5-first retrieval (`24`). The turn contract does not change. |
| **Research** | ✅ Scales-with-work | `ResearchProvider` interface (`24`'s v0.5 vision; release v0.7) + a `research` intent already carried in the taxonomy; each source is a new consented origin. Read-only, so no confirmation-gate tension. |
| **Calendar / Gmail / WhatsApp** | ⚠️ Does **not** scale without new infrastructure | These need **OAuth** (a token-storage + refresh model the app doesn't have — only `safeStorage` for a single API key today), **new consented origins** per service, and a **background-sync / webhook** model the current 30-s-poll, single-SQLite, offline-first architecture never contemplated. The *action* side fits the dispatcher (they are just more action intents), but the *connectivity + auth + sync* side is a genuine new subsystem. Plan it as such (`24` v1.0), not as "another provider." |
| **Autonomous agents** | ⛔ Conflicts by design | The product's identity **is** the confirmation gate (`24`, `36`): the LLM proposes, a human confirms, the app executes. An autonomous agent that acts without confirmation is a *different product* with a *different trust model*. The architecture deliberately does **not** scale to this, and should not be made to. If ever pursued, it is a separate, re-consented mode with its own threat model — never the default. |

### 4.1 Where the design would break first, honestly

1. **Integrations (Calendar/Gmail/WhatsApp)** are the real architectural frontier: OAuth
   token lifecycle, per-service consented origins, and background sync are all absent. The
   dispatcher and intent taxonomy absorb the *actions*; the *plumbing* is new work, and the
   "no server / offline-first" promise gets its hardest test here (some integrations imply a
   callback/redirect surface). Treat this as a v1.x subsystem with its own design doc.
2. **The audio-bytes TTS path** (`33` §3.1) is new and lightly proven; it is the one place a
   cloud feature touches the security-sensitive audio window. Keep its size cap and
   bytes-not-path rule inviolable as more voice providers arrive.
3. **Main-thread SQLite + STT decode** (`30` §6) are fine now but are the first performance
   ceilings once memory/FTS and cloud calls add per-turn work; a `utilityProcess` for STT and
   an async DB facade are the pre-planned escape hatches.

### 4.2 Verdict

**The v2 architecture scales cleanly for the AI-centric ambitions** (long conversations,
many LLM providers incl. local, memory, research) because they are all expressed as
*providers behind an interface* or *intents behind the dispatcher* — the two extension points
the design was built around. It **does not, and should not, scale to autonomous action**:
that conflicts with the confirmation gate that defines the product. **Third-party
integrations scale on the action side but require a genuinely new auth/sync subsystem** — the
one place a real redesign (not just a new class) is needed, and it is correctly deferred to
v1.x. No redesign of the core (`31`–`36`) is required to reach v0.7; the integration frontier
is where the next architecture doc will be written.
