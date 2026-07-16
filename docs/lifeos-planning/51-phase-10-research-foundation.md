# 51 — Execution Phase EP-10: Research Foundation

> **Ships:** v0.9 (`41` §7). **Cloud posture:** opt-in, **per-provider consented origin** —
> enabling one research provider adds **only its** origin to the network allowlist and CSP.
> **Depends on:** EP-6 (Action Dispatcher, `36`/`47`) for the `research` intent branch;
> reuses EP-5's LLM turn contract (`31`) unchanged — `research` is already a defined intent.
>
> **Authority:** `41` (build sequence). This doc owns the EP-10 phase checklist (`41` §11).
> **Governing constraints:** `24` v0.5 — the `ResearchProvider` interface, Weather-via-Open-Meteo
> as the safe first provider, the medical/legal rules, and *"Consent is not transitive."*

---

## Objective

Stand up the **research capability** as architecture-first scaffolding with **exactly one live
provider**:

- Define the **`ResearchProvider` interface** (`24` v0.5) and a provider registry/router.
- Ship **Weather via Open-Meteo** — no API key, free, generous limits, the obvious safe first
  provider (`24` v0.5). Its origin `api.open-meteo.com` is added to the `session.ts` allowlist
  **only when weather is enabled**.
- Light up the `research` intent (read-only → execute + reply; **no confirmation gate**, but a
  network provider needs its **own** consent + allowlisted origin — *"consent is not
  transitive"*, `24` v0.5).
- Provide **architecture-only scaffolding** for the rest of the domains (places, routes, web,
  PDF, medical, legal) — interfaces and disabled registry entries, no live network.
- Encode the **medical/legal disclaimer rules** (never professional advice; cite sources;
  recommend a professional; refuse diagnosis) as a reusable guard (`24` v0.5).
- Gate each provider behind its **own** per-provider flag (`41` §10 — "research providers
  (per-provider)"; off ⇒ research intent refused in the dispatcher, `31` §2).

`MVP DECISION` — `research` is **read-only** in the dispatcher (execute + reply, no
confirmation card, `36` §2/§4.2). But **read-only is not consent-free**: because it leaves the
device, each provider carries its own consent gate and origin allowlist entry. The
data-modification gate and the network-egress gate are **different gates** (`24` v0.5).

---

## Why this phase exists

The brief's §19 research capability was designed in the MVP (`core/research/` interface) and
"implemented never" (`24` v0.5). EP-10 implements the *foundation* — the interface, the router,
the consent/allowlist wiring, and one proof provider — so that every later provider is a
**registry entry + a consent toggle + one allowlist origin**, never a re-architecture (`31` §8
extensibility argument).

Weather is chosen first because it is the **safe** first network provider (`24` v0.5): no key
to protect, no location-precision disclosure beyond a coarse lat/long the user already implies,
generous free limits, and a stable documented API. It proves the whole
`ResearchProvider → router → dispatcher → per-provider consent → single allowlisted origin`
path with the lowest risk, so the higher-risk domains (places/routes/web/medical/legal) inherit
a proven, consented, Wireshark-verified spine.

The medical/legal rules are encoded **now while they are free** (`24` v0.5 `MVP DECISION
forward-binding`: *"LifeOS will never present itself as a source of medical, legal or financial
advice."*) so that no future provider can light up without the disclaimer guard already in path.

---

## Current code that will be reused

| Reused as-is | Why |
| --- | --- |
| The Action Dispatcher read-only branch (`36` §2, `execute.ts` `case 'research'`) | `research` is already classified read-only (execute + reply, no gate). `execute.ts` already sketches `researchProvider.answer(a.query)` (`36` §5, `// v0.5`). |
| `ResearchAction` Zod schema (`31` §3) | `{ kind:'research', query, provider: 'weather'|'web'|'document'|null }` — shape+semantics gates already defined; EP-10 wires the router behind it. |
| `session.ts` network apparatus — `onBeforeRequest` default-deny, `isAllowedOrigin`, `buildCsp` `connect-src`, and the **now-live** `aiAssistEnabled` predicate seam (fixed in EP-1, `30` D1) | The exact seam per-provider origins flow through. EP-10 extends the allowlist by one origin per enabled provider; it never weakens a lock (`30` §13.3). |
| The consent pattern established for OpenAI features (`ai_consent_accepted_at`, `32`) | A per-provider `research_weather_consent_at` mirrors it — same timestamp-consent structure. |
| `LlmProvider` interface (`33` §4, EP-5) | Unchanged. `research` results may be *synthesised* into prose by the LLM, but the provider fetch is separate; the weather provider needs no LLM. |
| The `guard()` IPC boundary + typed settings accessors (EP-1) | New research settings read exactly like `ai_assist_enabled`; new IPC (if any) is `guard()`-wrapped. |
| Reset Local Data + the security envelope (`30` §7, §13) | Untouched. |

---

## Code that must be refactored

| Refactor | Where | Note |
| --- | --- | --- |
| `execute.ts` `case 'research'` from sketch to real router call | `electron/actions/execute.ts` | Route to `researchRouter.answer(action)`; format the reply (with disclaimer if medical/legal). |
| `requireCapabilityEnabled('research')` becomes **per-provider** | `electron/actions/dispatcher.ts` | Resolve the target provider from `ResearchAction.provider` (or infer weather); refuse if that provider's flag is off (`31` §2). |
| `session.ts` allowlist + CSP become **provider-driven** | `electron/main/session.ts` | `isAllowedOrigin` consults an enabled-origins set assembled from enabled research providers; `buildCsp` `connect-src` mirrors it. `api.open-meteo.com` present **only** when weather enabled. |
| Session-security **re-install on settings change** | `electron/main/index.ts` (the seam fixed in EP-1, `30` D1) | Toggling a provider re-installs the origin allowlist live, no restart. Reuses the EP-1 re-install path. |
| `SETTING_DEFAULTS` gains per-provider flags + consent timestamps | `electron/database/settings-repository.ts` | `research_weather_enabled`, `research_weather_consent_at`; scaffolded providers get flags defaulting off too. |

`MVP DECISION` — The allowlist is assembled from **enabled providers only** at install/re-install
time. There is no "research on ⇒ all origins" master switch; each origin is gated by its own
provider flag (`24` v0.5: *"Enabling 'Weather' does not enable 'Web research.' Consent is not
transitive."*).

---

## Files expected to change

```
core/research/research-provider.ts          # NEW — ResearchProvider interface, ResearchResult
core/research/disclaimers.ts                # NEW — medical/legal disclaimer guard + rules
electron/research/research-router.ts        # NEW — registry + provider routing + disclaimer wrap
electron/research/providers/weather-open-meteo.ts   # NEW — the one live provider
electron/research/providers/index.ts        # NEW — registry (weather live; rest disabled stubs)
electron/actions/execute.ts                 # wire case 'research' → router
electron/actions/dispatcher.ts              # per-provider requireCapabilityEnabled
electron/main/session.ts                    # provider-driven allowlist + CSP connect-src
electron/main/index.ts                      # re-install session security on provider toggle
electron/database/settings-repository.ts    # + per-provider flags + consent timestamps
src/features/settings/SettingsScreen.tsx    # per-provider consent toggles (or EP-8 surface)
core/types/ipc.ts                           # + research settings in SettingsDto
```

---

## New folders

- `core/research/` — the framework-free `ResearchProvider` interface + `disclaimers` rules
  (pure TS; ESLint-walled from `electron/node`, `30` §1).
- `electron/research/` — the router and the concrete providers.
- `electron/research/providers/` — one file per provider; only `weather-open-meteo.ts` is live.

---

## New services

- **`ResearchRouter`** (`electron/research/research-router.ts`) — resolves a `ResearchAction`
  to a registered, **enabled** provider, calls `provider.answer(query)`, wraps
  medical/legal results with the disclaimer guard, and returns a `ResearchResult`. Refuses
  (before any network) if the provider is disabled or unregistered.
- **`WeatherProvider` (Open-Meteo)** (`electron/research/providers/weather-open-meteo.ts`) —
  implements `ResearchProvider`: `id='weather'`, `requiresNetwork=true`,
  `origins=['https://api.open-meteo.com']`. Geocodes a place (Open-Meteo geocoding, same
  origin) → fetches forecast → returns a plain, source-cited `ResearchResult`. No API key.
- **Disabled provider stubs** — `places`, `routes`, `web`, `document(pdf)`, `medical`, `legal`
  registered with `enabled:false` and their declared `origins`, so the architecture is visible
  and testable but **inert** (no network). PDF is noted as the one **fully-offline-achievable**
  future path (`24` v0.5).

```ts
// core/research/research-provider.ts
export interface ResearchResult {
  answer: string;
  sources: Array<{ label: string; url: string }>;   // an uncited medical claim is NOT shown (24 v0.5)
  disclaimer?: string;                               // present for medical/legal
}
export interface ResearchProvider {
  readonly id: string;                 // 'weather' | 'places' | 'web' | 'document' | 'medical' | 'legal' | 'routes'
  readonly requiresNetwork: boolean;
  readonly origins: readonly string[]; // the ONLY origins this provider may reach; drives the allowlist
  readonly enabledSettingKey: string;  // e.g. 'research_weather_enabled'
  answer(query: string): Promise<ResearchResult>;
}
```

---

## IPC changes

- **No new action IPC.** `research` flows through the **existing** `chat:send` → engine →
  dispatcher → `execute` path; the follow-up assistant message carries the answer (`36` §5).
  Research is read-only, so there is **no** `action:confirm` step (`36` §4.2).
- **Settings IPC reused:** per-provider flags + consent timestamps are ordinary `settings:get`/
  `settings:update` keys (`guard()`-wrapped, `16` §5). Toggling a provider triggers the
  session-security re-install in main.
- `research:providers` (main→renderer, optional) — a read-only list of registered providers +
  enabled state for the Settings UI; `guard()`-wrapped, returns no secrets.

`MVP DECISION` — Consent for a network provider is captured through the **normal settings
update** (the toggle write records `research_<id>_consent_at`), so the consent record is
structurally identical to the OpenAI consent (`32`) and cannot be set by the LLM (it is not in
the `SettingsAction` closed set, `31` §3).

---

## Database changes

- **No migration.** Research needs no new table; results are **not persisted** (they are live
  external answers, not user data). The `conversations` row for the turn stores the human-readable
  reply like any other (`31` §4.2).
- **New settings** in `SETTING_DEFAULTS` (`settings-repository.ts`), all default off/empty:
  - `research_weather_enabled: 'false'`, `research_weather_consent_at: ''`
  - scaffolded (disabled) flags: `research_web_enabled`, `research_places_enabled`,
    `research_document_enabled`, `research_medical_enabled`, `research_legal_enabled` — all
    `'false'`, present so the registry can read them uniformly.

`MVP DECISION` — Research answers are transient and **not** stored as memories; if the user
wants to remember a fact, that goes through `memory_save` (EP-9) with its own gate. Keeping
research stateless avoids a second store of external data.

---

## UI changes

- **Settings: a "Research" section** with a **per-provider** toggle. Weather ships enabled-able;
  the rest render **disabled/"Coming later"**. Each toggle shows: what it does, that it makes a
  network request, the exact origin it will reach, and *"Enabling this does not enable other
  research."* (`24` v0.5). Turning it on records consent. This is EP-8's Settings surface if EP-8
  shipped; otherwise EP-10 adds the section.
- **Chat:** a `research` answer renders as a normal assistant message with a **Sources** line
  (clickable labels). Medical/legal answers render the **disclaimer banner** first and a
  *"speak to a qualified professional"* footer.
- **Disabled-provider prompt:** asking for weather while it is off yields an inline prompt with
  an **"Enable Weather"** affordance that deep-links to the Settings toggle (not a silent
  failure).

---

## Main process changes

- Register `ResearchRouter` + the provider registry at startup; the router reads each provider's
  `enabledSettingKey` to decide availability.
- `session.ts`: `isAllowedOrigin` and `buildCsp` consult **`enabledResearchOrigins()`** — the
  union of `origins` across enabled providers (plus the existing OpenAI origin when its features
  are on). With weather off, `api.open-meteo.com` is **not** in the set and a request to it is
  denied by `onBeforeRequest`.
- `index.ts`: on any research-provider settings change, **re-install** session security (the
  live re-install seam from EP-1 that fixed `30` D1) so the allowlist reflects the new state
  without a restart.
- `execute.ts` `case 'research'`: resolve provider → `requireCapabilityEnabled` (per-provider)
  → `researchRouter.answer` → disclaimer-wrap → follow-up reply.
- All provider fetches happen **in main** (never the renderer), keeping any future keys and all
  network egress on the trusted side (`30` §11, `32` §3.3).

---

## Renderer changes

- Settings screen gains the Research section + per-provider toggles + consent copy.
- Chat message rendering gains a **Sources** sub-component and a **Disclaimer** banner variant
  (reused by medical/legal answers).
- A small `useResearchProviders()` hook (optional) to render the provider list + enabled state.
- No new top-level nav destination — research is a *conversational* capability, surfaced in chat.

---

## Provider changes

- **New provider family:** `ResearchProvider` (distinct from `LlmProvider`/`SpeechProvider`/
  `TextToSpeechProvider`). Only the **Weather (Open-Meteo)** provider is live; all others are
  registered-but-disabled stubs declaring their future `origins`.
- **`LlmProvider` unchanged** — the engine may ask the LLM to phrase a weather answer naturally,
  but the *fact* comes from the provider; the provider result is the source of truth and its
  `sources[]` are cited (`24` v0.5: an uncited medical claim is not shown).
- **No change** to STT/TTS providers.

---

## Security considerations

- **Per-provider consented origins.** The network allowlist is the **union of enabled
  providers' `origins`** only. Weather off ⇒ `api.open-meteo.com` is unreachable (default-deny
  `onBeforeRequest`, `30` §7). Consent is **not transitive** (`24` v0.5): each provider is an
  individually consented, individually disclosed toggle.
- **Read-only ≠ consent-free.** `research` skips the *data-modification* confirmation gate but
  is still governed by the *network-egress* gate (its own consent + origin). Two gates, not one
  (`36` §4.2 read-only + `24` v0.5 per-provider consent).
- **CSP `connect-src` mirrors the allowlist** — a provider's origin is added to
  `connect-src` only when enabled; the packaged base CSP stays `script-src 'self'` (`30` §7).
- **Fetches in main; keys never cross IPC** — Open-Meteo needs no key, but the pattern (main-side
  fetch) is established for the key-bearing future providers (`41` §8.4).
- **The LLM never actuates a fetch** — it proposes a `research` action (data); the router
  decides whether/where to fetch based on the app's enabled set, not the model's claim (`36`
  §7, `31` §2).
- **Medical/legal guard is structural** — the disclaimer/citation/refusal rules run in the
  router before any medical/legal answer is returned, independent of the model's phrasing.
- **Wireshark evidence:** with research off → zero packets; with **only** weather on → traffic
  to **only** `api.open-meteo.com` (plus OpenAI origins if those features are separately on).

---

## Performance considerations

- Weather fetch is a single small HTTPS GET (geocode + forecast, same origin), off the main
  thread's synchronous SQLite path — network latency dominates, not CPU. A timeout (default a
  few seconds) fails to a graceful *"I couldn't reach the weather service."*
- No new persistent storage ⇒ no DB-growth or retention concern (`10` §9 untouched).
- Provider registry lookups are O(providers) over a handful of entries — negligible.
- Main-thread SQLite / STT-decode ceilings (`30` §6) are **not** affected by EP-10 and remain
  EP-11's concern.

---

## Risks

- `RISK` — **Origin-drift / redirect.** Open-Meteo could redirect to a CDN origin not in the
  allowlist. Mitigation: allowlist the documented API host; a redirect to an unlisted origin is
  denied by design (fails closed) and surfaced as a graceful error — not silently followed.
- `RISK (high, product)` — **Medical/legal harm.** A well-meaning assistant answering *"do I
  have dengue?"* is where real harm lives (`24` v0.5 `RISK`). Mitigation: the disclaimer guard
  **refuses diagnosis**, opens with a disclaimer, closes with "speak to a qualified
  professional," and cites sources; medical/legal providers ship **disabled** in EP-10 anyway.
- `RISK` — **Consent-transitivity mistake.** A future refactor could accidentally gate all
  origins on one master flag. Mitigation: the allowlist is assembled *from each provider's own
  flag*; a test asserts enabling weather does **not** add any other origin.
- `RISK` — **Location precision.** Weather needs a coarse location. Mitigation: use a
  user-supplied place/coarse lat-long, never precise geolocation; disclose it in the toggle copy.
- `RISK` — **Prompt-injected `research` spam.** The model could propose many research calls.
  Mitigation: read-only, per-provider enabled, and rate/timeout bounded; disabled providers
  simply refuse.

---

## Rollback strategy

- **Primary: flip the per-provider flag(s) off** (`41` §10 — research providers, per-provider).
  The dispatcher then refuses `research`, and the session re-install removes the origin from the
  allowlist — **no code revert, no restart**.
- Because there is **no migration and no persistence**, disabling research returns the app to
  **byte-identical v0.8 behaviour**; there is nothing to roll back in the DB.
- The disabled scaffolded providers are inert by construction (their flags default off), so a
  half-finished future provider cannot leak network traffic.
- CSP/allowlist changes are reversible by the same re-install path that applied them.

---

## Definition of Done

Re-asserts the `41` §8 invariants, plus EP-10 specifics:

1. **Full offline reminder loop works** with no key and all research off (`41` §8.1).
2. **Zero outbound packets with all cloud features off** — Wireshark off→zero (`41` §8.2).
3. **With only Weather enabled, Wireshark shows traffic to only `api.open-meteo.com`** (plus
   OpenAI origins iff those features are separately enabled) — the per-provider-origin proof.
4. **Confirmation gate holds** for all data-modifying actions; `research` correctly takes the
   **read-only** path (no card) yet **still required its own consent** to reach the network
   (`41` §8.3, `24` v0.5).
5. **API key never crosses IPC; LLM never actuates a fetch** (`41` §8.4–8.5).
6. **Notification + history fire unconditionally and first** (`41` §8.6).
7. **No `child_process`/`eval`/dynamic import** added (`41` §8.7).
8. **Enabling Weather adds exactly one origin**; enabling it does **not** enable or reach any
   other provider's origin (consent-not-transitive test green).
9. Medical/legal guard: `"do I have dengue?"` yields a **disclaimer refusal** (no diagnosis),
   and every medical/legal answer path is source-cited or not shown.
10. The EP-10 phase checklist (this doc) is green and referenced by `53` (`41` §11).

---

## Feature Checklist

**Already completed (pre-EP-10):**
- `research` intent + `ResearchAction` schema (`31` §2–§3).
- Dispatcher read-only classification of `research`; `execute.ts` sketch (`36` §2, §5).
- The live `session.ts` allowlist/CSP seam + the EP-1 re-install path that fixed `30` D1.
- The OpenAI consent-timestamp pattern to mirror (`32`).

**New work (EP-10):**
- `ResearchProvider` interface + `ResearchResult` (`core/research/`).
- `ResearchRouter` + provider registry.
- Weather (Open-Meteo) live provider — no key.
- Disabled scaffold stubs: places, routes, web, document(PDF), medical, legal.
- Medical/legal disclaimer guard (`core/research/disclaimers.ts`).
- Per-provider flags + consent timestamps; provider-driven allowlist + CSP; live re-install.
- Settings Research section + chat Sources/Disclaimer rendering.
- Consent-not-transitive test + Wireshark per-origin test.

**Deferred work (later EPs):**
- Settings **UX** polish / a11y / animation of the Research section → EP-11.
- Full test-coverage completion for the network path → EP-11 (`30` §10).

**Future work (post-1.0 / later, `FUTURE OPTION`):**
- Places (Google/Foursquare) + Routes (ORS/Mapbox) — keys, quotas, location disclosure (`24` v0.5).
- Web research (search API + LLM synthesis) — *"only worthwhile after"* a local LLM (`24` v0.5).
- **PDF: fully-offline** local text extraction (`pdf.js`) + optional local-LLM summary (`24` v0.5).
- Medical/legal providers going live behind the already-built disclaimer guard.

---

## Manual Testing

| Step | Action | Expected Result |
| --- | --- | --- |
| 1 | Fresh v0.9, all research off. Ask *"what's today's weather?"* | Inline prompt: *"Weather lookups are off. Enable Weather in Settings?"* with an **Enable Weather** affordance. No network request (verify Wireshark: zero). |
| 2 | Open Settings → Research. | Weather toggle present with disclosure copy + the origin `api.open-meteo.com` + *"Enabling this does not enable other research."* Other providers shown disabled/"Coming later". |
| 3 | Enable **Weather** (consent recorded). | `research_weather_enabled='true'`, `research_weather_consent_at` stamped; session security re-installed; `api.open-meteo.com` now in the allowlist + CSP `connect-src`. |
| 4 | Ask *"what's the weather in Bengaluru tomorrow?"* | A forecast answer with a **Sources** line citing Open-Meteo. Wireshark shows traffic to **only** `api.open-meteo.com`. |
| 5 | Ask *"find me a good restaurant nearby."* (places disabled) | Friendly refusal / "Coming later"; **no** network request to any places origin (Wireshark clean). |
| 6 | Ask *"do I have dengue?"* | **Disclaimer refusal**: opens with a medical disclaimer, does **not** diagnose, recommends a qualified professional. No uncited claim shown. |
| 7 | Disable Weather again. | Session re-installed; `api.open-meteo.com` removed from allowlist/CSP; asking weather returns to the step-1 prompt; Wireshark → zero. |
| 8 | With Weather on, pull the network cable, ask for weather. | Graceful *"I couldn't reach the weather service just now."*; the reminder loop and app remain fully functional. |

---

## Edge Cases

- **Ambiguous place** ("weather in Springfield") — provider geocode returns multiple; the reply
  asks which, or picks the top hit and states it; never silently wrong.
- **`ResearchAction.provider = null`** — router infers `weather` from the query only if weather
  is enabled; otherwise refuses with the enable prompt.
- **Query for a domain with no provider at all** — router returns "I can't research that yet."
- **Disclaimer domain answered by a non-medical provider** (e.g. a weather query that mentions a
  disease) — the medical guard triggers on the *answer classification*, not just the provider id.
- **Consent recorded but provider later disabled** — disabled wins; the stale consent timestamp
  is harmless and re-used if re-enabled.
- **Redirect to an unlisted origin** — denied by `onBeforeRequest`; surfaced as a graceful error.
- **Very long query (>500 chars)** — `ResearchAction` Zod `max(500)` clarifies instead.

---

## Failure Cases

- **Provider network error / timeout** — sanitised assistant message; logged (redacted); app
  unaffected (`36` §5).
- **Malformed provider response** — router validates the shape; on failure returns "I couldn't
  read the weather service's answer" rather than passing junk to the user or the LLM.
- **Origin blocked because the flag was toggled off mid-flight** — the in-flight fetch is
  denied; the turn fails gracefully.
- **CSP/allowlist re-install fails** — fails closed (origin not added); research stays refused;
  logged.
- **LLM proposes `research` while every provider is disabled** — refused in the dispatcher; the
  model's proposal is dropped (`31` §2).

---

## Recovery Tests

1. Toggle Weather on → ask weather (success) → force-quit mid-fetch → reopen → app healthy,
   no persisted research state, allowlist reflects the saved `research_weather_enabled` flag.
2. Enable Weather, then corrupt the settings row for `research_weather_enabled` to an invalid
   value → typed accessor falls back to the default (`false`) → weather safely off; no crash.
3. Simulate Open-Meteo returning HTTP 500 repeatedly → each attempt fails gracefully; the app
   never hangs; the disclaimer/medical guard remains intact for other queries.
4. Downgrade to v0.8 → EP-10 has no migration, so the v0.8 binary opens the DB normally
   (`user_version` unchanged); research settings are just unread keys.

---

## Regression Tests

- **Full offline reminder loop** (create → confirm → schedule → notify + speak), no key, all
  research off — **byte-identical to v0.8** (`41` §8.1).
- **Confirmation gate** — every reminder/memory/delete action still requires an explicit
  Confirm; `research` correctly takes the read-only path (no card) but is network-gated.
- **Wireshark off → zero packets** with all cloud features off (`41` §8.2); **only-Weather-on →
  only `api.open-meteo.com`** (the EP-10 addition).
- **Consent-not-transitive** — enabling Weather adds no other provider's origin to the allowlist
  or CSP (asserted directly).
- **EP-9 memory** — sensitive-never-sent payload-snapshot still green; research answers are not
  written into `memories`.
- Existing core tests + migration-rollback still green (`30` §10).

---

## Performance Tests

- Weather round-trip p95 under the provider timeout; UI stays responsive during the fetch (fetch
  is off the synchronous DB path, `30` §6).
- Registry resolution + allowlist assembly on a provider toggle completes well within a frame;
  session re-install does not stall the scheduler tick.
- Repeated weather queries do not accumulate memory or open sockets (no leak).

---

## Expected App Behaviour (Current → EP-10)

```text
Current (v0.8):
  user text ─▶ engine ─▶ LLM turn ─▶ dispatcher
                                        ├─ reminder_* → confirm → execute
                                        ├─ memory_*   → (EP-9) gate / recall
                                        └─ research   → REFUSED (no provider enabled, 31 §2)
  session allowlist: openai only when chat/voice enabled; else default-deny

EP-10 (v0.9, Weather enabled + consented):
  user text ─▶ engine ─▶ LLM turn ─▶ dispatcher
                                        └─ research → per-provider capability check
                                                       → ResearchRouter.answer('weather', q)
                                                       → fetch api.open-meteo.com (main, allowlisted)
                                                       → disclaimer-wrap if medical/legal
                                                       → cited follow-up reply (read-only, NO confirm card)
  session allowlist: + https://api.open-meteo.com  ← ONLY because weather enabled (consent not transitive)
  medical/legal query ("do I have dengue?") → disclaimer refusal, no diagnosis, cite + recommend a professional
  all research OFF ⇒ behaviour byte-identical to v0.8
```

---

## Conversation Testing

- **User:** *"What's today's weather?"* — **(Weather disabled)**
  **Expected:** a prompt to enable — *"Weather lookups are off. Want to turn on Weather in
  Settings? It reaches only api.open-meteo.com and doesn't enable anything else."* No network
  request occurs.
- **User:** *"What's today's weather?"* — **(Weather enabled + consented)**
  **Expected:** a forecast for the resolved location with a **Sources: Open-Meteo** citation;
  traffic to only `api.open-meteo.com`.
- **User:** *"Do I have dengue?"*
  **Expected:** a **disclaimer refusal** — opens with a medical disclaimer, does not diagnose,
  states LifeOS is not a medical source, recommends speaking to a qualified professional. No
  uncited claim shown (`24` v0.5).
- **User:** *"Is this contract legally binding in India?"* (legal disabled)
  **Expected:** refusal with the legal disclaimer — it may summarise a document the user gives
  it (future, offline PDF path) but will not opine on what the law *means*; states its
  jurisdiction limit or refuses (`24` v0.5).
- **User:** *"Turn on web research too."*
  **Expected:** the assistant cannot flip a consent/provider flag (it is outside the
  `SettingsAction` safe set, `31` §3); it points the user to the Settings toggle. Consent stays
  a deliberate human action.

---

## Voice Testing

- Speak *"what's the weather like tomorrow?"* with Weather enabled → STT finalises → spoken +
  on-screen forecast with the Open-Meteo citation; verify the fetch reached only
  `api.open-meteo.com`.
- Speak the same with Weather disabled → the spoken/rendered reply is the enable-prompt, and
  **no** network request is made (Wireshark clean) — proving voice cannot bypass the per-provider
  consent gate.
- Speak *"do I have the flu?"* → the disclaimer refusal is spoken and shown; no diagnosis; the
  medical guard fires regardless of input modality.
- Confirm that a `research` result is read-only: no voice-confirmation phrase is solicited (no
  pending proposal), because research does not use the confirmation card (`36` §4.2).
```
