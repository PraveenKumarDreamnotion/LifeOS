# 42 — Execution Phase EP-1: Project Cleanup & Seams

> **EP-1 · ships in v0.2 · offline · NO new user feature.** This is the deliberately
> boring phase. Its entire job (per `41` §4.5) is to pay the `30`-audit tech debt and stand
> up the provider/key/network seams so every later phase plugs into clean interfaces. When
> EP-1 is done the app behaves **exactly** like today's offline MVP — same screens, same
> reminder flow, same zero-network posture — but the scaffolding underneath is real instead
> of orphaned. Authority for build order is `41`; this doc executes `41` §4.2/§4.5 line by
> line. Testing ownership per `41` §11 (this doc owns the EP-1 checklist; `53` aggregates).

---

## Objective

Refactor-only. Extract the three provider interfaces + factory (`33`), fix the dead network
seam (`30` D1), build the `safeStorage` API-key **mechanism** + its IPC, add a **minimal**
OpenAI settings section (the full Settings UX redesign is EP-8 — `41` §5), consolidate the
speech IPC onto `guard()`, delete the dead speech/audio plumbing, and clear the small
cleanups (D2/D3/D6/D9). End state: byte-identical user behaviour, Wireshark-clean by default,
96 existing tests still green plus new provider-factory and key-IPC tests.

## Why this phase exists

`30` §3.2/§5 found the load-bearing gaps: the provider abstraction was *designed into the DB*
(`stt_provider`, `tts_*`, the `ai_*` family in `SETTING_DEFAULTS`) but **never built in
code**; the network seam is **dead** (`electron/main/index.ts:61` hardcodes
`settingsProbe = { aiAssistEnabled: () => false }` and never re-installs against real
settings, so the CSP `connect-src` extension and the `api.openai.com` allow-branch are
unreachable — `30` D1); the API key + `safeStorage` code **does not exist anywhere** (`30`
§12 — `settings.setApiKey`/`clearApiKey` are aspirational in `09`/`16`); and the speech
pipeline carries dead `onFinal`/`voiceId`/`rate`/`audio:ready`/`audio:error` plumbing plus a
second, hand-rolled origin check that bypasses `guard()` (`30` D4/D8). EP-3 (STT), EP-4 (TTS),
and EP-5 (LLM) all block on these seams. `41` §4.5 mandates paying this debt **before** any
new feature so each later phase plugs into a clean interface rather than re-opening the same
files. EP-1 is intentionally a no-new-user-feature phase for exactly this reason.

## Current code that will be reused

Reused **unchanged** (the `30` §13 / `41` §4.1 "do not touch" list):

- `electron/scheduler/scheduler.ts`, `trigger-sink.ts` — wall-clock scheduler + reliability
  fan-out. Reminder *lifecycle* is orthogonal to this phase.
- `electron/notifications/notifier.ts`, `electron/tray/tray.ts` — notification stays
  unconditional-and-first (`30` §2.4).
- `electron/database/*` driver, migrations 001/002, repositories, `CreateReminderInput` +
  business rules — the trusted writer, untouched.
- `core/parsing/*`, `core/scheduling/next-occurrence.ts` — the reminder parser + occurrence
  math (only the `rrule.ts`/`format.ts` grammar **dedup** D2 touches `core/`).
- `src/hooks/useSpeech.ts`, `src/features/chat/MicButton.tsx`, `src/features/chat/ChatScreen.tsx`
  — **ChatScreen is left as the single-shot parse→card screen in EP-1** (its rewrite is EP-2).
- The secure `webPreferences`, navigation locks, default-deny network, CSP builder in
  `electron/main/session.ts` — **extended at one seam** (bind CSP/allowlist to real settings),
  never weakened (`30` §13.3).
- `SherpaSpeechService` (`electron/speech/sherpa-speech-service.ts`) — kept; it becomes the
  offline `SpeechProvider` implementation behind the new interface (its public surface
  `start`/`pushAudio`/`stop`/partials is the de-facto interface, `33` §2).
- The audio window (`src/audio-host.ts`) `speechSynthesis` path — kept as the offline
  `TextToSpeechProvider`; only its SPIKE diagnostics and dead `onPlay(file)`-adjacent noise
  are cleaned (the new `audio:playBytes` path is EP-4, not here).

## Code that must be refactored

| Refactor | Location | `30` ref |
| --- | --- | --- |
| Extract `SpeechProvider` / `TextToSpeechProvider` / `LlmProvider` interfaces | new `core/speech/`, `core/tts/`, `core/llm/` | §5.1, `33` |
| Provider **factory + fallback decorator** keyed on existing settings | new `electron/providers/registry.ts` | `33` §5 |
| Dead `aiAssistEnabled:()=>false` probe → live, re-installable predicate | `electron/main/index.ts:61-62`, `electron/main/session.ts` | D1 |
| `safeStorage` key mechanism + IPC (`setApiKey`/`clearApiKey`/`validateApiKey`) | new `electron/services/api-key-store.ts`, `electron/main/ipc/index.ts`, preload, `channels.ts` | §12 |
| Consolidate speech IPC onto `guard()`; delete inline origin checks | `electron/main/ipc/speech.ts` | D4/D5 |
| Delete dead `onFinal` / `SPEECH_FINAL` end-to-end | `channels.ts`, `speech.ts`, `sherpa-speech-service.ts`, `preload/index.ts`, `useSpeech.ts` | D8 |
| Delete dead `voiceId`/`rate` on `tts:speak`; dead `audio:ready`/`audio:error` (no handler) | `electron/tts/*`, `src/audio-host.ts`, `preload/audio.ts` | D8 |
| Dedup RRULE grammar (`rrule.ts` is the one source; `format.ts` reuses it) | `core/scheduling/rrule.ts`, `core/time/format.ts` | D2 |
| Fix `last_triggered_at` stamped on missed-while-closed roll-forward | `electron/database/reminder-repository.ts` `setNextFireAt`, `electron/scheduler/scheduler.ts` | D3 |
| Strip SPIKE-3 / STT-DIAG diagnostics | `src/audio-host.ts`, `electron/speech/sherpa-speech-service.ts` | D9 |
| `SettingsDto`/`SettingsUpdate` dedup + typed accessors (`getBool`/`getNumber`/`getEnum`) | `core/types/ipc.ts`, `src/lib/ipc.ts:8`, `electron/database/settings-repository.ts` | D6 |

Explicitly **out of scope for EP-1** (deferred, seams stubbed only): `ChatScreen` rewrite
(EP-2), `parseReminder` demotion to dispatcher executor (EP-6), the `audio:playBytes` path
and real OpenAI providers (EP-3/EP-4/EP-5), the full Settings UX (EP-8).

## Files expected to change

**New**
- `core/speech/speech-provider.ts` — `SpeechProvider` interface + result/error types (`33` §2).
- `core/tts/tts-provider.ts` — `TextToSpeechProvider` interface + `TtsSpeakResult` (`33` §3).
- `core/llm/llm-provider.ts` — `LlmProvider` interface + `LlmTurnInput` (`33` §4, greenfield).
- `electron/providers/registry.ts` — `makeSpeechProvider`/`makeTtsProvider`/`makeLlmProvider`
  factories + `withFallback` decorator (`33` §5).
- `electron/providers/sherpa-speech-provider.ts` — wraps `SherpaSpeechService` to satisfy the
  interface (the only concrete provider EP-1 ships; cloud impls are later phases).
- `electron/providers/web-speech-tts-provider.ts` — thin adapter returning `{kind:'in-window'}`
  over the existing `tts:speak` path.
- `electron/services/api-key-store.ts` — `safeStorage` encrypt/decrypt of the OpenAI key,
  persisted as `ai_key_ciphertext`; decrypt happens **only in main** (`30` §13.6).
- `core/settings/typed-settings.ts` — the single `SettingsDto` source + typed accessors.
- `src/features/settings/OpenAiKeySection.tsx` — the **minimal** enable+key+validate+consent UI.
- Tests: `tests/electron/providers/registry.test.ts`, `tests/electron/services/api-key-store.test.ts`,
  `tests/electron/ipc/api-key-ipc.test.ts`, `tests/electron/session-rebind.test.ts`.

**Modified**
- `electron/main/index.ts` — replace the `settingsProbe` stub with a real predicate bound to
  `SettingsRepository`; wire the factory; register the key IPC; add the live re-install call.
- `electron/main/session.ts` — `installSessionSecurity` gains a re-installable predicate hook.
- `electron/main/ipc/speech.ts` — route through `guard()`; drop the two inline origin checks
  and `assertOurFrame`; use the provider from the factory instead of `new SherpaSpeechService`.
- `electron/main/ipc/index.ts` + `electron/main/ipc/guard.ts` — register the three key handlers.
- `core/types/channels.ts` — add `SETTINGS_SET_API_KEY`/`CLEAR_API_KEY`/`VALIDATE_API_KEY`;
  **remove** `SPEECH_FINAL`.
- `core/types/ipc.ts` — `SettingsDto` becomes the single source; add key-status field
  (`hasApiKey: boolean`) to the safe DTO.
- `src/lib/ipc.ts` — delete the duplicated `SettingsUpdate`; import from `core`; add
  `setApiKey`/`clearApiKey`/`validateApiKey` wrappers.
- `electron/preload/index.ts` — add `settings.setApiKey/clearApiKey/validateApiKey`; remove
  `speech.onFinal`.
- `electron/preload/audio.ts`, `src/audio-host.ts` — strip SPIKE-3 logs, dead `report`/`ready`
  noise scope, dead `voiceId`.
- `core/scheduling/rrule.ts`, `core/time/format.ts` — single RRULE grammar.
- `electron/database/reminder-repository.ts`, `electron/scheduler/scheduler.ts` — D3 fix.
- `electron/database/settings-repository.ts` — typed accessors; `getAllSafe` unchanged in
  intent (still excludes ciphertext) but returns via the typed DTO.
- `src/hooks/useSpeech.ts` — drop the `onFinal` subscription (final already comes from
  `stop()`'s return, `speech.ts:54`).
- `src/features/settings/SettingsScreen.tsx` — mount `OpenAiKeySection` (minimal).

## New folders

- `core/speech/` — STT provider interface (pure, ESLint-walled from electron/node).
- `core/tts/` — TTS provider interface.
- `core/llm/` — LLM provider interface + turn-input types.
- `core/settings/` — the single `SettingsDto` + typed accessors.
- `electron/providers/` — the factory, fallback decorator, and concrete providers (main-only;
  this is where `electron`/network live, `33` §5).

## New services

- **`ApiKeyStore`** (`electron/services/api-key-store.ts`) — `set(plaintext)` → `safeStorage.encryptString`
  → persist `ai_key_ciphertext`; `get()` → decrypt in main; `clear()`; `has()`. Decrypted
  plaintext **never** returns over IPC (`30` §13.6, invariant §8.4). Falls back to a refusal if
  `safeStorage.isEncryptionAvailable()` is false (no plaintext-on-disk fallback).
- **Provider registry** (`electron/providers/registry.ts`) — not a long-lived object; pure
  factory functions re-run on the relevant settings change (the same live-rebind that fixes D1).
  Ships only the offline concrete providers in EP-1; the cloud branches are stubs that later
  phases fill (`33` §5).

## IPC changes

**Added** (new `CH` entries — none exist today, `channels.ts:31-36` has no key channels):
- `settings:setApiKey` (invoke, renderer→main) — payload `{ key: string }`, Zod
  `.strict()`, guarded; stores ciphertext; returns `{ ok: true }` only (never echoes the key).
- `settings:clearApiKey` (invoke) — clears `ai_key_ciphertext`, resets consent timestamps,
  triggers the provider live-rebind.
- `settings:validateApiKey` (invoke) — the **one** user-initiated outbound call (see Security);
  main makes a minimal authenticated probe to `api.openai.com` and returns `{ valid: boolean }`.

**Removed** (dead, `30` D8):
- `speech:final` (`SPEECH_FINAL`) end-to-end — service `onFinal` callback, preload
  `speech.onFinal`, renderer subscription. Final text already comes from `speech:stop`'s
  return value (`speech.ts:54-56`).
- `voiceId`/`rate` fields on the `tts:speak` contract (accepted, sent by nobody, ignored by
  `speak()` — `audio-host.ts:89` already drops `voiceId`).
- `audio:ready`/`audio:error` — **sent by the audio window but have no `ipcMain.on` handler**
  (`30` D8); the send sites are removed, or (if EP-4 will need the reverse channel) left as a
  single documented TODO — EP-1 removes the dead send, EP-4 adds `audio:playbackError` properly.

**Consolidated:** `speech:start`/`speech:stop`/`speech:audio` move onto `guard()` — the inline
`new URL(event.senderFrame?.url ...).origin !== appOrigin` checks (`speech.ts:35,50`) and the
`assertOurFrame` copy (`speech.ts:18`) are deleted; `guard()` becomes the single origin +
envelope + sanitised-error path, closing S4 (raw `String(e)` leak, `30` §7).

## Database changes

**None.** No migration. `SETTING_DEFAULTS` already contains every key EP-1 reads
(`ai_key_ciphertext`, `ai_assist_enabled`, `ai_consent_accepted_at`, `stt_provider`, the
`tts_*` family — `settings-repository.ts:6-27`). EP-1 only starts *reading* the orphans and
*writing* `ai_key_ciphertext` via `safeStorage`. The dead `memories`/`conversations` tables
(migration 002) remain untouched (EP-2 adopts `conversations`; EP-9 adopts `memories`).

## UI changes

**Exactly one new surface, deliberately minimal** (full Settings UX is EP-8, `41` §5): a new
`OpenAiKeySection` mounted inside the existing `SettingsScreen`, containing only —
1. an **Enable OpenAI** toggle (writes `ai_assist_enabled`),
2. an **API key** input (masked; on save → `settings:setApiKey`; never re-displays the key,
   shows `hasApiKey` status + a **Clear** button),
3. a **Validate** button (→ `settings:validateApiKey`, shows valid/invalid),
4. a **per-feature consent** line with the honest network copy (`32` §3): saving a key or
   enabling does **not** by itself send anything; each cloud feature (STT/TTS/chat) is
   separately consented in its own phase.

No other screen changes. The Chat screen, Schedules, History, onboarding, and the "🔒 Local ·
Offline" rail chip (`App.tsx:61`) are **unchanged** — with no key entered, the app looks and
behaves identically to today. The rail-chip copy audit (`30` §3.1) is EP-8's job, not EP-1's.

## Main process changes

- **D1 fix (the headline):** delete `const settingsProbe = { aiAssistEnabled: () => false }`
  (`index.ts:61`). Instead build the predicate from the real `SettingsRepository`:
  `const aiEnabled = () => settings.get('ai_assist_enabled') === 'true' && settings.hasApiKey()`.
  Pass it to `installSessionSecurity(aiEnabled)`. Add a **live re-install** path so toggling
  the setting re-evaluates CSP/allowlist without a restart (`session.ts` reads the predicate on
  every `onHeadersReceived`/`onBeforeRequest` already — `session.ts:84,99` — so binding it to
  the live repo is sufficient; the re-install is the header refresh on the next navigation, and
  the allowlist check is live per-request). Document that `onHeadersReceived` re-runs per
  response, so the CSP updates on reload; the outbound allowlist updates immediately.
- Register the three key IPC handlers via the existing `registerIpcHandlers` path.
- Instantiate `ApiKeyStore(safeStorage, settings)` and hand `hasApiKey`/decrypt to the factory.
- Replace `registerSpeechHandlers(APP_ORIGIN)` internals so the service comes from
  `makeSpeechProvider(settings)` (still `SherpaSpeechProvider` in EP-1) and the handlers use
  `guard()`.
- No change to startup ordering (`index.ts:56-201`), scheduler, tray, notifier.

## Renderer changes

- `src/lib/ipc.ts`: delete the duplicated `SettingsUpdate` interface (`ipc.ts:8-15`), import
  the single `SettingsDto`/`SettingsUpdate` from `core`; add `setApiKey`/`clearApiKey`/
  `validateApiKey` wrappers.
- `useSpeech.ts`: remove the `onFinal` subscription (dead — final comes from `stop()`).
- `SettingsScreen.tsx`: mount `OpenAiKeySection`.
- No conversation UI, no message list — `ChatScreen.tsx` is untouched in EP-1.

## Provider changes

**This is EP-1's real substance.** Three interfaces extracted/created plus the factory:

- `SpeechProvider` (`33` §2) — `id`, `supportsPartials`, `isOffline`, `transport`,
  `init/start/pushAudio/stop/dispose`, `on('partial'|'error')`. The dead `on('final')` is
  **not** included (`33` §2 drops it). Implemented by `SherpaSpeechProvider`
  (`transport:'streaming'`, `supportsPartials:true`, `isOffline:true`).
- `TextToSpeechProvider` (`33` §3) — `id`, `isOffline`, `kind:'in-window'|'audio-bytes'`,
  `init/listVoices/speak/cancel/dispose`. Implemented by `WebSpeechTtsProvider`
  (`kind:'in-window'`). The `audio-bytes` path itself is EP-4; the interface field exists now.
- `LlmProvider` (`33` §4, greenfield) — interface + `LlmTurnInput` types only. **No concrete
  implementation in EP-1** (OpenAI LLM is EP-5); the factory returns a null/refusing provider
  when no key/consent, which is exactly today's behaviour.
- **Factory + `withFallback`** (`33` §5) — keyed on `stt_provider`/`tts_provider`/`ai_provider`;
  the offline provider is always the backup. In EP-1 every seam resolves to its offline
  provider because no cloud provider is enabled — so the factory is *installed and tested* but
  its cloud branch is dormant.

## Security considerations

- **Invariant §8.4 (headline for this phase):** the API key **never crosses IPC**. Renderer
  sends plaintext to main **once** on `setApiKey`; main encrypts via `safeStorage` and stores
  ciphertext; `getAllSafe` continues to exclude `ai_key_ciphertext` (`settings-repository.ts:65`);
  the safe DTO exposes only `hasApiKey: boolean`. Decrypt happens only in main, only at the
  moment of a cloud call. This closes S5 (`30` §7 — "protection is a convention") by making it
  structural: the store is the only decrypt site.
- **D1 is a prerequisite, not a nicety** (`30` §7): binding session security to the real
  predicate is what makes the allowlist meaningful. With no key + consent off, the predicate is
  `false`, so CSP `connect-src` stays `'self'` and `onBeforeRequest` blocks `api.openai.com` —
  the shipped default is byte-identical to today's zero-network app.
- Speech IPC on `guard()` closes S4 (raw-error leak).
- No new `child_process`/`eval`/dynamic import (invariant §8.7) — the ESLint wall is unchanged;
  `core/*` stays framework-free.

`MVP DECISION` — **The `validateApiKey` outbound call vs the "zero packets" invariant.** v0.2's
network posture is "zero" (`41` §7) and the DoD re-asserts §8.2 (zero outbound with cloud off).
These are reconciled explicitly: the **shipped default state** (no key, consent off, predicate
`false`) makes **zero** outbound calls — that is exactly what the Wireshark regression test
verifies. `validateApiKey` is the **single, discrete, user-initiated** call that happens *only*
after the user has typed a key and clicked Validate — i.e. after an explicit opt-in, gated by
the now-live D1 predicate and the per-feature consent gate (`32` §3). It is not background
traffic and cannot fire on its own. The invariant is "zero packets with cloud off," not "no
network code exists"; EP-1 satisfies it because *off* is the default and *off* is provably
silent.

## Performance considerations

Negligible by design — no new hot path. The factory functions are cheap and run at startup /
on settings change, not per interaction. `safeStorage` encrypt/decrypt is a one-shot at
key-save / cloud-call time. The D2 RRULE dedup removes one duplicated grammar walk. The D9
diagnostics removal takes the `[STT-DIAG]` counters out of the per-frame decode hot path
(`sherpa-speech-service.ts`) and the `[SPIKE-3]` `console.log` loop out of `audio-host.ts` — a
small, real win. The known main-thread SQLite/STT concerns (`30` §6) are **not** addressed here
(they are not blocking at MVP scale, `41` §4.3); flagged for EP-11.

## Risks

- `RISK (medium)` — **The D1 live-rebind is the most delicate change**: get the predicate
  binding wrong and either the app leaks network (predicate stuck `true`) or cloud never works
  (stuck `false`). Mitigation: a dedicated `session-rebind.test.ts` asserting CSP/allowlist flip
  with the setting, and the Wireshark off→zero / (later) on→openai-only check. The default is
  fail-safe (`false`).
- `RISK (medium)` — **`safeStorage` unavailability**: on a machine without OS-level encryption,
  `isEncryptionAvailable()` is false. Mitigation: the store refuses to persist a key (no
  plaintext-on-disk fallback) and the UI shows "secure key storage unavailable on this device."
- `RISK (low)` — **Deleting `SPEECH_FINAL` end-to-end** could break dictation if any consumer
  secretly relied on the broadcast. Mitigation: `speech.ts:54` comment already documents that
  the broadcast must NOT be used (double-apply bug); the renderer reads the `stop()` return.
  Covered by the dictation regression test.
- `RISK (low)` — **`SettingsDto` dedup churn** touches renderer + core + repo in lockstep (the
  exact D6 pain). Mitigation: typecheck + the full existing settings tests.

## Rollback strategy

`MVP DECISION` — **EP-1 has no feature flag** (`41` §10: EP-1 = none/internal). This is the
honest answer, not an omission: EP-1 ships **no user-visible surface** to toggle. The one new
UI (`OpenAiKeySection`) is inert until a user enters a key, and the network predicate defaults
`false`, so "rolled back" and "shipped" look identical to a user with no key. Rollback is
therefore a **code-level revert** of the internal seams. Two graded fallbacks reduce blast
radius: (1) if the D1 rebind misbehaves, hardcode the predicate back to `() => false` — one
line — restoring today's provably-offline behaviour while keeping every other cleanup; (2) if
`OpenAiKeySection` is problematic, unmount it from `SettingsScreen` — the mechanism (store +
IPC) stays, only the entry point is hidden. Because v0.2 must be published before any cloud
phase (`41` §3), a bad EP-1 blocks nothing downstream if reverted to the fail-safe predicate.

## Definition of Done

Re-asserting the `41` §8 invariants relevant to EP-1:

- **§8.1** The full offline reminder loop works (create → confirm → schedule → notify + speak),
  no key, byte-identical to v0.1.
- **§8.2** Zero outbound packets with cloud off (default state) — Wireshark-verified.
- **§8.3** The confirmation gate holds — the parse→card→Confirm reminder path is unchanged.
- **§8.4 (headline)** The API key never crosses IPC; `safeStorage` ciphertext at rest; decrypt
  only in main; safe DTO exposes only `hasApiKey`.
- **§8.6** Notification + history fire unconditionally and first.
- **§8.7** No `child_process`/`eval`/dynamic import outside the one allowlisted TTS file.

Plus EP-1-specific: three provider interfaces + factory + fallback compile and are unit-tested;
D1 predicate is live and re-installable (test proves the flip); dead `onFinal`/`voiceId`/`rate`/
`audio:ready`/`audio:error` removed with no behaviour change; speech IPC on `guard()`; D2/D3/D6/D9
resolved; **96 existing tests green + new provider-factory + key-IPC + session-rebind tests
green**; `npm run typecheck && npm run lint` clean.

## Feature Checklist

**Already completed (reused from v0.1, verified in `30`)**
- Secure `webPreferences`, navigation locks, default-deny `onBeforeRequest`, CSP builder.
- `getAllSafe` already excludes `ai_key_ciphertext`; `hasApiKey()` boolean already exists.
- `SETTING_DEFAULTS` already contains every `ai_*`/`stt_*`/`tts_*` key (orphaned).
- `SherpaSpeechService` public surface (the de-facto `SpeechProvider`).
- 96 automated tests (56 parser fixtures + 40).

**New work (EP-1)**
- `SpeechProvider`/`TextToSpeechProvider`/`LlmProvider` interfaces (`core/*`).
- Provider factory + `withFallback` decorator (`electron/providers/`).
- D1 fix: live, re-installable network predicate bound to `SettingsRepository`.
- `safeStorage` key mechanism (`ApiKeyStore`) + `setApiKey`/`clearApiKey`/`validateApiKey` IPC.
- Minimal `OpenAiKeySection` (enable + key + validate + per-feature consent).
- Speech IPC onto `guard()`; delete dead `onFinal`/`voiceId`/`rate`/`audio:ready`/`audio:error`.
- D2 RRULE dedup; D3 `last_triggered_at` fix; D6 `SettingsDto` dedup + typed accessors; D9 SPIKE strip.
- New tests: provider-factory, key-IPC, session-rebind.

**Deferred work (later EPs)**
- Conversation message-list UI + `useConversation` + `chat:*` — **EP-2**.
- Real `OpenAiSpeechProvider` (batch STT) — **EP-3**.
- Real `OpenAiTtsProvider` + `audio:playBytes` + voice catalog — **EP-4**.
- Real `OpenAiLlmProvider` + `ConversationEngine` + turn schema — **EP-5**.
- Action Dispatcher; `parseReminder` demoted to executor — **EP-6**.
- Full Settings UX (provider selection, voice picker, consent management, copy audit) — **EP-8**.

**Future work (post-v1.0)**
- `OllamaLlmProvider` (local LLM) behind the same `LlmProvider` seam (`41` §7 `FUTURE OPTION`).
- OpenAI Realtime (streaming STT over WebSocket) — `33` §2.1 `FUTURE OPTION`.
- Worker/`utilityProcess` isolation for SQLite + STT decode (`30` §6) — EP-11 candidate.

## Manual Testing

| Step | Action | Expected Result |
| --- | --- | --- |
| 1 | Launch v0.2 build with a fresh profile | App opens on Chat; rail shows "🔒 Local · Offline"; identical to v0.1 |
| 2 | Create a reminder "remind me in 10 minutes to drink water" → Confirm | Saved; appears in Schedules; fires + speaks at T+10m (unchanged) |
| 3 | Open Settings | New OpenAI section visible; toggle **off** by default; key field empty; status "No key" |
| 4 | Enter a **valid** OpenAI key → Save | Status flips to "Key saved"; field masks/clears; key never re-displayed |
| 5 | Click **Validate** | Shows "Valid"; this is the only moment a packet leaves (see Security) |
| 6 | Enter an **invalid** key → Validate | Shows "Invalid key"; no crash; no other traffic |
| 7 | Click **Clear key** | Status back to "No key"; consent timestamps reset |
| 8 | Press mic, dictate a reminder | Live partial transcript ticks (sherpa), final lands on stop — unchanged from v0.1 |
| 9 | Trigger a reminder | Notification + history first; Yogi speaks via Windows voice — unchanged |
| 10 | `npm test` | 96 + new tests green |

## Edge Cases

- `safeStorage.isEncryptionAvailable()` false → Save refuses with a clear message; app stays usable offline.
- User enables the toggle but enters no key → predicate stays `false` (requires *both* enabled
  and `hasApiKey`), so still zero network.
- Very long / whitespace-only key → Zod `.strict()` + trim rejects at the IPC boundary.
- Rapid provider-setting toggles → factory re-run is idempotent; no leaked sherpa session.
- Migration state unchanged → no `memories`/`conversations` writes; dead schema stays dead.

## Failure Cases

- `validateApiKey` while offline / OpenAI unreachable → returns `{ valid:false, reason:'unreachable' }`;
  no thrown error crosses IPC; UI shows "Couldn't reach OpenAI."
- Malformed IPC payload to `setApiKey` → guarded refusal (`forbidden`/`bad_request`), sanitised.
- `safeStorage` decrypt fails at read (profile moved between machines) → treated as no key;
  cloud stays off; app functions offline; user re-enters key.
- Compromised-renderer spoof of `speech:audio` from a wrong origin → `guard()` drops it (was
  two ad-hoc checks before; now one canonical path).

## Recovery Tests

- Kill app mid key-save → on relaunch either the ciphertext is fully written or absent; never a
  partial/plaintext key. Verify `ai_key_ciphertext` is valid ciphertext or empty.
- Corrupt `ai_key_ciphertext` manually → app boots, `hasApiKey` true but decrypt fails →
  treated as no-key at call time; user prompted to re-enter; no crash.
- Flip `ai_assist_enabled` true→false→true rapidly → predicate + CSP re-evaluate correctly each
  time (session-rebind test); no stuck-open network.

## Regression Tests

Required (`41` §8/§11), all must pass:
- **The full offline reminder loop still works** — parse → card → Confirm → schedule → notify +
  speak, no key, no network.
- **Wireshark zero packets with cloud off** — from launch through reminder fire, with no key
  entered and the toggle off, capture shows **zero** outbound packets.
- **The confirmation gate holds** — no reminder persists without an explicit Confirm click;
  `needsClarification` still renders a card with no Confirm.
- **96 existing tests green** — plus the new provider-factory, key-IPC, and session-rebind
  tests. `typecheck` + `lint` clean.

## Performance Tests

- STT decode per-frame timing with `[STT-DIAG]` removed ≥ as fast as v0.1 (no regression; the
  diagnostics were overhead).
- App cold-start time unchanged within noise (factory install is startup-cheap).
- No new main-thread stalls introduced (SQLite/STT concerns explicitly deferred, `30` §6).

## Expected App Behaviour

**Current → EP-1** (arrow-flow, `41` §9 style — note: **no user-visible change**):

```text
v0.1 (Current)                          EP-1 (v0.2)
──────────────                          ───────────
User types reminder                     User types reminder
   │                                        │
parse → single-shot card                 parse → single-shot card        (UNCHANGED)
   │                                        │
Confirm → ipc.createReminder             Confirm → ipc.createReminder    (UNCHANGED)
   │                                        │
schedule → notify + Windows voice        schedule → notify + Windows voice (UNCHANGED)

Network: dead seam (()=>false)     ─▶    Network: LIVE predicate, default false
STT: new SherpaSpeechService       ─▶    STT: SherpaSpeechProvider via factory
TTS: direct speechSynthesis        ─▶    TTS: WebSpeechTtsProvider (kind:'in-window')
Key: no safeStorage code           ─▶    Key: ApiKeyStore mechanism + IPC (inert w/o key)
Settings: no cloud section         ─▶    Settings: minimal OpenAI section (off by default)
```

The user sees the same app. The difference is entirely under the floorboards: dead seams are
now live-but-off, orphaned settings are now read, the key mechanism exists, and every later
phase has a clean interface to plug into. Demo framing: **"nothing changed for you — we rebuilt
the foundation so the next releases can add voice and chat safely."**

## Conversation Testing

EP-1 has **no conversation model** (that is EP-2). The "conversation" is still the single-shot
parse→card flow, asserted byte-identical to v0.1:

- **User:** "remind me tomorrow at 9am to call the dentist"
  **Expected:** parse card "Yogi understood · Call the dentist · tomorrow 9:00 AM · one-time" →
  Confirm → saved. Identical to v0.1.
- **User:** "remind me at 5" (ambiguous meridiem)
  **Expected:** clarification card with AM/PM chips, no Confirm button (gate holds). Identical.
- **User:** "what's the weather"
  **Expected:** refusal card with reminder examples — EP-1 does **not** add chat; the honest
  placeholder ("Connect OpenAI in Settings to chat and answer questions") is an **EP-2** change.
  In EP-1 this remains the existing refusal card.

## Voice Testing

- Press mic → sherpa loads lazily on first press (unchanged); live partials tick (sherpa is
  `supportsPartials:true`); final transcript lands on stop from the `stop()` return value — not
  from the deleted `SPEECH_FINAL` broadcast.
- Dictate "remind me in five minutes to stretch" → transcript populates the composer → Ask Yogi
  → parse card. Identical to v0.1.
- Confirm a reminder that fires while the app is in the tray → Yogi speaks via the Windows voice
  (WebSpeechTtsProvider, `kind:'in-window'`, the existing `tts:speak` path). No `voiceId`/`rate`
  in the payload anymore; behaviour identical because `audio-host.ts:89` already dropped
  `voiceId` and used the default `rate`.
- Verify the deleted `onFinal` path caused **no** double-apply and the removed SPIKE logs no
  longer appear in the audio-window console.
