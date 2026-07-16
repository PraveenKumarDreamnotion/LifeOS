# 49 — Execution Phase EP-8: Settings UX Redesign

> **Ships in v0.7** (`41` §7) · **opt-in** (the cloud features it exposes are opt-in; the
> redesign itself is a UX consolidation) · gated so any regressed section can be hidden.
>
> **Authority:** `41` owns build order and the §8 invariants; this doc is the EP-8 execution
> plan and the **implementation of doc `34`** (Settings Redesign). Voice-picker internals are
> `35`; the OpenAI seam / key mechanism / consent gates are `32`; the provider factory is `33`.
> Where this doc and `41` disagree on sequencing, **`41` wins**.
>
> **NON-NEGOTIABLE SCOPE NOTE (`41` §4.2, `34` note):** the `safeStorage` key **mechanism**,
> the three key IPC channels (`settings:setApiKey`/`clearApiKey`/`validateApiKey`), the
> `cloudEnabled()` predicate, and the minimal `SettingsDto` growth **already shipped in EP-1**
> (and were exercised by EP-3/EP-4/EP-5). **EP-8 CONSOLIDATES and POLISHES the UX. It does NOT
> re-implement encryption, IPC, or the network seam.** Adding those to this phase would be
> re-doing EP-1's work.

---

## Objective

Deliver the comprehensive Settings UX redesign of `34`: replace the six hand-written
`<section className="settings-group">` blocks in `SettingsScreen.tsx` with a new information
architecture and a set of shared, accessible primitives, and expose — coherently and honestly —
the cloud capabilities that EP-1…EP-7 built piecemeal. Concretely:

1. **New IA** — keep Privacy/Reminders/Window&tray/Danger/About; add **"Yogi's intelligence"**
   (the master OpenAI section), **Providers**, **Voice**, and **Consent management** (`34` §2).
2. **Provider selection** — STT (OpenAI / Offline-Sherpa) and TTS (OpenAI / Windows) radios,
   dimmed until a valid key exists (`34` §4).
3. **Voice picker with friendly labels** — Soft Female, Professional Male, Warm Female, Calm,
   Energetic, … storing the **provider voice id internally** while showing a personality name
   (`35` §1, §2.1) + Preview / Play Sample / Save / Cancel / Reset (`35` §4).
4. **Consent management** — per-feature consent subview, revoke, Last-used, local spend estimate
   (`34` §5, `32` §6).
5. **Privacy-copy reconciliation** — the 3 renderer places that assert an absolute offline
   promise become conditional truths (`34` §6).
6. **Shared components** — `Section`, `SettingRow`, `Toggle`, `SecretField`, `ProviderSelect`,
   `ConsentModal` (`34` §8) — reused by the conversation + voice UIs, not settings-only.

---

## Why this phase exists

By the end of EP-7 the app has three cloud capabilities (chat, STT, TTS), an encrypted key, a
provider factory, voice confirmation, and edit/delete — but its **Settings screen is still the
original flat six-block list** (`SettingsScreen.tsx`), whose "Speech-to-text and voice run
entirely offline on your computer" line (`SettingsScreen.tsx:42`) is now **false** the moment a
user enables OpenAI. Three reasons this must be its own phase:

- **The privacy copy actively lies once cloud is on** (`34` §6, `30` §3.1). `RISK (high,
  reputational)` — the app's central promise ("nothing leaves your device") is hard-coded in
  ≥3 places (`App.tsx` rail chip, `SettingsScreen.tsx:42`, `OnboardingFlow.tsx` privacy pane).
  Reconciling them is a **content audit**, not a form tweak, and it is release-blocking for a
  cloud release.
- **The controls the earlier phases needed were shipped minimally, not designed.** EP-3/4/5 each
  added just enough settings surface to test their feature. `34` §1 warns the current model is a
  "drift factory" (`SettingsDto` duplicated by `SettingsUpdate` in `src/lib/ipc.ts`, `30` D6) —
  EP-8 pays that down with one source of truth and typed accessors so the ~10 v2 keys stop being
  three-place edits.
- **Consent and provider choice need a coherent home.** Per-feature consent, revoke, provider
  radios, and voice preview are scattered or absent; `34` §2's IA makes the dependency chain
  (key → consent → provider) *legible* instead of letting a user pick a provider that silently
  can't run (`34` §2 MVP DECISION).

`MVP DECISION` — EP-8 is **UX + data-model consolidation, zero new network capability.** Every
security control (encryption, key-in-main, allowlist) already exists; EP-8 makes them usable and
honest. This bounds the phase to the renderer + the settings DTO/accessors + copy.

---

## Current code that will be reused

| Reused | Why |
| --- | --- |
| `electron/database/settings-repository.ts` — `get/set/getAllSafe/hasApiKey`, `SETTING_DEFAULTS` | The store is correct; `getAllSafe()` already strips `ai_key_ciphertext` (`settings-repository.ts:61-69`). EP-8 adds typed accessors + new keys, not a new store. |
| The `safeStorage` key mechanism + `settings:setApiKey/clearApiKey/validateApiKey` (**EP-1**, `32` §3.3, `34` §3.1) | **Do not re-implement** — EP-8 only builds the UX (`SecretField`) over them. |
| `cloudEnabled()` predicate + session re-install on `settings:changed` (**EP-1**, `32` §3.1) | The live network gate exists; EP-8's toggles drive it, they don't recreate it. |
| `src/components/Modal.tsx` (`30` §13, `41` §4.1) | `ConsentModal` reuses it (`34` §8). |
| `core/tts/voice-catalog.ts` + `tts:preview`/`tts:listVoices`/`audio:playBytes` (**EP-4**, `35` §9) | The Voice section drives the **existing** preview path; EP-8 builds the picker UI over it. |
| `useSettings` hook (renderer) | Shape unchanged; the DTO it carries is richer (`34` §9). |
| Provider factory keyed on `stt_provider`/`tts_provider` (**EP-1/EP-3/EP-4**, `33` §5) | The Providers radios write these settings; the factory re-runs live on change. |
| The Reset flow, `openDataFolder`, version string (`SettingsScreen.tsx:83-97`) | Danger/About sections kept verbatim. |

`MVP DECISION` — With all cloud off, EP-8's Settings must present an app **indistinguishable
from today's offline MVP** (`34` §12.8) — the new sections simply don't assert anything cloud
and the offline copy is unchanged.

---

## Code that must be refactored

| Refactor | Where | Note |
| --- | --- | --- |
| **Delete `SettingsUpdate`** hand-maintained interface; derive patch type from the DTO (`Partial<SettingsDto>` minus read-only fields like `hasApiKey`) | `src/lib/ipc.ts:8-15` (`30` D6, `34` §7) | One place to add a setting. `SettingsScreen.tsx:5,13` import must switch to the derived type. |
| **Typed accessors** `getBool/getNumber/getEnum` on `SettingsRepository` | `settings-repository.ts` (`34` §7, `30` §3.2) | Call sites stop hand-parsing `'true'`/`'1.0'`; the DTO exposes typed fields (`ttsRate: number`, `aiEnabled: boolean`). |
| **Rewrite `SettingsScreen.tsx`** from six bespoke `<section>` blocks to composed `Section`/`SettingRow`/`Toggle` primitives | `src/features/settings/*` | The current file is entirely bespoke JSX (`SettingsScreen.tsx:22-97`); this is a full rewrite of the screen (not the store). |
| **Conditional privacy copy** in the 3 places | `SettingsScreen.tsx:42`, `App.tsx` rail chip, `OnboardingFlow.tsx` privacy pane (`34` §6) | Driven off the DTO; a **computed truth**, not a slogan. |
| **`SettingsDto` builder** feeds from `getAllSafe()` + typed accessors, adds `hasApiKey`, `aiEnabled`, `sttProvider`, `ttsProvider`, per-feature `lastUsed`/consent booleans, `spendEstimate` (`34` §9) | `core/types/ipc` + the settings IPC handler | Still **never** returns the ciphertext (the `16` §6 destructure stays). |

`RISK (medium)` — the `SettingsUpdate`→`Partial<SettingsDto>` switch touches every settings
call site (`ipc.updateSettings`, `SettingsScreen` onUpdate, `useSettings`). *Mitigation:* it is
a mechanical type change; the contract test (`34` §10) and typecheck catch drift.

---

## Files expected to change

| File | Change |
| --- | --- |
| `src/features/settings/SettingsScreen.tsx` | Full rewrite to the new IA using shared primitives. |
| `src/features/settings/sections/*.tsx` | **NEW** — `IntelligenceSection`, `ProvidersSection`, `VoiceSection`, `ConsentSection` (+ kept Privacy/Reminders/WindowTray/Danger/About as composed sections). |
| `src/components/settings/*` | **NEW** — `Section`, `SettingRow`, `Toggle`, `SecretField`, `ProviderSelect`, `ConsentModal` (`34` §8). |
| `src/lib/ipc.ts` | delete `SettingsUpdate`; derive patch type; add typed wrappers for the (existing) key IPC + `tts:preview`. |
| `electron/database/settings-repository.ts` | add `getBool/getNumber/getEnum`; add new keys to `SETTING_DEFAULTS`. |
| `core/types/ipc.ts` | enrich `SettingsDto` (typed fields + cloud status fields); single source of truth. |
| `electron/main/ipc/settings.ts` | DTO builder assembles the richer DTO from `getAllSafe()` + accessors + spend arithmetic; still strips ciphertext. |
| `src/App.tsx` | rail chip privacy copy conditional on the DTO. |
| `src/features/onboarding/OnboardingFlow.tsx` | privacy pane copy reconciled (`34` §6). |
| `src/features/settings/voice/*` | Voice picker + Preview/Play Sample/Save/Cancel/Reset wiring (`35` §4). |

---

## New folders

- `src/components/settings/` — the shared primitives (`Section`, `SettingRow`, `Toggle`,
  `SecretField`, `ProviderSelect`, `ConsentModal`). `MVP DECISION` — these live under
  `components/` (not `features/settings/`) because `34` §8 requires them to be **shared with the
  conversation + voice UIs**, not settings-only.
- `src/features/settings/sections/` — one file per IA section, composed by `SettingsScreen`.

---

## New services

- **`SpendEstimator`** (main-side helper, pure arithmetic) — `call counters × published
  per-call cost` for a **local, optional monthly estimate** (`32` §6, `34` §3.3). **No network**
  — reads local counters only, feeds `spendEstimate` into the DTO.
- No new provider, no new network service. Everything else EP-8 needs already exists (EP-1…EP-4).

`MVP DECISION` — the spend estimate is **local arithmetic, clearly labelled "estimate."** It
never calls OpenAI's billing API (that would itself be network/consent surface) — it multiplies
counters we already stamp on each successful cloud call (`stt_last_used_at` et al., `34` §3.3).

---

## IPC changes

`MVP DECISION` — **No new IPC channels.** All three key channels and the voice channels already
exist (EP-1 / EP-4). EP-8 changes the **`settings:get` DTO shape only**:

| Channel | Kind | EP-8 change |
| --- | --- | --- |
| `settings:get` | invoke | DTO enriched: `hasApiKey`, `aiEnabled`, `sttProvider`, `ttsProvider`, per-feature `lastUsed`, per-feature `consented` booleans, `spendEstimate`, `keyState` (`no-key`/`saved`/`rejected`). **Still never returns the ciphertext** (`16` §6, `34` §9). |
| `settings:setApiKey` (EP-1) | invoke | unchanged; `SecretField` calls it. Write-only from the renderer's view. |
| `settings:clearApiKey` (EP-1) | invoke | unchanged; clears ciphertext **and** disables the three cloud toggles (`34` §3.1). |
| `settings:validateApiKey` (EP-1) | invoke | unchanged; one `GET /v1/models` with the stored key → `{ valid }`; result surfaces as `keyState`. |
| `settings:update` (existing) | invoke | payload type is now `Partial<SettingsDto>`-derived (`SettingsUpdate` deleted); handler still validates each key. |
| `tts:preview` / `tts:listVoices` (EP-4) | invoke | driven by the Voice section (`35` §9). |

`MVP DECISION` — flipping a cloud **enable toggle on for the first time** opens its consent modal
and the toggle does **not** persist until consent is accepted; enforcement is in **main** (`34`
§3.3, `32` §2), so a renderer cannot enable a feature without the recorded consent timestamp.

---

## Database changes

- **No table change.** New keys added to `SETTING_DEFAULTS` (`34` §7, `35` §8):
  `tts_provider` (`'web-speech'`), `tts_voice` (friendly key, default `'calm'`),
  `stt_consented_at` (`''`), `tts_consented_at` (`''`), `stt_last_used_at` (`''`),
  `tts_last_used_at` (`''`), and the local spend counters (`stt_calls`, `tts_calls`,
  `chat_calls`, default `'0'`). Existing orphans (`tts_voice_id`, `tts_rate`, `tts_degraded`,
  `stt_provider`, the `ai_*` family) are already seeded (`settings-repository.ts:6-27`) and now
  fully wired.
- **`ai_key_ciphertext` handling unchanged** — written only via `settings:setApiKey`
  (`safeStorage`), never returned by `getAllSafe()`/the DTO (`settings-repository.ts:61-69,71-73`).
- **`seedDefaults()` is idempotent** (`settings-repository.ts:34-45`) — new keys backfill on the
  next startup for existing users; forward-only, no migration needed.

`MVP DECISION` — the LLM `settings` action may reach only the **closed safe subset** (`theme`,
`tts_enabled`, `reminders_paused`, `voice`) via the `SettingsAction` union (`34` §7, `36` §4.2).
It can **never** touch `ai_key_ciphertext`, any consent timestamp, `ai_assist_enabled`, or a
provider selection — Yogi cannot enable its own cloud access or read its own key. EP-8 must keep
this schema restriction (test in §Manual/§Regression).

---

## UI changes

New IA (`34` §2), top to bottom:

1. **Privacy** *(kept)* — offline copy + "Open data folder" + a **live status line** ("Currently:
   fully on-device" / "Currently: OpenAI enabled for Conversation, Voice") derived from the DTO
   (`34` §6).
2. **Yogi's intelligence** *(NEW, master gate, `34` §3)* — `SecretField` (Add key / •••• Update /
   Remove / Validate, three states: *No key · Key saved ✓ · Key rejected*); three enable toggles
   (Conversation / Speech-to-text / Voice), each opening its `ConsentModal` on first-on; Last-used
   per feature + monthly spend estimate + **Manage consent** link.
3. **Providers** *(NEW, `34` §4)* — `ProviderSelect` radios: STT (Offline-Sherpa • / OpenAI),
   TTS (Windows • / OpenAI). **Disabled + dimmed** until a valid key + the feature's enable
   toggle + consent, with helper text "Add an OpenAI key and enable this feature above."
4. **Voice** *(NEW, `35`)* — friendly voice picker (Soft Female, Warm Female, Calm, Professional
   Male, Energetic, Storyteller, Clear Male, Friendly), grouped Online/Offline by active
   provider; rate slider **Slow ─●─ Fast**; **Preview / Play Sample** (cost hint + debounced);
   **Save / Cancel / Reset**.
5. **Speech** *(kept)* — "Speak reminders aloud" toggle; the §6 conditional copy replaces the
   `SettingsScreen.tsx:42` line.
6. **Reminders / Window & tray / Danger zone / About** *(kept verbatim)*.

`MVP DECISION` — Providers/Voice are **visually dimmed and inert until a valid key is present**
(`34` §2). The dependency (key → consent → provider) is made legible rather than letting a user
select a provider that silently can't run.

---

## Main process changes

- **DTO builder** assembles the richer `SettingsDto` from `getAllSafe()` + typed accessors +
  `SpendEstimator`; still strips `ai_key_ciphertext` (`34` §9, `16` §6).
- **Consent enforced in main** — `settings:update` on an enable toggle checks the corresponding
  consent timestamp is present; missing → the enable does not persist (`34` §5, `32` §2).
- **Revoke is authoritative** — clearing a consent timestamp turns the feature off **and** reverts
  its provider to offline (factory re-run, `33` §5), not cosmetic (`34` §5).
- **`clearApiKey` cascades** — clearing the key disables all three cloud toggles (`34` §3.1).
- **`safeStorage` unavailable path** (already built EP-1, `32` §3.3, `34` §3.2) — surfaced in the
  UI: refuse to persist, offer "keep for this session only," one-line explanation. EP-8 adds the
  copy, not the mechanism.
- **Per-feature `*_last_used_at`** stamped after each successful cloud call (already wired EP-3/4;
  EP-8 reads them into the DTO).

---

## Renderer changes

- The new sections + the six shared primitives (`34` §8).
- `useSettings` unchanged in shape; the DTO is richer and drives everything (conditional copy,
  dimmed states, key/consent state).
- The three **privacy-copy** locations become conditional on the DTO (`34` §6):
  `SettingsScreen` Speech line, `App.tsx` rail chip ("On-device" vs "OpenAI enabled"),
  `OnboardingFlow` privacy pane.
- `SecretField` — **empty on focus**, never pre-filled with a decrypted value, never round-trips
  a value; shows saved/rejected state only (`34` §3.1, `16` §6).
- Voice section wires Preview/Play Sample/Save/Cancel/Reset to `tts:preview` + `settings:update`.

`MVP DECISION` — Save/Cancel/Reset semantics for Voice: the picker edits a **local draft**;
**Save** persists `tts_voice` + resolved `tts_voice_id` + `tts_rate`; **Cancel** discards the
draft; **Reset** restores defaults (`calm`, rate `1.0`) (`35` §8). Preview always uses the
*current draft*, so the user hears exactly what Save will store.

---

## Provider changes

- **None new.** EP-8 exposes provider **selection** (radios writing `stt_provider`/`tts_provider`)
  over the factory that already exists (`33`, EP-1/3/4). No new provider, no new origin — the
  OpenAI allowlist/CSP is exactly as EP-1 set it (`32` §3.2). `FUTURE OPTION` — ElevenLabs, Piper,
  Deepgram, Ollama each add a **radio option** behind the same factory, not a rewrite (`34` §4).
- Selecting an OpenAI provider **requires** the matching enable toggle + consent; the factory
  re-runs live on change (no restart, and the fix for the dead `aiAssistEnabled` seam, `30` D1 /
  `32` §3.1 — already done EP-1).

---

## Security considerations

`RISK` — Settings is the surface that holds the key and the consent gates, so EP-8's security
bar is high even though it adds no new capability:

- **API key never crosses IPC** — `settings:get` (even the enriched DTO) returns no `sk-`, no
  ciphertext; only `hasApiKey`/`keyState` booleans (`34` §9, `16` §6, `41` §8.4). The
  `getAllSafe()` destructure stays (`settings-repository.ts:61-69`).
- **Renderer isolation** — `SecretField` is write-only from the renderer's view; it never holds
  or displays a real key value; empty on focus (`34` §3.1).
- **No provider credentials returned to renderer** — the DTO exposes provider *selection*, never
  a key or a decrypted secret.
- **No secrets in logs** — the `sk-` redaction in `logger.ts` retained (`32` §3.3, `30` §2).
- **No secrets in SQLite in plaintext** — only `safeStorage` ciphertext; `safeStorage`
  unavailable ⇒ refuse-persist, never write plaintext (`34` §3.2, §11).
- **LLM `settings` action restricted to the safe subset** — schema makes keys/consent/provider
  unreachable (`34` §7, `36` §4.2).
- **Consent revocation authoritative in main** (`34` §5); the renderer cannot re-enable a
  feature without a recorded consent timestamp.
- **Portable build** — ciphertext lives in the portable data dir; DPAPI is user-scoped so a
  copied folder can't decrypt on another account (`34` §11, `09` §7) — restate in Privacy copy.

---

## Performance considerations

- **DTO build** adds spend arithmetic (a few multiplications) + typed-accessor reads — negligible
  vs the existing `getAllSafe()` `SELECT` (`30` §6).
- **Voice `tts:listVoices`** round-trip is cached after first enumeration (`voiceschanged`
  pattern, `35` §3) — no repeated OS calls.
- **Preview debounced** (one in-flight, `35` §4) — bounds both cost and audio-window load.
- **Validate** is one cheap `GET /v1/models` on demand, never on render (`34` §3.1).
- **No new SELECTs on the hot path**; the settings screen is not polled.

---

## Risks

- `RISK (high, reputational)` — **privacy copy left un-reconciled** in one of the 3 places →
  the app asserts "offline" while cloud is on. *Mitigation:* all three driven off one DTO field;
  a Manual + Regression test asserts each location flips (`34` §6).
- `RISK (medium)` — **`SettingsUpdate` deletion breaks call sites.** *Mitigation:* mechanical
  type change; typecheck + the `settings:get`-leaks-nothing contract test gate it (`34` §10).
- `RISK (medium)` — **a user selects an OpenAI provider that can't run** (no key/consent).
  *Mitigation:* radios dimmed + helper text; enforcement in main (`34` §2, §4).
- `RISK (low)` — **voice friendly-label drift** vs OpenAI's actual roster. *Mitigation:*
  data-driven catalog, runtime validation, `alloy` fallback (`35` §2, §14) — inherited from EP-4.
- `RISK (low)` — **spend estimate misleads.** *Mitigation:* labelled "estimate," local-only,
  clearly per `32` §6.

---

## Rollback strategy

`MVP DECISION` — EP-8 is UX; rollback is **section-level**, not code-revert (`35` §15 pattern):

- If a new section regresses, **hide that section** (feature-gate per section) — the kept
  sections (Privacy/Speech/Reminders/Window&tray/Danger/About) still render and the app is
  usable.
- If the **Voice picker** regresses, hide the Voice section → reminders still speak in the
  default voice (`35` §15).
- If provider selection regresses, hide Providers → the factory falls back to the setting's
  current value (offline default).
- The **key mechanism, encryption, and network seam are EP-1 code untouched by EP-8**, so a
  Settings-UX regression can never expose a key or open the network — the security envelope does
  not depend on this phase.
- With all cloud off, the redesigned Settings is indistinguishable from the offline MVP (`34`
  §12.8), so the offline app is never at risk.

---

## Definition of Done

Re-asserts `41` §8 invariants, plus `34` §12 / `35` §16:

1. **`41` §8.1** — full offline reminder loop works with all cloud off; Settings looks like the
   offline MVP.
2. **`41` §8.2** — Wireshark: **zero** outbound packets with all cloud off (Validate/Preview not
   pressed) — EP-8 adds no automatic network call.
3. **`41` §8.4** — API key never crosses IPC; `settings:get` (enriched DTO) leaks nothing
   (contract test green — `34` §10, `16` §6).
4. **`41` §8.5** — LLM `settings` action reaches only the safe subset (test green).
5. `SettingsUpdate` duplication removed; one `SettingsDto` source of truth; typed accessors
   (`34` §12.1).
6. `safeStorage`-unavailable path surfaced (refuse-persist + session-only), no plaintext written
   (`34` §12.3).
7. Per-feature enable + consent + revoke work, enforced in main; provider selection reads real
   settings and switches live (`34` §12.4).
8. Privacy copy conditional in all 3 locations; the status line matches the switches
   (`34` §12.5).
9. The six shared primitives exist and are reused by conversation + voice UIs (`34` §12.6).
10. Voice: friendly labels map to provider ids and survive a provider switch; Preview works for
    both providers; Save/Cancel/Reset work (`35` §16).
11. Phase test checklist green; `53` §8 regression suite green (`41` §11).

---

## Feature Checklist

**Already completed (EP-1…EP-7 — reused, NOT re-implemented):**
- `safeStorage` key mechanism + `settings:setApiKey/clearApiKey/validateApiKey` (EP-1, `32` §3.3).
- `cloudEnabled()` predicate + session re-install on `settings:changed` (EP-1, `32` §3.1).
- OpenAI allowlist + CSP one-origin extension (EP-1, `32` §3.2).
- Provider factory keyed on `stt_provider`/`tts_provider` (EP-1/3/4, `33` §5).
- `tts:preview`/`tts:listVoices`/`audio:playBytes` + voice catalog (EP-4, `35`).
- Per-feature `*_last_used_at` stamping (EP-3/4).
- Minimal enable toggles used to test EP-3/4/5.

**New work (this phase):**
- New IA + `SettingsScreen` rewrite; per-section files.
- Six shared primitives (`Section`, `SettingRow`, `Toggle`, `SecretField`, `ProviderSelect`,
  `ConsentModal`).
- Friendly-label voice picker + Preview/Play Sample/Save/Cancel/Reset.
- Consent-management subview + revoke + Last-used + local spend estimate.
- Privacy-copy reconciliation in all 3 places + Privacy status line.
- `SettingsUpdate` deletion → `Partial<SettingsDto>`; typed accessors; enriched DTO.
- New settings keys (`tts_provider`, `tts_voice`, consent/last-used/spend counters).

**Deferred work:**
- `voice_confirm_enabled` toggle placement is **shipped here** (EP-7 deferred its UX to EP-8);
  any advanced voice tuning UI → EP-11.
- Memory / research settings surfaces → EP-9 / EP-10 add their own sections behind this IA.

**Future work (`FUTURE OPTION`):**
- ElevenLabs / Piper / Deepgram / Ollama provider radios (`34` §4).
- Detailed per-model selection UI; billing-API-backed spend (would add network/consent).
- Import/export of settings; per-profile settings.

---

## Manual Testing

### Settings testing

| # | Step / Action | Expected Result |
| --- | --- | --- |
| 1 | Open Settings with **no key**. | Yogi's intelligence shows "No key"; Providers/Voice **dimmed**; Privacy status line "fully on-device"; Speech copy is the offline line. |
| 2 | **Enable OpenAI**: paste a valid key → Save. | `SecretField` shows "•••• Key saved ✓"; field empty on focus; toggles become available. |
| 3 | **Validate** the key (mock 200). | State → "Key saved ✓ / valid"; one `GET /v1/models` only. |
| 4 | Validate an invalid key (mock 401). | State → "Key rejected"; cloud toggles do not enable. |
| 5 | **Remove** the key. | `hasApiKey` false; all three cloud toggles turn off; Providers/Voice dim again. |
| 6 | Flip **Conversation** on. | Consent modal opens; toggle does **not** persist until Accept; after Accept, `ai_assist_enabled` true. |
| 7 | **STT provider → OpenAI** (after enabling STT + consent). | Radio selectable; factory re-runs live; dictation now uses OpenAI (traffic to `api.openai.com` only). |
| 8 | **STT provider → Offline**. | Reverts to Sherpa; no network. |
| 9 | **TTS provider → OpenAI** vs **Windows**. | Switches live; reminders speak via the selected engine. |
| 10 | **Voice**: pick "Warm Female". | Stored as friendly key `warm_female`; resolves to `nova` (OpenAI) internally (`35` §2.1). |
| 11 | **Preview / Play Sample**. | Hears "This is Yogi. Nice to meet you." in the chosen voice + rate; subtle "uses your OpenAI key" hint; debounced. |
| 12 | Drag rate to Fast → Preview. | Same voice, faster. |
| 13 | **Save**. | `tts_voice` + resolved `tts_voice_id` + `tts_rate` persist; survive a provider switch. |
| 14 | **Cancel** after changing voice. | Draft discarded; prior voice retained. |
| 15 | **Reset**. | Voice → `calm`, rate → 1.0. |
| 16 | **Manage consent** → **Revoke** Voice. | `tts_consented_at` cleared; TTS provider reverts to Windows; feature off; one notice. |
| 17 | Enable all cloud → check **Privacy status line** + rail chip + onboarding copy. | Status line names enabled features; rail chip "OpenAI enabled"; onboarding pane uses the conditional copy (`34` §6). |
| 18 | Turn all cloud **off**. | Settings indistinguishable from the offline MVP; offline copy restored. |

### Security testing

| # | Step / Action | Expected Result |
| --- | --- | --- |
| S1 | Inspect `settings:get` DTO after saving a key. | No `sk-`, no `ciphertext`, no plaintext key; only `hasApiKey`/`keyState` (`34` §10, `16` §6). |
| S2 | Attempt to read the key from the renderer / `SecretField`. | Impossible — write-only; field empty on focus; no getter exists (`34` §3.1). |
| S3 | Inspect the SQLite `settings` table after Save. | `ai_key_ciphertext` holds **safeStorage ciphertext**, never plaintext. |
| S4 | Force `safeStorage.isEncryptionAvailable()` = false → Save a key. | `setApiKey` refuses; row stays empty; session-only option offered; **no plaintext written** (`34` §12.3). |
| S5 | Grep `app_logs` / stdout after a cloud call. | No `sk-`; the `sk-` redaction held (`32` §3.3). |
| S6 | Craft an LLM `settings` action targeting `ai_key_ciphertext` / a consent key. | Rejected by the schema (unreachable union member, `34` §7, `36` §4.2). |
| S7 | Confirm provider credentials returned to renderer. | Never — DTO exposes selection only, no secret. |
| S8 | Renderer isolation: verify `SecretField` never exposes a value via props/state dump. | No value present (jsdom test, `34` §10). |

---

## Edge Cases

- **Key present but consent later revoked** → provider reverts to offline mid-session (factory
  re-run), no crash, one notice (`34` §11).
- **`safeStorage` becomes unavailable between sessions** → stored ciphertext undecryptable →
  treat as "key rejected," prompt re-entry, never crash (`34` §11).
- **Enable OpenAI STT but mic/network fails at capture** → offline sherpa not retroactively usable
  for that utterance; ask to repeat/type (`34` §11, `32` §5).
- **Empty/whitespace/malformed key** (< 20 chars) → rejected at the `z.string()` gate before any
  network call (`34` §11, `32` §4).
- **Zero OS voices installed** (Windows TTS) → Voice picker + Preview disabled with a link to
  Windows speech settings; "Speak reminders aloud" disabled; reminders still notify (`35` §7).
- **Unknown/renamed OpenAI voice id** → falls back to `alloy`; picker doesn't hard-fail (`35` §2).
- **Provider switched while a Preview is in flight** → in-flight preview cancelled (`35` §13).
- **Existing user upgrades** → `seedDefaults()` backfills the new keys idempotently; prior
  settings preserved (`settings-repository.ts:34-45`).

---

## Failure Cases

- **Validate hits a network error** (not 200/401) → surfaced as "couldn't reach OpenAI to
  validate," key state unchanged, no crash (`32` §5).
- **`setApiKey` fails to encrypt** → refuse-persist, coded error surfaced, offer session-only
  (`34` §3.2); nothing written.
- **`settings:update` on an enable toggle without consent** → does not persist; UI reflects the
  un-flipped state (`34` §5, `32` §2).
- **Preview TTS call fails** → degrade to Windows voice or explain "add a key"; `tts_degraded`
  set; notification path unaffected (`35` §7).
- **Spend counter corrupt/missing** → estimate shows "—"/"Never," never crashes (`32` §6).
- **DTO build throws** → the settings IPC returns a sanitised `Result` error; the screen shows a
  fallback, no stack across IPC (`16` §5).

---

## Recovery Tests

1. Save key with `safeStorage` off → refused → enable `safeStorage` → Save → succeeds; verify no
   plaintext was ever written in between.
2. Revoke consent mid-session while OpenAI TTS is speaking → provider reverts to Windows → next
   reminder speaks offline. Recovery: no crash, feature off, one notice.
3. Corrupt the stored ciphertext (simulate cross-account portable copy) → treated as rejected →
   re-enter key → works. Recovery: prompt-and-recover, never crash (`34` §11).
4. Change voice, app crashes before Save → relaunch → prior voice intact (draft not persisted).
5. Toggle STT to OpenAI, kill network → dictation degrades to sherpa on next utterance → Settings
   still shows the selection; provider selection is not lost. Recovery: graceful.

---

## Regression Tests

Per `41` §11 / `53` — EP-8 must keep these green:

1. **Full offline reminder loop** — create → confirm → schedule → notify + speak, **no key**,
   through the redesigned Settings; indistinguishable from the offline MVP (`34` §12.8).
2. **Confirmation gate** — the safe-settings carve-out (theme/speak-aloud/pause/voice) still
   applies optimistically with Undo; keys/consent/provider are **not** in the carve-out
   (`36` §4.2, `30` §13.1).
3. **Wireshark off → zero** — 30-minute capture, all cloud off, navigating every Settings section
   (without pressing Validate/Preview) → **zero** outbound packets (`32` §8.3, `41` §8.2).
4. **Key never leaks (`settings:get`)** — the enriched DTO returns no `sk-`, no ciphertext,
   `hasApiKey` correct — mandatory even if a cloud feature is cut (`34` §10, `09` §11).
5. **LLM `settings` action** — a `SettingsAction` targeting a key/consent/provider is rejected by
   the schema (`34` §7).
6. **Consent gating** — flipping a toggle without accepting consent does not persist; revoking
   flips the feature off and reverts the provider (`34` §10).
7. **Voice plumbing** — `trigger-sink` sends `{text, voiceId, rate}`; the chosen voice actually
   speaks (the dead `voiceId`/`rate` fix from EP-4 stays fixed, `35` §16).
8. **Scheduler/notification fan-out** — unchanged; notification + history first (`30` §13.4).

---

## Performance Tests

1. **Settings open** → DTO build + first render < 100 ms (no network, no polling).
2. **`tts:listVoices`** enumerated once, cached; second open uses cache (no OS re-enumeration).
3. **Preview debounce** — mash Preview 5× → at most one in-flight, one plays; no cost spike
   (`35` §12.7).
4. **Validate** — single `GET /v1/models`, ≤ 1 network call per press, never on render.
5. **Spend estimate** — pure arithmetic, < 1 ms; no network.
6. **DTO enrichment** adds no measurable cost vs the pre-EP-8 `getAllSafe()` read (`30` §6).

---

## Expected App Behaviour (Current → EP-8)

```text
Current (end of EP-7):
  Settings = 6 bespoke <section> blocks; "run entirely offline" line is now FALSE when cloud on;
  key/consent/provider surfaced minimally by EP-1/3/4; SettingsDto duplicated by SettingsUpdate.

EP-8:
  Settings = new IA (Privacy · Yogi's intelligence · Providers · Voice · Speech · Reminders ·
             Window&tray · Danger · About) built from shared primitives.
  no key  → Providers/Voice DIMMED; Privacy status "fully on-device"; offline copy.
  add key → Validate → toggles enabled → enable Conversation/STT/Voice (each: consent modal
            → persists only on Accept) → pick provider (radio, live factory re-run)
            → pick friendly voice → Preview → Save.
  cloud on → Privacy status names the enabled features; rail chip "OpenAI enabled";
             onboarding copy conditional. NO absolute-offline claim while any toggle is on.
  revoke  → consent timestamp cleared → feature off → provider reverts offline (main-authoritative).
  cloud off again → Settings indistinguishable from the offline MVP.
  Throughout: key never crosses IPC; DTO leaks nothing; LLM settings limited to the safe subset.
```

---

## Conversation Testing

Settings-relevant conversational surface (the LLM `settings` safe-subset carve-out, `36` §4.2):

- **User:** "Switch to dark mode."
  **Expected:** `settings` action (safe subset) applies optimistically with inline "Done ✓ · Undo"
  — the one carve-out from pre-confirm (`36` §4.2); theme changes live.
- **User:** "Turn on speak-aloud."
  **Expected:** `tts_enabled` flips via the safe-subset action + Undo; no card.
- **User:** "Use my OpenAI key for voice." / "Enable OpenAI."
  **Expected:** **Refused** conversationally — enabling a cloud feature / touching keys/consent/
  provider is **not** in the safe subset; Yogi replies "You can enable that in Settings →
  Yogi's intelligence" and cannot do it itself (`34` §7, `36` §7).
- **User:** "What's my API key?"
  **Expected:** Yogi cannot read it (key never crosses IPC; the model never sees it); replies it
  can't show keys.
- **User:** "Change my voice to Warm Female."
  **Expected:** `voice` is in the safe subset → applied with Undo; the friendly key `warm_female`
  is stored (`35` §1).
- **User (all cloud off):** "Are you sending my data anywhere?"
  **Expected:** honest "No — everything is on-device" (matches the computed Privacy status line,
  `34` §6).

---

## Voice Testing

EP-8 owns the **Voice-section** testing (the picker + preview path, `35` §12); the yes/no
confirmation matcher is EP-7's (`48`). Coverage:

| # | Action | Expected |
| --- | --- | --- |
| 1 | OpenAI TTS on, pick "Warm Female" → Preview. | "This is Yogi. Nice to meet you." in `nova`; "uses your OpenAI key" hint (`35` §12.1). |
| 2 | Drag rate → Fast → Preview. | Same voice, faster (`35` §12.2). |
| 3 | Save, then create a 1-minute reminder. | At fire, Yogi speaks the title in the chosen voice + rate (the dead-plumbing fix, `35` §12.3). |
| 4 | Switch TTS → Windows; Preview + a reminder. | Offline OS voice; **no network** (`35` §12.4). |
| 5 | Remove the key, keep TTS = OpenAI. | Preview explains it needs a key; reminders speak in the Windows voice; one "using Windows voice" notice (`35` §12.5). |
| 6 | VM with no OS voices, TTS = Windows. | Voice picker + Preview disabled with a link to Windows speech settings; reminders still notify (`35` §12.6). |
| 7 | Mash Preview 5× fast. | Debounced — at most one plays; no cost spike (`35` §12.7). |
| 8 | Pick "Warm Female" on OpenAI, then switch provider to Windows. | Friendly key `warm_female` persists; resolves to the closest OS voice via `windowsMatch`; selection not lost (`35` §1, §3). |
| 9 | Play Sample with an unknown/renamed OpenAI voice id. | Falls back to `alloy`, still plays; no hard-fail (`35` §2). |
| 10 | Save → Cancel → Reset cycle. | Save persists; Cancel discards the draft; Reset restores `calm` + rate 1.0. |

`MVP DECISION` — Preview always exercises the **real** speaking path (`audio:playBytes` for
OpenAI, `tts:speak` honouring `voiceId` for Windows, `35` §4), so a passing Preview is genuine
evidence reminders will speak correctly — not a mock.
