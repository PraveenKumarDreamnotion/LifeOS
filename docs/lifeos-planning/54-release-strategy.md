# 54 — Release Strategy (authority for release tags)

> **What this is:** the **authority for release tags** for LifeOS v2. It maps the eleven
> execution phases (EP-1…EP-11, `41` §5) to version tags, states the go/no-go gate for each,
> and defines release mechanics and cadence.
>
> **This SUPERSEDES `39` §1's release map.** `39`'s table was the *provisional, architecture-era*
> map, ordered to `37`'s phases (which built the LLM before voice). `54` re-sequences it to the
> **execution build order** (voice at v0.4, chat at v0.5). Use `54` for release sequencing.
> `39` carries a top-of-file pointer to here.
>
> `MVP DECISION` — **This doc does not mint a third scheme.** The EP→tag map in §1 is taken
> **verbatim from `41` §7**, which is cited as the source. `41` §7 defines the map; `54` is its
> canonical, live home with the gates and mechanics attached. **One release scheme, defined once.**
>
> **Note (`39` §4 stays valid):** `39`'s **§4 Architecture Review** — the scalability verdict
> (long conversations, multiple providers, memory/research scale; autonomous agents conflict by
> design; third-party integrations need a new auth/sync subsystem) — is **not superseded** and
> remains the scalability authority. §6 restates this.

---

## 1. The EP → release-tag map (verbatim from `41` §7)

`RECOMMENDATION` — **Adopt these tags explicitly.** They are the canonical map; `39`'s table is
provisional and superseded.

| Tag | EP(s) | Theme | Network posture |
| --- | --- | --- | --- |
| **v0.1** | EP-0 | Ship the offline MVP (signed, QA'd, published) | zero |
| **v0.2** | EP-1 (+ trust repayments: auto-update, monthly recurrence) | Internal seams + debt paid; still offline | zero |
| **v0.3** | EP-2 | Conversation shell; reminders unchanged; offline | zero |
| **v0.4** | EP-3 + EP-4 | Cloud **voice** (STT in, natural voice out), opt-in | openai only when voice enabled |
| **v0.5** | EP-5 | Cloud **conversation** (chat / Q&A), opt-in | openai only when chat enabled |
| **v0.6** | EP-6 + EP-7 | Structured actions + Reminder v2 (voice confirm, edit, delete) | as v0.5 |
| **v0.7** | EP-8 | Settings UX redesign (providers, voice picker, consent) | as v0.5 |
| **v0.8** | EP-9 | Memory foundation | memory never sent; sensitive excluded |
| **v0.9** | EP-10 | Research foundation (Weather first) | per-provider consented origin |
| **v1.0** | EP-11 | Polish, performance, a11y → **stable LifeOS** | unchanged |

`FUTURE OPTION` — **Ollama** (local LLM, `24`/`33` §4) lands **post-1.0 (v1.x)** behind the
existing `LlmProvider` seam — it needs a separate ~2 GB install and is not on the critical path
(`41` §7). This replaces `39`'s old "v0.8 = Ollama"; the conversation pivot consumes v0.2–v0.9,
pushing Ollama past 1.0.

**Sequencing note (`41` §1, §9):** voice (v0.4) ships **before** chat (v0.5) deliberately — STT/TTS
are self-contained, LLM-independent, lower-risk, and keep every early release a strictly-better
version of the working app. The honest consequence: the conversation *shell* ships in v0.3 but
cannot hold a real conversation until v0.5, so v0.3/v0.4 demos are framed as *"the reminder app,
now with better voice,"* not *"chat"* (`41` §9).

---

## 2. v0.1 baseline gate (ships FIRST)

`MVP DECISION` — **The current offline MVP must ship as v0.1 before any cloud phase (EP-3+).**
It is the trust baseline the whole "privacy-first, cloud-optional" story rests on; building cloud
features atop an un-shipped, unsigned app is a real risk (`41` §3, `39` §3). Carryover from
`current-project-status.md` + `39` §3:

| # | v0.1 gate item | Source |
| --- | --- | --- |
| G1 | **Authenticode signing** via **Azure Trusted Signing** (~$120/yr; `CSC_*` / `signtoolOptions` in `release.yml`) — the single highest-value release change; fixes SmartScreen "unknown publisher" (`30` §7 S6). | `39` §3, `30` §7 |
| G2 | **Fresh-VM QA pass** on a clean, non-admin Windows account: install with **no UAC**, core loop passes. | `current-status`, `39` §2 |
| G3 | **Wireshark** (zero outbound, 30-min session incl. a fired reminder) + **Procmon** (no writes outside `%APPDATA%\LifeOS`, no audio on disk) evidence. | `39` §2, `53` §5/§9 |
| G4 | **README** (incl. the "reminders need LifeOS running" limitation + SmartScreen steps), **PRIVACY.md**, **checksums**. | `current-status` |
| G5 | First public **GitHub Release** (installer + portable + `SHA256SUMS.txt` attached). | `current-status`, `39` §3 |
| G6 | **STT-model checksum pin** — pin a SHA-256 in `fetch-stt-model.mjs` before v0.1 (`30` §7 S7). | `39` §3 |

`MVP DECISION` — **EP-1 may run in parallel** with EP-0 (EP-1 is internal refactoring that does
not change user-facing behaviour, `41` §3), **but v0.1 ships before v0.4** (the first cloud tag).
Every EP from EP-1 assumes the v0.1 codebase as its starting point and assumes v0.1 is published
or about to be.

---

## 3. Per-release go/no-go gates

For each tag: what ships, the privacy/consent posture, and the mandatory gates. **Two gates are
non-negotiable at every release from v0.4** (and provable from v0.1): **(A)** Wireshark
**zero-with-cloud-off** (`11` §14 SEC-10) — the moment a build phones home with everything off it
is **not shippable**; and **(B)** the **confirmation gate intact** — nothing data-modifying
persists without a human/voice confirm (`36`, `41` §8.3). Plus, from v0.1 forward: a **signed
installer**, **per-feature consent shown** before first use, and **degrade-to-offline verified**.

| Tag | Ships | Privacy / consent posture | Mandatory gates (all must pass) |
| --- | --- | --- | --- |
| **v0.1** | Offline MVP | Fully offline; no network path active | Fresh-VM install, no UAC; Wireshark zero; **signed** installer; core loop passes; README/PRIVACY/checksums; STT-model checksum pinned. |
| **v0.2** | EP-1 seams + debt paid; auto-update + monthly recurrence | Still offline by default; the dead network seam (D1) is fixed but no cloud origin is reachable | 96+ core tests green + new factory/IPC-contract tests (`53` §8); Wireshark **still** zero; confirmation gate intact; **auto-update feed produced and consumed** (electron-updater wired). |
| **v0.3** | EP-2 conversation shell (offline) | Runs on the **local parser** — no cloud; non-reminder input shows the honest placeholder | Component tests (jsdom) green; Wireshark zero; confirmation gate intact; reminder loop byte-unchanged. |
| **v0.4** | EP-3 + EP-4 cloud **voice** | Cloud **STT/TTS** each separately consented; the "your voice is sent" disclosure shown | **(A)** Wireshark zero cloud-off / OpenAI-only cloud-on; **(B)** gate intact; audio **never on disk**; `audio:playBytes` bytes-not-path; fallback to Windows/sherpa; zero-voices degrade. |
| **v0.5** | EP-5 cloud **conversation** | Cloud **chat** opt-in, keyed, consented; off by default | **(A)** + **(B)**; `settings:get` leaks no key; `AssistantTurn` gates green; payload-shape (no ids/memories/settings sent); **degrade-to-offline verified**. |
| **v0.6** | EP-6 dispatcher + EP-7 Reminder v2 | Same as v0.5; voice-confirm matched **locally** | **(A)** + **(B)**; **pending-proposal invariant**; voice-yes not model-interpreted; timeout=cancel; reminder-create **byte-identical pre/post** (`41` §6). |
| **v0.7** | EP-8 Settings UX | Same; consent revocable in Settings, authoritative in main | **(A)** + **(B)**; key lifecycle (set/validate/clear); `safeStorage`-unavailable path; conditional privacy copy matches the switches; `SettingsAction` safe-subset only. |
| **v0.8** | EP-9 Memory | Memory confirmed-only; **sensitive never sent**; manage/delete screen ships **first** | **(A)** + **(B)**; memory gate = reminder gate; sensitive-exclusion test green; "what do you remember" exists before "remember this". |
| **v0.9** | EP-10 Research | Each research provider individually consented + its own allowlist origin | **(A)** + **(B)**; per-provider consent; medical/legal disclaimers; Wireshark shows only enabled origins. |
| **v1.0** | EP-11 Polish | Unchanged | **(A)** + **(B)**; performance suite to target; a11y pass; **E2E packaged smoke** green as a CI gate; full `53` regression + all cross-phase suites green. |

---

## 4. Release mechanics (building on the real setup)

The audit found a **working but incomplete** pipeline (`30` build audit, `39` §3). Keep what
works; close the three gaps.

- **electron-builder → NSIS + portable**, `perMachine:false` (no admin), STT model as
  `extraResources`, native addon `asarUnpack`'d. **Keep as-is** (`39` §3).
- **GitHub release workflow** (`release.yml`): `npm ci` → typecheck → lint → test →
  `fetch:model` → `electron-builder --win --publish always` (draft release) → generate
  `SHA256SUMS.txt` + `latest.yml` → attach. **Keep**, and add two steps below.
- `RISK (high, ship-blocking)` — **Unsigned today = the #1 gap** (`30` §7 S6). No Authenticode
  anywhere; the auto-update feed is integrity-checked (sha512) but **not authenticity-checked**.
  `MVP DECISION` — **add Azure Trusted Signing in v0.1/v0.2** (G1). This is the single
  highest-value release change.
- `RISK` — **electron-updater runtime NOT yet wired** (`30` build audit): `latest.yml` +
  `.blockmap` are *produced* but there is **no consumer**. `MVP DECISION` — **wire
  electron-updater in v0.2** (check-on-launch, user-approved install, off-by-default background
  download to honour "nothing silent", `24`/`11` §13). Auto-update authenticity **depends on
  signing** — do them together.
- `MVP DECISION` — **Add an E2E packaged smoke gate** (`53` §1, `38` §9): a separate CI job that
  **builds first**, then runs the Playwright-electron launch + reminder round-trip. By v2 a green
  pipeline must imply **"packages and launches,"** not just "typecheck+lint+test pass on
  `windows-latest`" (`30` §10 — green CI does not prove the app packages today). Gate it on tags
  or a label so PR CI stays fast.
- **CI:** add the `jsdom` component project (`38` §1) to the existing job for v0.3 onward.

---

## 5. Cadence & feature flags (rollback without code revert)

`MVP DECISION` — **Each release can ship with its EP flag off** (`41` §10). A regression is a
**flag flip**, not a code revert. All cloud flags default **off**; `conversation_ui_enabled`
defaults on at its release (v0.3) with the old single-shot path one flag away.

| Flag (`41` §10) | Introduced at | Off ⇒ |
| --- | --- | --- |
| `conversation_ui_enabled` | v0.3 (EP-2) | old single-shot `ChatScreen` |
| `stt_provider='openai'` (+ consent) | v0.4 (EP-3) | sherpa (offline) |
| `tts_provider='openai'` (+ consent) | v0.4 (EP-4) | Windows voices |
| `ai_assist_enabled` (+ consent) | v0.5 (EP-5) | offline placeholder for chat/Q&A; local parser for reminders |
| `dispatcher_enabled` | v0.6 (EP-6) | EP-2's direct reminder-create path (the regression fallback, `41` §6) |
| `voice_confirm_enabled` | v0.6 (EP-7) | button-only confirmation |
| `memory_enabled` | v0.8 (EP-9) | memory intents refused in the dispatcher |
| research providers (per-provider) | v0.9 (EP-10) | research intent refused |

**Cadence:** one tag per EP-cluster, sequential, each leaving the app in a **working, demoable,
testable** state (`41` §2). No tag ships until its go/no-go gate (§3) passes. Because rollback is
a flag flip, a release can ship its new surface **dark** (flag off) and enable it once field-
verified — the `dispatcher_enabled` path (§3 v0.6) is the canonical example: the old direct
reminder-create path stays behind the flag until the dispatcher path is verified on a real build
(`41` §6).

---

## 6. Note — `39` §4 Architecture Review stays the scalability authority

`54` owns **release tags, gates, mechanics, and cadence** — **not** the scalability verdict.
`39`'s **§4 Architecture Review** remains fully valid and is the authority for whether the v2
design scales: long conversations, multiple LLM providers (incl. local Ollama), memory, and
research **scale cleanly** (providers behind an interface / intents behind the dispatcher);
**autonomous agents conflict by design** with the confirmation gate and should not be made to
scale; **third-party integrations (Calendar/Gmail/WhatsApp) scale on the action side but need a
genuinely new OAuth + background-sync subsystem** — a v1.x frontier, deferred, not on this
release map. See `39` §4 and §4.1–§4.2 for the grounded per-dimension verdicts.
