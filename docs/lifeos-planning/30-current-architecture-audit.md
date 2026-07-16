# 30 — Current Architecture Audit (Phase 0)

> **Method:** This document was produced by reading the actual source tree, not by
> trusting `current-project-status.md` or the design docs (`00`–`26`). Every claim below
> is grounded in a file the auditor opened; discrepancies between documentation and code
> are called out explicitly in §12. Security-critical files (`windows.ts`, `session.ts`,
> `preload/index.ts`, the IPC guard, the network filter) were read line-by-line rather
> than summarised.
>
> **Snapshot:** 2026-07-12 · commit state as present in the working tree · Electron 43.1.0.
>
> **Verdict in one line:** The MVP is real, well-tested at its core, and unusually
> disciplined about security — but it is a *reminder-first, offline-first* app whose two
> load-bearing product invariants ("**zero network by default**" and "**audio never leaves
> the device**") are exactly the invariants the new product direction (conversation-first,
> OpenAI STT/TTS/chat) must deliberately renegotiate. That renegotiation is the central
> theme of every downstream planning doc (`31`–`39`).

---

## 1. Current architecture (as built)

```text
┌── MAIN PROCESS (Node, never throttled) ───────────────────────────────────────┐
│  index.ts orchestrates a numbered startup sequence:                            │
│    switches (autoplay) → AUMID → single-instance lock → session security       │
│    → open+migrate DB → seed settings → audio window → scheduler+notifier+sink  │
│    → tray → IPC handlers → speech handlers → 30s reconcile tick → main window   │
│  Owns: SQLite (node:sqlite, synchronous) · scheduler · tray · notifications     │
│        · SherpaSpeechService (STT) · logger · reset                             │
└───────────────┬───────────────────────────────────────────────┬───────────────┘
                │ ipcMain.handle (guard: origin → Zod.strict     │ webContents.send
                │  → business rules → Result<T>)                  │ (best-effort)
┌───────────────┴─ PRELOAD (sandboxed, CJS, frozen) ──┐   ┌───────┴─ HIDDEN AUDIO WINDOW ─┐
│  window.lifeos.*  (~26 named fns, no ipcRenderer)   │   │ speechSynthesis + <audio>     │
│  imports only CH from channels.ts (zod-free)        │   │ window.lifeosAudio (recv-only)│
└───────────────┬─────────────────────────────────────┘   └───────────────────────────────┘
                │ window.lifeos.*
┌───────────────┴─ RENDERER (React 19, sandbox:true, no Node) ───────────────────┐
│  State-based nav (4 views). ChatScreen = single-shot parse→card (no history).   │
│  useReminders / useSettings caches invalidated by main→renderer broadcasts.     │
└─────────────────────────────────────────────────────────────────────────────────┘

core/  ── pure TS (luxon, chrono-node, zod only; ESLint-walled from electron/node) ──
         parsing/ (regex intent + chrono + ambiguity)  scheduling/ (rrule + next-occ)
         time/ (format)  types/ (reminder, ipc, channels)
```

**Layering is genuinely clean.** `core/` is framework-free and ESLint-enforced to stay
that way (`eslint.config.js` bans `electron`, `node:*`, `fs`, `path`, `os`, and reaching
into `../electron`/`../src` from `core/**`). The `SqliteDriver` interface, the
`ParseResult` discriminated union, the `Result<T>` IPC envelope, and the epoch-ms + IANA
domain model are all correct, portable, and testable. This is the load-bearing good news:
**the foundation is sound enough to build a much larger product on.**

**The runtime process model is textbook-secure** (see §7). The weaknesses are almost all
at the *edges* — the speech IPC path, the renderer's data model, the untested layers, and
a handful of dead/latent wiring — not in the core.

---

## 2. Current strengths (do not lose these)

1. **Security enforced by tooling, not convention.** ESLint bans `child_process`, `eval`,
   `new Function`, and dynamic code globally, and whitelists exactly three audited
   exceptions (`electron/tts/sapi-tts-service.ts`, `electron/services/reset-service.ts`,
   `electron/speech/sherpa-speech-service.ts`), each scoped to one file with a doc citation.
2. **Default-deny outbound network in code** (`session.ts` `onBeforeRequest`). With the app
   as shipped, it cannot make a network request — a real control, not a policy sentence.
3. **A disciplined IPC boundary.** `guard()` does origin-check → `Result<T>` envelope →
   sanitised errors (no stack traces cross IPC); object schemas are Zod `.strict()`; `raw`
   is typed `unknown` everywhere; the preload exposes named functions only, is frozen, is
   dependency-free, and strips the `IpcRendererEvent`.
4. **A correct scheduler.** Persisted `next_fire_at` + fixed 30 s poll dodges both the
   24.8-day `setTimeout` trap and system-sleep drift; the trigger fan-out puts
   notification + history *unconditionally first* and everything else best-effort.
5. **Injected-clock, pure, fixture-tested core.** 96 tests pass (verified exactly: 56
   parser fixtures + 40 hand-written), covering DST, missed-occurrence collapse, the
   `2³¹−1` timer trap, transactional migration rollback, SQL-injection-as-literal, and the
   reset-path guard — real edge cases, not coverage padding.
6. **Humane reliability semantics.** Recurring reminders roll forward silently rather than
   storm-firing; one-time reminders missed while closed are marked `missed`, not fired late;
   the audio window self-heals with a restart cap then degrades to notification-only.
7. **Correct packaging fundamentals.** Native addon `asarUnpack`'d, STT model as
   `extraResources` (never inside a compressed asar), `perMachine:false` (no UAC), runtime
   paths via `process.resourcesPath` not `__dirname`.

---

## 3. Current weaknesses

### 3.1 Product-shape weaknesses (the ones the pivot must fix)

- **No conversation model anywhere.** `ChatScreen.tsx` holds exactly one
  `result: ParseResult | null` slot; a new parse overwrites the last. There is no
  `Message[]`, no roles, no bubbles, no streaming, no scrollback. Clarification is handled
  by *re-parsing a reconstructed string* (`ask(`${lastAsked} at ${label}`)`), which works
  only for the narrow reminder grammar and does not generalise. Becoming conversational is
  effectively a **rewrite of `ChatScreen`** plus new infrastructure (a conversation store,
  a streaming IPC channel modelled on `useSpeech.onPartial`, per-message intent dispatch).
- **`Intent` is closed to two reminder variants.** `type Intent = 'create_reminder' |
  'create_sing_reminder' | 'unknown'` (`core/parsing/types.ts:12`), and
  `ParsedReminder.intent = Exclude<Intent,'unknown'>` hard-codes "every parseable thing is
  a reminder." `parseReminder()` is the *top-level router*; under a conversation-first
  design it must be demoted to one *executor* invoked when intent === reminder.
- **Reminder-first copy is baked into the UI in ≥3 places** (`App.tsx` rail chip,
  `SettingsScreen.tsx` Speech section, `OnboardingFlow.tsx` privacy pane), all asserting
  "offline, no server, nothing uploaded." A cloud provider option contradicts this copy —
  a content audit, not just a form addition, is required.

### 3.2 Structural / engineering weaknesses

- **The AI-Assist network path is dead code.** `index.ts` installs session security with a
  hardcoded probe `const settingsProbe = { aiAssistEnabled: () => false }` and never
  re-installs it against the real `SettingsRepository`. Both the CSP `connect-src`
  extension and the `api.openai.com` allow-branch in `isAllowedOrigin` are therefore
  **unreachable regardless of any setting.** (Fails safe today; a latent functional bug the
  moment any network feature ships.)
- **The provider abstraction was designed into the DB and never built in code.** Settings
  keys `stt_provider`, `tts_voice_id`, `tts_rate`, `tts_degraded`, and the `ai_*` family
  (`ai_provider`, `ai_assist_enabled`, `ai_model`, `ai_consent_accepted_at`, `ai_last_used_at`,
  `ai_key_ciphertext` — the full orphan list is in `34` §1) all exist in `SETTING_DEFAULTS`,
  but **no code reads them** and there
  is no `SpeechProvider`/`TextToSpeechProvider` interface. STT is a direct `new SherpaSpeechService`;
  TTS is a direct `speechSynthesis.speak` in the audio window.
- **Dead plumbing across the speech pipeline.** `CH.SPEECH_FINAL` / service `onFinal` /
  preload `onFinal` are wired end-to-end and never fired (final text comes from `stop()`'s
  return value). `voiceId` and `rate` are accepted by the `tts:speak` contract, sent by
  nobody, and `voiceId` is ignored by `speak()`. `audio:ready` / `audio:error` are *sent*
  by the audio window but have **no `ipcMain.on` handler** — error reports are silently lost.
- **SPIKE-3 scaffolding shipped as product.** `src/audio-host.ts` still carries
  `[SPIKE-3]` `console.log`s and emoji markers; `sherpa-speech-service.ts` carries
  `[STT-DIAG]` counters in the hot path.
- **`memories` and `conversations` tables are confirmed dead schema** — DDL only (migration
  002), no repository, no reader/writer anywhere. Forward-only migration policy means they
  can never be dropped; they ship as permanent maintained weight.
- **Settings are stringly-typed.** 20 keys stored as TEXT with ad-hoc encodings; every call
  site parses `'true'`/`'30000'`/`'1.0'` by hand. No typed accessors, and `SettingsDto` is
  duplicated by a hand-maintained `SettingsUpdate` interface in `src/lib/ipc.ts`.

---

## 4. Technical debt (itemised, with locations)

| # | Debt | Location | Impact |
| --- | --- | --- | --- |
| D1 | AI-Assist session security wired to `() => false` probe | `electron/main/index.ts` (startup) | Network features cannot work until re-wired to real settings + a live re-install path |
| D2 | Duplicated RRULE grammar | `core/scheduling/rrule.ts` **and** `core/time/format.ts` | Two sources of truth; `format.ts` silently returns "Custom schedule" where `rrule.ts` throws |
| D3 | `last_triggered_at` stamped on missed-while-closed roll-forward | `reminder-repository.ts` `setNextFireAt` + `scheduler.ts` | Claims a fire that never happened; corrupts history/UI |
| D4 | Speech handlers bypass `guard()` | `electron/main/ipc/speech.ts` | Re-implements origin check + envelope; leaks `String(e)` to renderer; 2nd origin impl |
| D5 | Duplicated origin check (3 implementations) | `guard.ts`, `speech.ts` (×2 inline + `assertOurFrame`) | Drift risk; one is the canonical, two are copies |
| D6 | `SettingsDto` vs `SettingsUpdate` duplication | `core` types vs `src/lib/ipc.ts` | Must edit in lockstep; will bite the Settings redesign |
| D7 | `mark*` repository methods are near-identical | `reminder-repository.ts` | ~5 copies of `UPDATE … SET status=…` — collapse to `setStatus()` |
| D8 | Orphan/dead settings + dead IPC channels | speech pipeline (§3.2) | Contract lies; confuses future implementers |
| D9 | SPIKE diagnostics in shipping code | `src/audio-host.ts`, `sherpa-speech-service.ts` | Console noise; debug work in the hot path |
| D10 | Orphan test fixtures | `tests/fixtures/audio/*` | Referenced by no test |
| D11 | No prepared-statement caching | `node-sqlite-driver.ts` | `db.prepare()` per call; easy win forgone |
| D12 | `better-sqlite3` external listed but not a dependency | `electron.vite.config.ts` | Dead/defensive config, confusing |

---

## 5. Missing abstractions

1. **`SpeechProvider` interface** (STT) — the public surface of `SherpaSpeechService`
   (`start` / `pushAudio` / `stop` / partial callbacks) is a *de-facto* interface never
   extracted. Must be extracted with `supportsPartials: boolean` so a **batch** provider
   (OpenAI Whisper) can satisfy it without an `onPartial` analog (see §11).
2. **`TextToSpeechProvider` interface** — designed in doc `07` (`core/tts/tts-service.ts`)
   but not built. Needs an `AudioResult` that covers both "spoken in-window"
   (`speechSynthesis`) and "audio bytes to play" (OpenAI TTS). **There is currently no IPC
   path to hand an audio buffer to the audio window** — `audio:play` carries a *filename
   key* by deliberate security design. This is the single hardest piece of the OpenAI
   migration (see §11).
3. **A Conversation Engine + Action Dispatcher** — nothing today sits between "user text"
   and "an action." `parseReminder` *is* the whole pipeline. The new architecture needs a
   layer that: holds history, calls an LLM, receives structured JSON, validates it, and
   routes to per-intent executors — with the reminder path reusing today's scheduling +
   ambiguity guardrails.
4. **Typed settings accessors** (`getBool`/`getNumber`/`getEnum`) and a single
   `SettingsDto` source of truth.
5. **A shared "safe URL origin" helper** — origin-parse-with-try/catch is reimplemented in
   `will-navigate`, `onBeforeRequest`, `isAllowedOrigin`, `guard.ts`, and `speech.ts`.
6. **A typed IPC handler registry** — `register(channel, schema, fn)` would guarantee every
   handler validates + is guarded uniformly (and would have prevented the speech handlers
   from drifting off `guard()`).
7. **Renderer primitives** — no `Button`, `Section`/`SettingRow`, `Card`, `ErrorBoundary`,
   toast, or streaming-IPC hook. The Settings redesign and conversation UI both need these.

---

## 6. Performance concerns

- **Synchronous SQLite on the main thread.** `node:sqlite` `DatabaseSync` blocks the event
  loop for every query. Fine at current scale (single user, tiny tables, 30 s poll), but
  `listAll` (`SELECT *` with **no LIMIT**) and a growing `reminder_history`/`app_logs` will
  eventually stall IPC/UI responsiveness. No worker/async facade exists.
- **STT decode on the main thread.** `sherpa-speech-service.ts` runs
  `while (recognizer.isReady) recognizer.decode()` synchronously per ~100 ms frame, plus a
  per-sample Int16→Float32 loop. Native ONNX inference on the main thread can jank the tray,
  IPC, and scheduler under load. RTF is low (~0.07) so it works, but a `utilityProcess`
  would isolate it. Model construction also blocks ~1 s on first `start()`.
- **Synchronous logger writes on the main thread** — `Logger.write` does a synchronous
  `db.run` INSERT plus a redaction regex pass on *every* log call.
- **`activeCount()` materialises the full active list** just to take `.length` on every tray
  refresh — a `SELECT COUNT(*)` would do.
- **No statement caching** (D11).

None of these are urgent at MVP scale; all become relevant as conversation history,
memory, and cloud calls add load. **The main-thread SQLite + STT decode are the two to
watch** once the app does more per interaction.

---

## 7. Security concerns

The runtime posture is **strong** and should be preserved wholesale. Verified directly:

- **Window flags** (`windows.ts`): `contextIsolation:true`, `nodeIntegration:false`,
  `sandbox:true`, `webSecurity:true`, `webviewTag:false`, `spellcheck:false` — all explicit.
- **CSP** (`session.ts` `buildCsp`): packaged policy is `script-src 'self'` with no
  `unsafe-inline`/`unsafe-eval`; dev policy (with eval + ws) is gated on `!app.isPackaged`.
- **Default-deny network** (`onBeforeRequest`) + **mic-only permission handler** +
  **navigation locks** (`will-navigate`, exact-match `setWindowOpenHandler`,
  `will-attach-webview` denied).
- **Preload** exposes named functions only, frozen, no `ipcRenderer`, event-object stripped.
- **API key** never crosses IPC (`getAllSafe` destructures out `ai_key_ciphertext`;
  `hasApiKey` returns a boolean).

**Residual issues found (all lower-severity given the locked renderer, but real):**

| # | Concern | Detail |
| --- | --- | --- |
| S1 | **Permission handler grants camera, not just mic** | `callback(permission === 'media')` covers `getUserMedia({video:true})`; it ignores `details.mediaTypes`. Comment says "microphone only"; code does not enforce it. |
| S2 | **Origin check collapses in packaged builds** | `APP_ORIGIN === 'null'` under `file://`; the check `origin !== 'null'` passes for *any* null-origin frame (`data:`, `about:blank`, sandboxed iframe). Sender authenticity then rests entirely on navigation locks + CSP, not on the check itself. |
| S3 | **`will-navigate` permits any local file in packaged builds** | Same `'null'` origin issue — every `file://` path is same-origin, and `isAllowedOrigin` unconditionally allows `file:`. |
| S4 | **Speech path leaks raw errors** | `speech:start`/`speech:stop` return `message: String(e)`, bypassing `toIpcError` — can surface native module/file-path detail (D4). |
| S5 | **API-key protection is a convention, not a structure** | `getAllSafe`/`hasApiKey` exclude the ciphertext, but the generic `get('ai_key_ciphertext')` still returns it. Stored value is ciphertext (lower risk), but the guarantee isn't structural. |
| S6 | **Unsigned binaries** | No Authenticode signing anywhere; SmartScreen "unknown publisher"; auto-update feed (`latest.yml`) is integrity-checked (sha512) but **not authenticity-checked**. `SHA256SUMS.txt` is served from the same release it describes. |
| S7 | **No model/download integrity check** | `fetch-stt-model.mjs` extracts a 68 MB archive over GitHub TLS with no checksum pin; STT model files loaded with existence checks only. |

**For the pivot specifically:** introducing OpenAI STT/TTS/chat re-opens the network surface
that S-class controls currently keep closed. The design must extend — not weaken — the
allowlist/CSP/consent apparatus (see `32`), and must fix **D1** (the dead `() => false`
probe) as a prerequisite, because that is the exact seam the network gating flows through.

---

## 8. Code duplication (consolidation targets)

- **RRULE grammar** in `rrule.ts` + `format.ts` (D2).
- **Origin-check** in `guard.ts` + `speech.ts` ×2 + `assertOurFrame` (D5).
- **`mark*`/status-update** repository methods (D7).
- **Command/trigger vocabulary** encoded twice: detection regexes in
  `detect-intent.ts` and stripping regexes in `extract-title.ts` — adding a trigger phrase
  requires editing both, in sync, with no shared constant.
- **Packaged-vs-dev path branching** duplicated across `paths.ts`, `tray.ts` (with a
  *different* dev base), and `windows.ts` `loadRenderer`.
- **`e instanceof AppError ? e.message : String(e)`** repeated in renderer screens.
- **Button/card CSS** duplicated across selector lists (no shared `.btn` / `Button`).

---

## 9. Areas needing refactoring (prioritised for the pivot)

1. **Extract `SpeechProvider` + `TextToSpeechProvider` interfaces and a provider factory**
   keyed on the (currently orphaned) `stt_provider`/`tts_provider` settings, with a fallback
   decorator. Prerequisite for `32`/`33`/`35`. *(High value, medium effort.)*
2. **Introduce a structured-input build layer** that decouples "how fields were obtained"
   (regex vs LLM) from "how a reminder is validated + built," returning the same
   `ParseResult` so the confirmation-gate and clarification UI are unchanged. Prerequisite
   for `31`/`36`. *(High value.)*
3. **Fix D1** — bind session security to the real settings with a live re-install on
   change. Prerequisite for any network feature. *(Small, blocking.)*
4. **Consolidate the speech IPC onto `guard()`** and delete the dead
   `onFinal`/`voiceId`/`rate`/`audio:ready`/`audio:error` plumbing (D4, D8).
5. **Unify the RRULE grammar and origin helper** (D2, D5).
6. **Renderer: split `App.tsx`** (router + onboarding gate + modal host + version are all in
   one component), add an `ErrorBoundary`, and introduce shared primitives.
7. **Testability: add a jsdom vitest project + coverage** so the untested renderer/IPC/
   preload/speech layers (§10) become visible and testable.

---

## 10. Testing reality

- **96 tests, all green** — claim verified exactly. Concentrated on `core/` (parser 56
  fixtures, next-occurrence 10 incl. 3 DST) and persistence/scheduling
  (`electron/database`, `electron/scheduler`).
- **Untested layers:** the entire **renderer/React** (no jsdom — `vitest` runs
  `environment:'node'`), the **IPC guard/validation boundary**, both **preload** bridges,
  the **speech** pipeline (STT + TTS; the audio fixtures are orphaned), **notifications,
  tray, windows, session, lifecycle**, and the **reset *service*** (only the pure guard is
  tested). **No E2E/smoke of the packaged app at all.**
- **CI** runs typecheck + lint + tests on `windows-latest` only; **green CI does not prove
  the app packages or launches.**

This matters for the pivot: the layers about to change most (renderer conversation UI, IPC,
speech providers) are precisely the untested ones. `38-testing-guide.md` treats closing
this gap as part of the definition of done for each phase, not an afterthought.

---

## 11. The OpenAI STT/TTS migration — three concrete frictions (not a class swap)

The audit singles these out because the brief frames providers as a simple interface swap
(`SherpaSpeechProvider` ↔ `OpenAISpeechProvider`). The code says otherwise:

1. **STT streaming vs batch — the contracts don't map.** The whole pipeline is frame-by-
   frame streaming with live `onPartial`. OpenAI `/audio/transcriptions` is **batch**
   (buffer whole utterance → one POST → final text, no partials); OpenAI Realtime is a
   **WebSocket** (a third transport, needing `connect-src wss://` in CSP). A `SpeechProvider`
   interface must make **partials optional**; the OpenAI-batch path loses the live-transcript
   strip and only resolves at `stop()`.
2. **TTS audio delivery is blocked by the current security model.** `audio-host.ts` plays
   audio by a **filename key** resolved against a hardcoded map and *deliberately refuses
   paths/URLs*. OpenAI TTS returns **audio bytes**, and there is **no IPC channel to hand a
   buffer/stream to the audio window.** A `TextToSpeechProvider` needs a brand-new,
   carefully-scoped "play arbitrary audio buffer" path (bytes fetched in **main**, to keep
   the API key out of a renderer), which the present design forbids on purpose.
3. **The offline promise + network allowlist.** Cloud STT means the **microphone audio
   leaves the device** — which doc `09` flatly lists under *"Never sent: Audio, ever."* This
   is a product repositioning, not a toggle. It requires extending the allowlist/CSP/consent
   to the *speech* feature (not just AI-Assist), a new consent gate, and honest UI copy —
   and it must be surfaced to the user as a deliberate choice, defaulting **off**.

The encrypted-key infrastructure (`ai_key_ciphertext`, `hasApiKey()`), the network-gating
seam (`session.ts`), and the settings schema (`stt_provider`, `tts_provider`) already
anticipate this — so the *plumbing* is reusable. The *contracts* (streaming/batch,
audio-bytes IPC, offline promise) are the real work. `32` and `33` design for exactly these.

---

## 12. Documentation vs implementation — discrepancies

The design docs (`00`–`26`) are **specifications**, and several describe features as if
built that are not, or with details the code contradicts. Reconciled here:

| Claim (source) | Reality in code | Verdict |
| --- | --- | --- |
| Preload exposes "**~14 named functions**" (`11`, `16`) | ~**26** functions on `window.lifeos` + a separate `window.lifeosAudio` bridge | Docs stale; status doc's "~30" is closer |
| `settings.setApiKey` / `clearApiKey` / `openLogsFolder` exist (`09`, `16`) | **None exist** in the preload or IPC; no `safeStorage` code anywhere | AI-Assist + safeStorage **not started** (status doc is correct; `09`/`16` are aspirational) |
| AI Assist calls OpenAI when uncertain (`09`) | Network path is **dead** (`aiAssistEnabled: () => false` probe); no LLM code, no fetch | Not started |
| `onOverdueOnStartup` push channel (`16`) | Implemented as a **pull** channel `overdue.take()` (race-free) | Code is better than the doc; doc stale |
| `reminders:dismiss` present but `snooze`/`history` shapes per `16` | Present; `history()` renderer type omits `'cancelled'` that the Zod schema accepts | Minor type drift |
| TTS has a `TTSService` interface + voice picker (`07`) | Neither exists; `speechSynthesis.speak` is called directly; `voiceId`/`rate` plumbing is dead | Designed, not built |
| Permission handler is "microphone only" (`11`) | Grants all `media` incl. camera (S1) | Comment/code mismatch |
| `memories`/`conversations` are "future" tables (status doc) | Confirmed **dead schema**, DDL-only | Status doc accurate |
| "96 automated tests, 6 files" (status doc) | Verified **exactly** (56 fixtures + 40) | Accurate |
| "STT model ~68 MB" / "disposes after idle" (status doc) | Accurate (5-min idle dispose, `unref`'d) | Accurate |

**Net:** `current-project-status.md` is largely trustworthy; the older design docs
`07`/`09`/`11`/`16` over-describe unbuilt features. Downstream planning docs cite **code**,
not those specs, for anything security- or contract-relevant.

---

## 13. Things that should NOT be changed

These are correct, hard-won, and must survive the pivot intact:

1. **The confirmation gate.** Nothing consequential or not-trivially-reversible persists
   without an explicit human Confirm; `needsClarification` renders a card with *no* Confirm
   button. Preserve this for **reminders, memory, and all deletions** (always a card or a
   voice "yes"), regardless of whether the proposal came from the local parser or an LLM.
   The **one bounded carve-out** (`36` §4.2): a change to the closed *safe-settings* subset
   (theme, speak-aloud, pause, voice) may apply optimistically with an instant **Undo** — the
   change is immediately visible and instantly revertible, which serves the gate's purpose for
   a trivial, reversible preference, and it can never reach keys/consent/provider settings.
   This is the product's integrity guarantee.
2. **"LLM proposes, app validates, app executes."** The LLM returns structured JSON and
   *never* actuates. Keep the four-gate validation posture from `09` (shape → semantics →
   safety scan → confirmation) and extend it to every new intent.
3. **The secure `webPreferences` defaults, navigation locks, and default-deny network** —
   extend the allowlist deliberately and reversibly; never disable a lock "just for dev"
   without gating on `!app.isPackaged`.
4. **The reliability-ordered trigger fan-out** — notification + history unconditional and
   first; TTS/audio/modal best-effort and individually wrapped. A reminder must fire even
   if speech, the LLM, and the network are all down.
5. **The persisted-`next_fire_at` + polling scheduler** — do not "optimise" it into
   per-reminder `setTimeout`s (the 24.8-day trap) or make `reconcile` async without a
   reentrancy guard (today it is safe *only* because every step is synchronous).
6. **`safeStorage` for the API key + key-never-crosses-IPC** (from `09`/`11`) — the correct
   design; build it as specified, do not weaken it.
7. **Pure `core/` + the ESLint purity wall** — this is what keeps the parser testable and
   the framework decision reversible (macOS/Linux later).
8. **Epoch-ms + separate IANA zone domain model** and the `SqliteDriver` seam.
9. **`resetLocalData()` takes no arguments; path derived from `app.getPath` only** — never
   accept a path over IPC.

---

## 14. Audit summary

- **Foundation:** sound. Clean layering, strong security, a correct scheduler, a well-tested
  pure core.
- **Biggest gaps for the current MVP goal:** unsigned binaries (S6), and zero tests above
  the database/scheduler (§10).
- **Biggest gaps for the new product direction:** no conversation model (§3.1), no provider
  abstraction despite the DB anticipating it (§3.2, §5), the dead network seam D1, and the
  three OpenAI migration frictions (§11) — chief among them that **there is no IPC path to
  play cloud-returned audio bytes**, and that **cloud STT breaks the "audio never leaves the
  device" invariant** and must be a deliberate, off-by-default, consented choice.
- **The through-line:** keep the confirmation gate, the "LLM proposes / app executes"
  posture, and the security envelope; rebuild the *front* of the pipeline (regex intent +
  single-shot card) into a conversation engine + action dispatcher; and renegotiate the two
  offline invariants explicitly rather than silently.

The remaining planning docs (`31`–`39`) take these findings as their starting constraints.
