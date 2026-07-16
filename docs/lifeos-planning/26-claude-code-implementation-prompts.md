# 26 — Claude Code Implementation Prompts

> Copy-paste prompts, in order. Each corresponds to a step in `20-daily-implementation-checklists.md`.
>
> **How to use these:** run them one at a time, in a Claude Code session opened at the repository root. After each, run the step's manual test from `20` yourself. Do not run two prompts before testing the first — the whole point of the step structure is that a failure is attributable.

---

## 0. The session preamble

Paste this **once**, at the start of every Claude Code session. It is the constitution.

```text
You are implementing LifeOS (assistant name: Yogi), a privacy-first Windows desktop
reminder app. The complete plan is in /docs/lifeos-planning/. Read 00-project-summary.md
and 13-system-architecture.md before writing any code.

NON-NEGOTIABLE INVARIANTS. If a task appears to require breaking one, stop and say so.

1. CONFIRMATION GATE. Nothing is written to the reminders table without an explicit
   user Confirm press. Neither the local parser nor an LLM may create, edit, delete
   or trigger a reminder. The only bridge from a parsed result to a persistable input
   is core/parsing `toCreateInput()`, and it may only be called from the Confirm button
   and the Edit form's Save.

2. NO SYSTEM HARM, BY CONSTRUCTION. No admin/elevation. No registry writes. No drivers,
   services, or Windows Task Scheduler jobs. No shell/PowerShell command built from user
   speech, user text, or model output. No eval, no new Function. No file writes outside
   app.getPath('userData'). `child_process` may be imported in exactly one file
   (electron/tts/sapi-tts-service.ts) and only with a constant command and text on stdin.

3. THE SCHEDULER LIVES IN THE MAIN PROCESS and is wall-clock authoritative. The persisted
   `next_fire_at` column is the source of truth. Use a 30-second setInterval reconcile,
   plus powerMonitor 'resume'/'unlock-screen', plus a startup catch-up. NEVER schedule a
   setTimeout to a reminder's due time: delays above 2^31-1 ms (~24.8 days) fire IMMEDIATELY.

4. AMBIGUITY IS ASKED ABOUT, NEVER GUESSED. Use chrono's `result.start.isCertain(component)`
   to distinguish what the user said from what chrono defaulted. Never auto-assign an
   ambiguous meridiem. Always pass { forwardDate: true }.

5. chrono-node DOES NOT PARSE RECURRENCE. A custom keyword layer must run before chrono.
   "every Monday at 7 AM" becoming a one-time reminder is the highest-severity bug available.

6. core/ IS PURE TYPESCRIPT. It may import only luxon, chrono-node and zod. It may never
   import electron, node:*, fs, path, or os. This is enforced by ESLint.

7. IPC IS THE SECURITY PERIMETER. Every ipcMain.handle payload is typed `unknown` and
   validated with a Zod .strict() schema. Handlers return a Result<T> envelope, never
   reject. Never expose ipcRenderer or a generic invoke() to the renderer.

8. ZERO NETWORK BY DEFAULT. AI Assist is off by default and requires an explicit consent
   timestamp checked in the MAIN process. Only the command text is ever sent — never audio,
   never reminders, never settings.

9. DEGRADE, NEVER DEAD-END. In the trigger path, `notifier.show()` and `history.record()`
   are unconditional and must appear before, and outside, any try block that could skip
   them. TTS, audio playback and the in-app modal are best-effort and individually wrapped.

10. TypeScript strict. All SQL parameterized (one documented exception:
    `PRAGMA user_version = ${v}` in migrate.ts, where v is a loop index).

Style: match the surrounding code. Write comments only for constraints the code cannot show.
Do not add features that are not in the current step. If you finish early, write a test.
```

---

## Day 1

### Prompt 1 — Scaffold with secure defaults

```text
Read docs/lifeos-planning/11-electron-security-architecture.md and 14-folder-structure.md.

Scaffold the LifeOS project:
- electron-vite + React 19 + TypeScript, Electron pinned EXACTLY to "43.1.0" (no caret).
- Create the folder structure from 14 §1. Empty directories with a .gitkeep are fine.
- electron/main/windows.ts: export a `secureDefaults` WebPreferences object exactly as in
  11 §3 (contextIsolation, nodeIntegration:false, sandbox:true, webviewTag:false,
  spellcheck:false, webSecurity:true).
- electron/main/session.ts: CSP via onHeadersReceived, gated on app.isPackaged (CSP_PROD /
  CSP_DEV from 11 §5); setPermissionRequestHandler allowing only 'media'; a default-deny
  onBeforeRequest network filter that blocks every origin except APP_ORIGIN.
- Navigation locks in app.on('web-contents-created'): will-navigate, setWindowOpenHandler
  → deny, will-attach-webview → preventDefault.
- In main, BEFORE any window is created:
    app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
    app.setAppUserModelId('com.dreamnotion.lifeos')
- electron.vite.config.ts: preload MUST build to a single ES file (a sandboxed preload
  cannot require() across files). Mark sherpa-onnx and better-sqlite3 as external in main.
- .eslintrc.json: the no-restricted-imports rules from 11 §7 — ban child_process globally
  with an override for electron/tts/sapi-tts-service.ts, and ban electron/node:*/fs/path/os
  inside core/.
- .npmrc: ignore-scripts=true.
- tsconfig.json: strict, moduleResolution "node16" (chrono-node's locale subpaths need it).

Then add tests/unit/csp.test.ts asserting CSP_PROD contains "script-src 'self'" and
contains neither 'unsafe-eval' nor 'ws:'.

Do NOT create a database, a parser, or any UI beyond an empty window.
```

**Verify before continuing:** `npm run dev` opens a window; DevTools shows no Electron security warnings; `typeof require` is `"undefined"`; `npm run lint` fails if you add `import cp from 'child_process'` anywhere.

---

### Prompt 2 — SPIKE-1: node:sqlite

```text
Read docs/lifeos-planning/10-local-database-and-memory-architecture.md §12.

Write a THROWAWAY spike in electron/main/index.ts (I will delete it) that, after
app.whenReady():

1. require('node:sqlite') — no flags.
2. Opens path.join(app.getPath('userData'), 'spike.db').
3. Runs PRAGMA journal_mode=WAL and logs the result.
4. Creates a table with a CHECK(length(trim(title))>0) constraint.
5. Inserts, using a BOUND PARAMETER, the literal string:  '); DROP TABLE t;--
6. Reads it back and asserts it round-tripped as literal text AND the table still exists.
7. Asserts a CHECK violation (empty title) throws a catchable error.
8. Logs "SPIKE-1 PASS" or the exact failure.

Log clearly. Do not build anything else.

If require('node:sqlite') throws, STOP and tell me the exact error. Do not silently
fall back to better-sqlite3 — that is my decision to record.
```

**Verify:** run `npm run dev`, then build and install, and confirm it also passes from the packaged app.

---

### Prompt 3 — SPIKE-5/4: package, install, toast, tray

```text
Read docs/lifeos-planning/14-folder-structure.md §5 and 20 step 3.

1. Write electron-builder.yml exactly as in 14 §5. Critical:
   - nsis.perMachine: false   (per-user install, NO UAC prompt — this is the no-admin guarantee)
   - nsis.createStartMenuShortcut: true  (Windows toasts require a Start Menu shortcut
     carrying the AppUserModelID; without it they SILENTLY fail)
   - win.target: [nsis, portable]
2. Add a throwaway 5-second timer in main that shows a main-process Notification
   ({title:'LifeOS', body:'hello'}) and wires its 'click' event to win.show()+win.focus().
3. Create electron/tray/tray.ts. The Tray instance MUST be held at MODULE scope
   (`let tray: Tray | null = null`). A function-scoped Tray is garbage-collected and the
   icon vanishes after ~10 seconds in PACKAGED builds while working fine in dev.
4. Intercept window 'close': if (!isQuitting) { e.preventDefault(); win.hide(); }
   Set isQuitting=true in app.on('before-quit'). Guard 'window-all-closed' so the app does
   NOT quit on win32 when the last window hides.
5. Use a multi-resolution .ico for the tray (16@72dpi, 20, 32@144dpi).

Then tell me the exact command to build the installer.
```

**Verify:** install as a standard user with no UAC prompt; toast appears from the tray; tray icon is still there after 15 minutes.

---

### Prompt 4 — SPIKE-3: TTS from a hidden window

```text
Read docs/lifeos-planning/07-text-to-speech-research.md §2 and §8.

Create the hidden audio window:
- electron/main/windows.ts: createAudioWindow() — BrowserWindow with show:false and
  webPreferences.backgroundThrottling:false, loading public/audio-host.html.
  Created at app.whenReady(), destroyed only in before-quit. On 'render-process-gone',
  recreate it.
- electron/preload/audio.ts: contextBridge exposes onSpeak/onCancel/onPlay/onStop/ready/report.
  It can send back only 'audio:ready' and 'audio:error'. Nothing else.
- public/audio-host.html: a speak() function that WAITS FOR THE 'voiceschanged' EVENT before
  calling getVoices(). getVoices() returns [] on the first synchronous call — this is the
  single most common bug with Web Speech in Electron. Log the discovered voice names.
- A throwaway timer in main that sends 'tts:speak' after 30 seconds.

CRITICAL: I must test this from the PACKAGED, INSTALLED app, with the window closed to the
tray, after 10 minutes of idle. Chromium throttles hidden renderers and
backgroundThrottling:false is documented as buggy for the hide() case on Windows
(electron#31016). Tell me exactly how to run that test.

If it fails, the fallback is SapiTTSService — do not implement it yet.
```

---

### Prompt 5 — SPIKE-0: the backstop

```text
In electron/main/index.ts, add a throwaway block:

  const due = Date.now() + 60_000;
  let fired = false;
  setInterval(() => {
    if (!fired && Date.now() >= due) { fired = true; notify(); speak(); }
  }, 30_000);

Use setInterval + a wall-clock comparison. Do NOT use setTimeout(fn, 60_000).
This is the muscle memory for the real scheduler: setTimeout delays above 2^31-1 ms
(~24.8 days) are coerced to 1 ms and fire IMMEDIATELY.

Then, separately, write a tiny script that demonstrates the trap:
setTimeout(() => console.log('fired'), 30 * 86_400_000) logs immediately.
I want to see it once, deliberately.
```

---

### Prompt 6 — SPIKE-2: sherpa-onnx, engine only

```text
Read docs/lifeos-planning/06-speech-to-text-research.md §9.

Timebox: 120 minutes. Do NOT touch the microphone in this step.

1. npm i sherpa-onnx-node  — this must succeed with NO Visual Studio Build Tools, no Python
   and no CMake. It is an N-API addon, not ffi-napi. If node-gyp runs, something is wrong.
2. Download a streaming Zipformer English model into resources/models/stt/.
3. In the MAIN process, load the recognizer and feed it tests/fixtures/audio/remind-me-5-min.wav
   (16 kHz mono PCM16) frame by frame via acceptWaveform(16000, ...).
4. Print each partial as it arrives, then the final transcript.
5. Report: time to first partial, number of partial updates, RAM with the model loaded,
   and RAM after dispose().

Testing the ENGINE with a known-good WAV, before the microphone exists, is what separates
a resampler bug from a model bug on Day 5. Do not skip it.

If the transcript is wrong or install fails, STOP at 120 minutes and tell me. The fallback
is transformers.js Whisper in the renderer. Do not start it without my go-ahead.
```

---

## Day 2

### Prompt 7 — Driver, pragmas, migrations

```text
Read docs/lifeos-planning/10-local-database-and-memory-architecture.md.

Implement:
- electron/database/driver.ts: the 6-method SqliteDriver interface from §2.
- electron/database/drivers/<the one SPIKE-1 selected>.ts
- electron/database/open.ts: resolve the path (honour PORTABLE_EXECUTABLE_DIR), apply
  journal_mode=WAL, foreign_keys=ON, busy_timeout=5000, synchronous=NORMAL.
- electron/database/migrate.ts: PRAGMA user_version runner. Each migration runs inside a
  transaction that also bumps the version. Throw DatabaseFromNewerVersionError if
  user_version > migrations.length — NEVER migrate backwards. Before the first migration
  on an existing DB, copy it to lifeos.db.bak-v<n> and keep the two most recent.
- migrations/001_initial.sql and 002_memory.sql, exactly as in 10 §5 and §8. Include
  EVERY CHECK constraint and the partial index idx_reminders_due.

Then tests/integration/migrations.test.ts (Vitest, real temp-file SQLite, no mocks):
- fresh DB reaches user_version = 2
- re-running migrate() is a no-op
- user_version = 99 throws DatabaseFromNewerVersionError
- a deliberately broken migration rolls back and leaves user_version unchanged
- PRAGMA journal_mode returns 'wal'

Migrations are forward-only. No DROP TABLE, no DROP COLUMN, ever.
```

---

### Prompt 8 — Reminder repository

```text
Read docs/lifeos-planning/15-data-models-and-schemas.md §1-2 and 10 §6.

Implement core/types/reminder.ts and electron/database/reminder-repository.ts.

CRITICAL MODELLING POINT: `scheduled_at` and `next_fire_at` are SEPARATE columns.
scheduled_at is the user's original intent and never changes. next_fire_at is what the
scheduler compares against Date.now() and rolls forward after each recurrence. Collapsing
them means losing the intent or corrupting the schedule.

- Times are epoch-ms INTEGERs. The IANA timezone is a separate TEXT column. Never store a
  Date or an ISO string in the DB. Never let a Date cross IPC.
- toDomain(row) maps snake_case → camelCase and 0|1 → boolean.
- findDue(now): WHERE status='pending' AND is_paused=0 AND next_fire_at <= ?
  ORDER BY next_fire_at ASC LIMIT 20   (the LIMIT is the clock-jump storm guard)
- Every query uses ? placeholders. Zero template literals in SQL.
- Also: history-repository.ts, settings-repository.ts (with SETTING_DEFAULTS from 10 §7),
  log-repository.ts, and electron/services/logger.ts with the redaction regexes from 11 §12.

Then tests/integration/reminder-repository.test.ts against a real temp-file SQLite:
- create / get / list / update / delete
- persistence across close and reopen
- a title of  '); DROP TABLE reminders;--  round-trips as LITERAL TEXT and the table survives
- an empty title is rejected by the CHECK constraint (this test is what licenses the
  `as ActionType` casts in toDomain)
- an unknown action_type is rejected
- findDue excludes paused rows and caps at 20
- deleting a reminder cascades its history
```

---

### Prompt 9 — IPC layer + throwaway dev form

```text
Read docs/lifeos-planning/16-api-and-ipc-contracts.md.

- core/types/ipc.ts: the CH channel-name constant, the Result<T> envelope, and the Zod
  schemas from 15 §4 (CreateReminderInput etc.), all .strict().
- electron/preload/index.ts: named functions only. Object.freeze the exposed API. Strip the
  IpcRendererEvent from every listener callback (event.sender is a privilege-escalation
  handle). Never expose ipcRenderer or a generic invoke().
- electron/main/ipc/{index,reminders}.ts: the guard() wrapper from 16 §5 —
  assertSenderIsOurWindow → Zod .parse(raw as unknown) → validateBusinessRules →
  act → broadcast(REMINDERS_CHANGED) → return a plain object.
  Handlers return Result<T> and NEVER reject. toIpcError sanitises: no stack traces.
- src/lib/ipc.ts: convert Result → thrown AppError at the renderer's edge, in this one file.
- src/hooks/useReminders.ts: subscribes to reminders:changed and REFETCHES (no diffing —
  main owns the truth).
- A deliberately ugly, throwaway dev form: title + datetime-local + repeat select.
  Timebox 75 minutes. It exists only to prove the IPC path. It will be deleted on Day 6.

Then tests/integration/ipc-contracts.test.ts:
- an unknown key on reminders:create is rejected (.strict())
- a past date returns { ok:false, error:{ code:'date_in_past' }}
- no response ever contains a stack trace (no "C:\" and no "at Object.")
- settings:get never returns the API key under any name
- resetLocalData's handler accepts no arguments
- EVERY registered channel appears in CH  ← the anti-drift guard
```

---

## Day 3

### Prompt 10 — The fixture corpus, first

```text
Read docs/lifeos-planning/18-testing-strategy.md §3.

Write tests/fixtures/commands.json — 120 fixtures — BEFORE any parser code exists.

Include:
- All 14 example commands from 01-product-requirements.md §7, verbatim.
- All 8 ambiguity cases from 01 §7 ("must trigger clarification"), verbatim.
- Every row of 17-error-handling-and-edge-cases.md §3.
- Phrasing variants: in/after, AM/am/a.m., Monday/mon, tomorrow/tonight.

Choose refDate ADVERSARIALLY:
- a Friday (so "next Friday" is not trivially +7 days)
- 23:55 (so "in 10 minutes" crosses midnight)
- 31 December (so it crosses a year)

Each fixture: { input, refDate, expect }. Then write tests/unit/parse-reminder.test.ts
driving them with describe.each.

The test file should now FAIL 120 times. That is the goal — it is my to-do list.
Keep the corpus as JSON, not TypeScript, so a case can be added without touching test code.
```

---

### Prompt 11 — The parser

```text
Read docs/lifeos-planning/08-smart-scheduling-architecture.md Part I.

Implement core/parsing/*.ts so that all 120 fixtures pass.

Order of operations matters:
1. detectIntent — closed allow-list. Check SING patterns FIRST (more specific).
2. extractRecurrence — MUST run BEFORE chrono. chrono-node does NOT parse recurrence; given
   "every Monday at 7 AM" it silently drops "every". Strip only the "every|each" token and
   leave the weekday for chrono to anchor. "every month"/"every other"/"every N days" →
   kind:'unsupported' → an honest refusal, NEVER a silent one-time reminder.
3. chrono.parse(strippedText, refDate, { forwardDate: true })
   forwardDate is MANDATORY: without it, "Friday" parsed on a Saturday returns LAST Friday.
   Use chrono.parse(), never chrono.parseDate() — the latter discards the isCertain metadata.
4. extractTitle
5. detectAmbiguity using result.start.isCertain(component):
   - check ambiguous_meridiem FIRST: isCertain('hour') && !isCertain('meridiem') && hour<=12
     NEVER auto-assign. chrono ships a refiner example that force-assigns PM for 1-4 — do
     not use it. A twelve-hour error is invisible until someone misses a flight.
   - !isCertain('hour') + recurrence → recurrence_without_time
   - a daypart word + !isCertain('hour') → vague_daypart
   - !isCertain('hour') → missing_time
6. scoreConfidence, then clarification.

parseReminder returns a discriminated union — { ok:true, reminder } | { ok:false,
kind:'clarification' } | { ok:false, kind:'refusal' }. Ambiguity is a RESULT, not an
exception. Only a real bug throws.

Export exactly one bridge to persistence: toCreateInput(p: ParsedReminder). Nothing else
may construct a CreateReminderInput.

core/ may import only luxon, chrono-node and zod.
```

---

### Prompt 12 — The scheduler and notifications

```text
Read docs/lifeos-planning/08-smart-scheduling-architecture.md Part II.

- core/scheduling/rrule.ts: parseRule/buildRule for EXACTLY two shapes:
    FREQ=DAILY;BYHOUR=h;BYMINUTE=m
    FREQ=WEEKLY;BYDAY=XX;BYHOUR=h;BYMINUTE=m
  Anything else throws. Do NOT add the `rrule` npm package (stale; tzid breaks after()).
- core/scheduling/next-occurrence.ts: Luxon, computed in the reminder's IANA zone.
- core/scheduling/rrule-to-human.ts: "Every Monday at 7:00 AM". The UI never says "cron".

- electron/scheduler/scheduler.ts:
    createScheduler({ now, repo, sink })  ← the clock is an INJECTED DEPENDENCY.
    Never call Date.now() inside. reconcile(cause) must be idempotent.
    Wire: app.whenReady() → reconcile('startup');  setInterval(30_000);
          powerMonitor.on('resume'|'unlock-screen') → reconcile.
    NEVER setTimeout to a due time.

- Overdue policy (08 §11):
    one-time, missed while CLOSED (cause==='startup' && lateBy > 2*TICK) → mark 'missed',
      DO NOT fire. A 9am alert at 6pm is noise.
    one-time, late by < 2 ticks → FIRE.
    recurring, any number missed → roll next_fire_at forward past now. Fire ZERO times.

- electron/scheduler/trigger-sink.ts — read 17 §1 carefully:
    notifier.show() and history.record() are UNCONDITIONAL and appear FIRST, outside any
    try block. TTS, audio and the modal go through a safely() wrapper. A TTS exception must
    not be able to skip the notification.

- electron/notifications/notifier.ts: main-process Notification; wire 'click' →
  win.show()+win.focus() (it is not automatic).

Then tests/unit/scheduler.test.ts and next-occurrence.test.ts:
- does NOT fire a reminder 30 days out          ← the 2^31-1 trap
- collapses 4 missed weekly occurrences into 0 fires + 1 roll-forward
- marks a one-time missed-while-closed reminder 'missed', not fired
- DOES fire a one-time reminder 45 seconds late
- caps a clock-jump storm at 20 fires
- reconcile twice fires once
- DST: a weekly 2:30 AM reminder across US spring-forward (2:30 does not exist)
- DST: 1:30 AM across fall-back (occurs twice) picks the first
- "every Monday at 7 AM" stays 7 AM wall-clock across a DST boundary

I cannot verify the DST cases manually — India has no DST. They must be unit tests.
```

---

## Day 4

### Prompt 13 — Tray, lifecycle, TTS, MP3, modals

```text
Read 12-ui-ux-specification.md §13-14, 07 §2, and 17 §1.

- electron/tray/tray.ts: module-scope ref; the full menu from 12 §14; tooltip; paused
  icon overlay; left-click toggles the window, right-click opens the menu; tray.destroy()
  in before-quit.
- electron/main/lifecycle.ts: close-to-tray; the one-time dialog.showMessageBox with the
  exact copy from 12 §13 and a "Don't show again" checkbox (persist tray_notice_shown);
  requestSingleInstanceLock (two schedulers on one WAL would double-fire);
  the window-all-closed guard for win32.
- electron/tts/: tts-coordinator.ts (catches everything, sets tts_degraded, one toast,
  never throws) plus whichever provider SPIKE-3 selected, behind the TTSService interface.
- electron/audio/audio-player.ts: sends 'audio:play' to the hidden window with a FILENAME
  KEY, not a path. Main resolves it against a hardcoded SOUNDS map. A path from IPC is a
  file-read primitive.
- electron/main/paths.ts: resourcePath() using process.resourcesPath when app.isPackaged.
  NEVER use __dirname for a resource — it points inside the asar when packaged.
- src/features/reminders/TriggerModal.tsx: role="alertdialog", focus trap, focus lands on
  Dismiss (safest default). HIDE Snooze when the reminder is recurring. Queue simultaneous
  triggers as "1 of 3". NEVER auto-dismiss on a timer.
- src/features/reminders/OverdueCatchupModal.tsx.

Then unit tests:
- fire() still calls notifier.show() when tts.speak() rejects
- fire() still calls notifier.show() when audioPlayer.play() throws
- snooze is refused on a recurring reminder
- resourcePath() returns an existing file in both packaged and unpackaged branches
```

---

## Day 5

### Prompt 14 — The audio pipeline

```text
Read docs/lifeos-planning/06-speech-to-text-research.md §6.

- public/worklets/pcm16-downsampler.js — a REAL FILE, not a bundled module.
  AudioWorklet.addModule() fetches a URL; Vite cannot bundle it into the main chunk.
  48k Float32 → linear interpolation → 16k → clamp → Int16 → post 3200-sample (200ms)
  frames with a TRANSFER, not a copy. Use AudioWorkletProcessor; ScriptProcessorNode is
  deprecated.
- Request echoCancellation and noiseSuppression. Do NOT trust a sampleRate:16000 constraint
  — the browser may ignore it. Always resample defensively.

BEFORE wiring the microphone, write a unit test that runs the SAME resampling function over
tests/fixtures/audio/remind-me-5-min.wav and feeds the output to the recognizer. If the
transcript is wrong here, the bug is the resampler, not the model. This bisection is the
difference between a two-hour bug and a lost day.

Then:
- src/hooks/useSpeech.ts: getUserMedia → worklet → window.lifeos.speech.pushAudio.
- electron/main/ipc/speech.ts: the 'speech:audio' handler with THREE guards — origin check,
  byteLength <= 64*1024 (a 200ms PCM16 frame is 6.4KB), and an active session. An
  unacknowledged channel that allocates is a memory-exhaustion primitive.
- electron/speech/speech-coordinator.ts: LAZY model load on first mic press; dispose after
  5 minutes idle. This is what keeps idle tray RAM under 250MB.
- electron/speech/sherpa-onnx-service.ts behind the SpeechService interface.
- src/features/chat/MicButton.tsx + LiveTranscript.tsx: the five states from 12 §5.1 with
  aria-live announcements; press-to-start/press-to-stop (not hold-to-talk); auto-stop after
  2s silence; 30s hard cap.

If the engine emits no partials, the live strip shows an animated "Listening…". The layout
must NEVER depend on partials existing.

Every speech failure — permission denied, no device, model load failure — must leave typed
input fully functional. The composer text box is never hidden and never disabled.
```

---

## Day 6

### Prompt 15 — The real cards, and the gate

```text
Read 12-ui-ux-specification.md §5.4-5.6 and 18 §8.

Implement src/features/chat/ConfirmationCard.tsx, ClarificationCard.tsx and
EditReminderForm.tsx, replacing the Day-2 dev form.

- The "When" row ALWAYS renders two lines: the absolute datetime ("Tomorrow — Saturday,
  11 July, 9:00 AM") and the relative form beneath ("in 15 hours 20 minutes"). Never only
  "Tomorrow". The user is about to trust a machine with their memory; show them what it
  actually wrote down.
- ClarificationCard has NO Confirm button. Not a disabled one. It must not exist in the DOM.
- Answering a clarification RE-RUNS the parser with merged slots. It never jumps to persistence.
- Confidence dot: green >= 0.8, amber 0.55-0.8. Confidence NEVER bypasses the gate.
- Keyboard: Enter confirms, E edits, Esc cancels.
- EditReminderForm validates live; a past datetime disables Save.

Then tests/unit/confirmation-card.test.tsx:
- rendering ConfirmationCard does not call onConfirm (rendering is not consenting)
- ClarificationCard renders no button matching /confirm/i
- the absolute date string appears in the DOM
```

---

### Prompt 16 — Settings and Reset

```text
Read 10 §10, 11 §10, and 12 §8.

- electron/services/reset-service.ts:
    resetLocalData() takes NO ARGUMENTS. The IPC handler signature is (event) => ...
    The path comes from app.getPath('userData'). Never from a setting, never from IPC.
    Two guards before fs.rm: the resolved path must end in `LifeOS` (or be the portable
    data dir) AND be at least 4 segments deep. Close the DB first. Retry once after 200ms
    on EBUSY, then tell the user to quit and reopen — never leave a half-deleted directory.
    This is the ONLY file that may import fs.rm.
- electron/services/secrets.ts: safeStorage. If isEncryptionAvailable() is false, REFUSE to
  persist the key and offer session-only memory storage. Never write a plaintext key.
  The key NEVER crosses IPC — settings:get destructures it out and returns hasApiKey:boolean.
- src/features/settings/*: the six sections from 12 §8.
- ResetDataModal: requires typing exactly "RESET" (lowercase is rejected); shows live counts
  of what will be destroyed; states plainly what will NOT be touched.

Then tests:
- settings:get response contains neither "sk-" nor "ciphertext"; hasApiKey === true
- resetLocalData's handler accepts no arguments
- a symlinked or shallow userData path throws UnsafeResetPathError and deletes nothing
```

---

## Day 7

### Prompt 17 — Package and verify

```text
Read 21-release-and-github-plan.md.

1. Bump to 0.1.0. Write CHANGELOG.md.
2. Verify electron-builder.yml: asarUnpack for any native .node module; extraResources for
   resources/models/stt and resources/audio; nsis.perMachine:false; createStartMenuShortcut.
3. Build both artifacts. Then verify asarUnpack by INSTALLING and RUNNING, not by reading
   the config.
4. Write .github/workflows/release.yml per 21 §3 (windows-latest, npm ci, typecheck, lint,
   unit, integration, electron-builder --publish always, then generate SHA256SUMS.txt).
5. Write README.md following the exact structure in 21 §5. Above the fold:
   - the demo GIF
   - the privacy paragraph
   - the SmartScreen instructions with a screenshot ("More info" → "Run anyway"), and the
     honest reason: LifeOS is unsigned because a certificate costs money this project
     doesn't have. NEVER tell a user to disable SmartScreen.
   - the "⚠️ Reminders need LifeOS running" warning
6. Write PRIVACY.md by copying Part A of 22-privacy-policy-and-disclosures.md verbatim.
7. Add LICENSE (MIT) and assets/audio/LICENSE.md recording the MP3's provenance.
8. tests/e2e/smoke.spec.ts (Playwright + _electron) against the PACKAGED exe:
   typed reminder → confirm → appears in Schedules → survives an app restart.

Then print the release checklist from 21 §11 for me to work through by hand.

Do not publish. The draft release is published by a human, after that human has downloaded
the artifact from GitHub and installed it on a machine that has never seen the source.
```

---

## Prompts to refuse

If a session drifts toward any of these, the correct response is to stop and cite the plan.

| If asked to… | Refuse, citing |
| --- | --- |
| Make the LLM create the reminder directly | Invariant 1; `09` §10 |
| "Just guess AM/PM to save the user a click" | Invariant 4; `08` §5 |
| `setTimeout` to the reminder's due time | Invariant 3; `08` §9 |
| Run a PowerShell command with the reminder text interpolated | Invariant 2; `07` §3.2 |
| Add `rrule` to compute the next occurrence | `02` A4 (stale, `tzid` bug) |
| Use `edge-tts` "because it sounds better" | `07` §4 — it is **cloud**; it would falsify PRIVACY.md |
| Use `vosk` npm | `06` §2 — `ffi-napi` does not run on Node ≥ 18.7 |
| Use `webkitSpeechRecognition` | `06` §3 — throws `network` in Electron |
| Add auto-start to Windows "for convenience" | `03` §4.2; requires explicit opt-in, v0.2 |
| Add Sentry / analytics "just for crashes" | `22` — crash reports contain reminders |
| Put the scheduler in the renderer | Invariant 3; renderer throttling |
| Import `fs` inside `core/` | Invariant 6 |
| Expose `ipcRenderer` "temporarily, for debugging" | Invariant 7; `16` §1 |
| Store the API key unencrypted "because safeStorage failed" | `09` §7 — refuse, offer session-only |
| Ship the dev CSP because prod "breaks styles" | `11` §5 — `style-src` may have `unsafe-inline`; `script-src` may not |

---

## A note on how to run these

The prompts are written to be **boring on purpose.** Each one names the plan document it
implements, states the invariant most likely to be violated, and asks for the tests that
prove it wasn't.

The failure mode this guards against is not Claude Code writing bad code. It is Claude Code
writing *plausible* code — a `setTimeout` that looks obviously correct, an `assign('meridiem', 1)`
that saves the user a click, a `rrule` import that is one line instead of fifteen. Each of
those produces software that passes a manual test on Day 4 and fails a user in March.

Run the manual test after every prompt. That is the whole method.
