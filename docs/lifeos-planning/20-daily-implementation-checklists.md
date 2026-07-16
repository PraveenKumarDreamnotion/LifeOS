# 20 — Daily Implementation Checklists

> Every step below uses the mandatory format from the brief's §25:
> **Goal · Files to create or update · Implementation instructions · Acceptance criteria · Manual test steps · Expected result in the app · Automated tests to add · Failure cases to test · Rollback or debugging notes**
>
> Steps are numbered continuously across the seven days. Do them in order. Do not skip a step's manual test because "it obviously works."

---

# DAY 1 — Foundation, spikes, and an installer

## Step 1: Scaffold the project with secure defaults

### Goal
An Electron 43 app that opens a window with `sandbox: true`, a strict CSP, and no security warnings in the console.

### Files to create or update
- `package.json`
- `electron.vite.config.ts`
- `tsconfig.json`
- `.eslintrc.json`
- `.npmrc`
- `electron/main/index.ts`
- `electron/main/windows.ts`
- `electron/main/session.ts`
- `electron/preload/index.ts`
- `src/app/main.tsx`, `src/app/App.tsx`
- `public/index.html`

### Implementation instructions
1. `npm create @quick-start/electron@latest lifeos -- --template react-ts`
2. Pin Electron **exactly**: `"electron": "43.1.0"` — no caret. Native-module ABI depends on it.
3. Add `"ignore-scripts": true` to `.npmrc`; allowlist `electron` explicitly.
4. In `windows.ts`, define `secureDefaults` (`11` §3): `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`, `spellcheck: false`.
5. In `session.ts`: CSP via `onHeadersReceived`, gated on `app.isPackaged`; `setPermissionRequestHandler` allowing only `media`; a default-deny `onBeforeRequest` filter.
6. Add navigation locks in `app.on('web-contents-created')`: `will-navigate`, `setWindowOpenHandler` → deny, `will-attach-webview` → prevent.
7. Add the ESLint overrides banning `child_process` everywhere and banning `electron`/`node:*` inside `core/`.
8. `app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')` and `app.setAppUserModelId('com.dreamnotion.lifeos')` — **both before any window is created.**

### Acceptance criteria
- The window opens.
- DevTools console shows **no** Electron security warnings.
- `typeof require` in the renderer console is `"undefined"`.
- `npm run lint` fails if you add `import cp from 'child_process'` to any file.

### Manual test steps
1. `npm run dev`.
2. Open DevTools in the renderer.
3. Type `require` → expect `Uncaught ReferenceError`.
4. Type `window.lifeos` → expect `undefined` (nothing exposed yet).
5. Scroll the console for `Electron Security Warning` — there must be none.

### Expected result in the app
An empty window titled LifeOS. Nothing else. No warnings.

### Automated tests to add
- `tests/unit/csp.test.ts`: `CSP_PROD` contains `script-src 'self'`, does not contain `unsafe-eval` or `ws:`.

### Failure cases to test
- Set `sandbox: false` → the security warning must reappear (proves the check is real).
- Add `eval('1')` to the renderer → CSP blocks it.
- Point `will-navigate` at `https://example.com` → navigation is refused.

### Rollback or debugging notes
If the CSP breaks Vite HMR, you have applied the production CSP in dev. Gate on `app.isPackaged`. If the preload fails to load with `require is not defined`, you are shipping CJS to a sandboxed preload — set `output.format: 'es'` in the preload build.

---

## Step 2: SPIKE-1 — verify `node:sqlite` in Electron 43

### Goal
Determine, in 60 minutes, whether the app can avoid native modules entirely.

### Files to create or update
- `spikes/sqlite-spike.ts` (throwaway; deleted after)

### Implementation instructions
1. In `electron/main/index.ts`, after `app.whenReady()`, add `const { DatabaseSync } = require('node:sqlite')`.
2. Open `path.join(app.getPath('userData'), 'spike.db')`.
3. `db.exec("PRAGMA journal_mode=WAL")` and read it back.
4. `CREATE TABLE t (id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title))>0))`.
5. Prepared insert with the parameter `'); DROP TABLE t;--`.
6. Read it back; assert the string is literal and `t` still exists.
7. Restart the app; assert the row persists.
8. **Package it** and repeat inside the installed app.

### Acceptance criteria
- No `--experimental-sqlite` flag needed.
- `journal_mode` returns `wal`.
- The injection string round-trips as literal text.
- The row survives a restart **and** survives packaging.

### Manual test steps
1. `npm run dev`, watch the main-process console for the assertions.
2. `npm run build:win`, install, launch, check `%APPDATA%\LifeOS\spike.db` exists.
3. Open it in DB Browser for SQLite; confirm the row.

### Expected result in the app
Nothing visible. The main-process console prints `SPIKE-1 PASS`.

### Automated tests to add
None — spike code is throwaway. Its criteria become `tests/integration/migrations.test.ts` on Day 2.

### Failure cases to test
- Delete `%APPDATA%\LifeOS\` mid-run → the driver recreates it.
- A `CHECK` violation (empty title) throws a catchable error.

### Rollback or debugging notes
**If `require('node:sqlite')` throws:** the fallback is decided, not debated. `npm i better-sqlite3`, add `"postinstall": "electron-builder install-app-deps"` and `asarUnpack: ["**/node_modules/better-sqlite3/**"]`. Budget +90 minutes on Day 2. Record the verdict in `25-risk-register.md`. Only `electron/database/drivers/*.ts` changes — that is why the driver interface exists.

---

## Step 3: SPIKE-5 + SPIKE-4 — package, install, toast, tray

### Goal
Prove on Day 1 what most teams discover on Day 7.

### Files to create or update
- `electron-builder.yml`
- `build/icon.ico`, `assets/icons/tray.ico`
- `electron/tray/tray.ts` (throwaway version)

### Implementation instructions
1. Write `electron-builder.yml` per `14` §5. **`nsis.perMachine: false`** — this is the no-admin guarantee.
2. `createStartMenuShortcut: true` — required for the toast AppUserModelID.
3. Build: `npx electron-builder --win`.
4. Install the NSIS artifact on a clean VM (or a second Windows user account) **as a standard user**.
5. Add a 5-second timer in main that calls `new Notification({title:'LifeOS', body:'hello'}).show()`.
6. Create the tray with the icon. **Hold the reference at module scope**: `let tray: Tray | null = null`.
7. Hide the window; leave the app running for 15 minutes.

### Acceptance criteria
- The installer shows **no UAC prompt**.
- The toast appears — including when the window is hidden.
- Clicking the toast shows and focuses the window.
- The tray icon is still present after 15 minutes.
- The tray icon is sharp at 125% and 150% display scaling.

### Manual test steps
1. Right-click `LifeOS-Setup-0.1.0.exe` → check it does **not** show the UAC shield.
2. Install. Watch for an elevation prompt — there must be none.
3. Task Manager → Details → LifeOS.exe → *Elevated* column = **No**.
4. Close the window to the tray. Wait 15 minutes. Look at the tray.
5. Settings → System → Display → Scale = 150%. Restart the app. Inspect the icon.

### Expected result in the app
Five seconds after launch, a Windows toast reading "LifeOS — hello". A tray icon that stays.

### Automated tests to add
None (packaging spike). The criteria become lines in `tests/manual/CHECKLIST.md`.

### Failure cases to test
- Declare `const tray = new Tray(...)` **inside** `whenReady()` (function scope) → the icon disappears after ~10 s in the packaged build. This is the GC bug; reproduce it once so you recognise it.
- Remove `app.setAppUserModelId(...)` and run **unpackaged** → the toast silently fails.

### Rollback or debugging notes
No toast? Confirm `setAppUserModelId` runs before window creation, and that the installer created a Start Menu shortcut. Unpackaged, pass `process.execPath`. Tray icon blurry? Ship a multi-resolution `.ico` (16 @72dpi, 20, 32 @144dpi), not a lone 16×16.

---

## Step 4: SPIKE-3 — TTS from a hidden window, in the tray

### Goal
Answer the single riskiest architectural question: **can Yogi speak while the window is hidden?**

### Files to create or update
- `public/audio-host.html`
- `electron/preload/audio.ts`
- `electron/main/windows.ts` (add `createAudioWindow`)

### Implementation instructions
1. Create a `BrowserWindow` with `show: false` and `webPreferences.backgroundThrottling: false`.
2. Load `audio-host.html`.
3. In it, wait for the **`voiceschanged`** event before calling `getVoices()`. Never call it synchronously first.
4. Expose `onSpeak` over `contextBridge`; on receipt, `speechSynthesis.speak(new SpeechSynthesisUtterance(text))`.
5. From main, `send('tts:speak', {text})` on a timer.
6. **Run this from the packaged, installed app.** Dev-mode results do not transfer.

### Acceptance criteria
- `getVoices()` returns ≥ 1 English voice (log their names).
- Yogi speaks with the main window **visible**.
- Yogi speaks with the main window **closed to the tray**.
- Yogi speaks after **10 minutes** of untouched idle in the tray. ← the real test
- Yogi speaks after a 5-minute laptop sleep, on `powerMonitor` resume.
- The MP3 also plays from the same hidden window while in the tray.

### Manual test steps
1. Install the packaged app.
2. Trigger a 30-second timer with the window visible → listen.
3. Close to tray, trigger again → listen.
4. Close to tray, set a 10-minute timer, **do not touch the machine** → listen.
5. Repeat with a 5-minute sleep in the middle.
6. Kill the audio window from Task Manager mid-test → the app must not crash.

### Expected result in the app
A voice from the speakers while no window is visible.

### Automated tests to add
None (platform behaviour). If the SAPI fallback is taken, add `tests/unit/sapi-tts.test.ts` asserting `!SCRIPT.includes('${')`.

### Failure cases to test
- Call `getVoices()` synchronously on load → expect `[]`. Reproduce it so the `voiceschanged` requirement is understood, not just copied.
- Machine with zero installed voices → `speak()` must fail silently; the toast must still fire.

### Rollback or debugging notes
**If the 10-minute tray test fails** (electron#31016 says it may): switch to `SapiTTSService` — main-process `spawn('powershell.exe', ['-NoProfile','-NonInteractive','-Command', CONSTANT_SCRIPT])` with the text on **stdin**, never interpolated (`07` §3.2). Move MP3 playback to a native main-process player. Delete the audio window. Budget +90 minutes on Day 4. Record the verdict.

---

## Step 5: SPIKE-0 — the backstop

### Goal
Prove the product's spine with **no database, no parser, no UI**.

### Files to create or update
- `electron/main/index.ts` (temporary block, deleted after)

### Implementation instructions
1. Hardcode `const due = Date.now() + 60_000`.
2. `setInterval(() => { if (Date.now() >= due && !fired) { fired = true; notify(); speak(); } }, 30_000)`.
3. **Do not use `setTimeout(fn, 60_000)`.** Build the muscle memory for the tick from the first line of scheduler code.

### Acceptance criteria
Sixty seconds after launch, a toast appears and Yogi speaks — from the packaged app, in the tray.

### Manual test steps
1. Launch the installed app. Close it to the tray. Wait. Watch. Listen.

### Expected result in the app
A toast and a voice, from an app with no features.

### Automated tests to add
None. This becomes `tests/unit/scheduler.test.ts` on Day 3.

### Failure cases to test
- Set `due = Date.now() + 30 * 86_400_000` and use `setTimeout` instead → **it fires immediately.** Reproduce the 24.8-day trap once, deliberately, so it is never rediscovered by a user.

### Rollback or debugging notes
If this fails, nothing else on the roadmap matters. Stop and fix. This is the product.

---

## Step 6: SPIKE-2 — sherpa-onnx, engine only

### Goal
In **120 minutes**, decide the STT provider. Not one minute more.

### Files to create or update
- `spikes/stt-spike.ts`
- `tests/fixtures/audio/remind-me-5-min.wav` (16 kHz mono PCM16, recorded in Audacity)

### Implementation instructions
1. `npm i sherpa-onnx-node` **on a machine with no Visual Studio Build Tools, no Python, no CMake.** That is the test.
2. Download a streaming Zipformer English model into `resources/models/stt/`.
3. Load the recogniser in the **main** process.
4. Read the fixture WAV, feed it frame-by-frame to `acceptWaveform(16000, …)`.
5. Print partials as they arrive. **Do not touch the microphone today.**

### Acceptance criteria
- Install completes with no compiler.
- The fixture WAV transcribes to approximately *"remind me in five minutes to call my mother"*.
- The first partial appears < 500 ms after the first frame.
- RAM with the model loaded < 350 MB.
- Ten load/dispose cycles return RAM to baseline.

### Manual test steps
1. `npm i sherpa-onnx-node` and watch for `node-gyp` output — there must be none.
2. Run the spike; read the transcript in the console.
3. Task Manager → note the memory before, during and after `dispose()`.

### Expected result in the app
Nothing visible. Console prints incremental partials, then the final transcript.

### Automated tests to add
None yet. On Day 5, the WAV becomes a regression fixture.

### Failure cases to test
- Feed the WAV at 48 kHz while telling the recogniser 16 kHz → garbage output. Reproduce this once; it is what a resampler bug looks like, and you must be able to recognise it on Day 5.

### Rollback or debugging notes
**At the 120-minute mark, stop.** If the transcript is wrong, switch to `TransformersJsSpeechService` (Whisper-base ONNX in the renderer, zero native modules, no IPC audio pipe) and accept 1–3 s pseudo-partials. If that also fails, defer voice entirely; SPIKE-0 already guarantees a shippable product. Record the verdict. **Do not extend the timebox** — that decision has already been made, on a day when you were not tired.

---

# DAY 2 — Database and repository

## Step 7: Database driver, pragmas, and migrations

### Goal
A versioned, WAL-mode SQLite database at `%APPDATA%\LifeOS\lifeos.db`.

### Files to create or update
- `electron/database/driver.ts`
- `electron/database/drivers/node-sqlite-driver.ts` (or `better-sqlite3-driver.ts`)
- `electron/database/open.ts`
- `electron/database/migrate.ts`
- `electron/database/migrations.ts` — **DAY-2 CORRECTION:** M001/M002 shipped as inline TS string constants (`M001_INITIAL`, `M002_MEMORY`), not `.sql` files. This removes all path-resolution risk when packaged (no `extraResources`, no `resourcePath()`), at the cost of losing `.sql` syntax highlighting. The SQL text is verbatim from `10` §5/§8.
- `tests/integration/migrations.test.ts`

### Implementation instructions
1. Define the 6-method `SqliteDriver` interface (`10` §2). All SQL goes through it.
2. Implement the driver chosen by SPIKE-1.
3. `open.ts`: resolve the path (honouring `PORTABLE_EXECUTABLE_DIR`), apply `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.
4. `migrate.ts`: read `PRAGMA user_version`; run each migration inside a transaction; bump the version inside the same transaction.
5. **Throw `DatabaseFromNewerVersionError`** if `user_version > migrations.length`.
6. Before the first migration on an existing DB, copy it to `lifeos.db.bak-v<n>`.
7. Write `M001_INITIAL` (in `migrations.ts`) exactly as in `10` §5 — including every `CHECK` constraint and the partial index `idx_reminders_due`.

### Acceptance criteria
- Fresh DB reaches `user_version = 2`.
- Re-running `migrate()` is a no-op.
- `journal_mode` is `wal`.
- A DB with `user_version = 99` refuses to open.
- A migration that throws leaves `user_version` unchanged.

### Manual test steps
1. `npm run dev`. Confirm `%APPDATA%\LifeOS\lifeos.db` exists.
2. Open it in DB Browser for SQLite. Check `PRAGMA user_version` → `2`.
3. Confirm the `reminders`, `reminder_history`, `settings`, `app_logs`, `memories`, `conversations` tables exist.
4. Manually set `user_version = 99`, relaunch → expect a clear error dialog, not a crash.

### Expected result in the app
No visible change. The database file exists, correctly shaped.

### Automated tests to add
- Fresh DB → `user_version = 2`.
- Idempotent re-run.
- `user_version = 99` throws `DatabaseFromNewerVersionError`.
- A deliberately broken migration rolls back.
- `PRAGMA journal_mode` returns `wal`.

### Failure cases to test
- Read-only `%APPDATA%` → a clear fatal dialog with the exact path. **Never fall back to a temp directory** — an app that silently forgets is worse than one that will not start.
- Corrupted DB file → `PRAGMA integrity_check` fails → offer Restore backup / Reset.

### Rollback or debugging notes
Migrations are forward-only and never destructive: no `DROP TABLE`, no `DROP COLUMN`. If a migration fails in development, delete `%APPDATA%\LifeOS\lifeos.db` and rerun — **never** in production. The `.bak-v<n>` copy is the production rollback.

---

## Step 8: Reminder repository

### Goal
Create, list, find-due, update, delete, pause — all parameterized.

### Files to create or update
- `core/types/reminder.ts`
- `electron/database/rows.ts`
- `electron/database/reminder-repository.ts`
- `electron/database/history-repository.ts`
- `electron/database/settings-repository.ts`
- `tests/integration/reminder-repository.test.ts`

### Implementation instructions
1. Define the `Reminder` domain model with **`scheduledAt` and `nextFireAt` as separate columns** (`15` §1). This is the most important line in the schema.
2. Store times as **epoch-ms integers**; store the IANA `timezone` separately. Never a `Date`, never an ISO string in the DB.
3. `toDomain(row)` maps snake_case → camelCase and `0|1` → boolean.
4. `create()`, `get()`, `list()`, `update()`, `delete()`, `pause()`, `setNextFireAt()`, `markTriggered()`, `markMissed()`.
5. `findDue(now)`: `WHERE status='pending' AND is_paused=0 AND next_fire_at <= ? ORDER BY next_fire_at LIMIT 20`.
6. **Every** query uses `?` placeholders. Zero template literals in SQL.

### Acceptance criteria
- A reminder can be created, listed, updated and deleted.
- Data survives an app restart.
- `findDue` excludes paused rows and caps at 20.
- A SQL-injection title is stored as literal text.
- An empty title is rejected by the `CHECK` constraint.

### Manual test steps
1. Create a reminder through the temporary dev form.
2. Close LifeOS completely (Quit).
3. Reopen LifeOS.
4. Navigate to Active Schedules.

### Expected result in the app
The reminder still appears in Active Schedules with the correct title and scheduled time.

### Automated tests to add
- Create / list / update / delete.
- Persistence across close + reopen.
- Injection title round-trips literally; `reminders` table survives.
- Empty title rejected at the DB level.
- Unknown `action_type` rejected.
- `findDue` excludes paused; caps at 20.
- Deleting a reminder cascades its history.

### Failure cases to test
- Empty title.
- `scheduled_at` in the past (rejected at the handler, not the DB — the DB stores history).
- Invalid recurrence rule string.
- Database file locked / unavailable.
- Duplicate reminder id (primary-key violation).

### Rollback or debugging notes
If a migration fails, delete only the **local development** database and rerun migrations. Never delete a user's database to fix a bug. If `findDue` returns nothing when it should, check `is_paused` and confirm `next_fire_at` is epoch **milliseconds**, not seconds — a factor-of-1000 error puts every reminder in 1970.

---

## Step 9: IPC layer and the dev form

### Goal
Prove the renderer → preload → main → SQLite path, with validation.

### Files to create or update
- `core/types/ipc.ts`
- `electron/preload/index.ts`
- `electron/main/ipc/{index,reminders}.ts`
- `src/lib/ipc.ts`
- `src/hooks/useReminders.ts`
- `src/features/schedules/SchedulesScreen.tsx` (minimal)

### Implementation instructions
1. `CH` constant: every channel name, one place, imported by preload **and** main.
2. Preload exposes named functions only. `Object.freeze` the API. Strip the `IpcRendererEvent` from listener callbacks.
3. Every handler wraps in `guard()`: origin check → `Zod.parse().strict()` → business rules → act → `broadcast(REMINDERS_CHANGED)` → return a plain object.
4. Handlers **return `Result<T>`**, never reject.
5. Build the throwaway dev form: title, `datetime-local`, repeat select. 75 minutes. Ugly is correct.

### Acceptance criteria
- `window.lifeos.ipcRenderer` is `undefined`.
- `Object.isFrozen(window.lifeos)` is `true`.
- An unknown key on `reminders:create` is rejected.
- A past date returns `{ ok:false, error:{ code:'date_in_past' }}`.
- No stack trace ever crosses IPC.

### Manual test steps
1. In DevTools: `window.lifeos.reminders.create({title:'x', action:'exec'})` → `ok:false`.
2. `window.lifeos.ipcRenderer` → `undefined`.
3. Use the dev form to create a reminder; it appears in the list.

### Expected result in the app
A crude form and a plain list. Creating a reminder updates the list immediately.

### Automated tests to add
- `tests/integration/ipc-contracts.test.ts`: unknown key rejected; past date rejected; no stack trace in any response; **every registered channel appears in `CH`**.

### Failure cases to test
- Send `{ __proto__: {...} }` → `.strict()` rejects.
- Call `reminders:delete` with `'not-a-uuid'` → clean error, no stack.
- Register a handler with a bare string literal not in `CH` → the anti-drift test fails the build.

### Rollback or debugging notes
`require is not defined` in the preload means it is being emitted as CommonJS — a sandboxed preload cannot `require` across files. Set `preload.build.rollupOptions.output.format = 'es'` in `electron.vite.config.ts`. If IPC returns `undefined`, you returned a `Date` or a class instance; only structured-cloneable plain objects survive.

---

# DAY 3 — Parser, scheduler, notifications

## Step 10: The fixture corpus (before the parser)

### Goal
Write the specification as data, then make it pass.

### Files to create or update
- `tests/fixtures/commands.json`
- `tests/unit/parse-reminder.test.ts`

### Implementation instructions
1. Transcribe **all 14** example commands from the brief's §7, verbatim.
2. Transcribe **all 8** ambiguity cases from the brief's §10, verbatim.
3. Add every row of `17` §3.
4. Add phrasing variants: `in`/`after`, `AM`/`am`/`a.m.`, `Monday`/`mon`, `tomorrow`/`tonight`.
5. Choose `refDate` **adversarially**: a Friday (so `next Friday` is not trivially +7), 23:55 (so `in 10 minutes` crosses midnight), 31 December (so it crosses a year).
6. Target **120 fixtures**. Each is `{ input, refDate, expect }`.

### Acceptance criteria
- 120 fixtures exist.
- The test file runs and **fails 120 times** (there is no parser yet). That is success.

### Manual test steps
None. This step has no runtime behaviour.

### Expected result in the app
No change. `npx vitest run` prints 120 red lines — your to-do list.

### Automated tests to add
The corpus itself, driven by `describe.each`.

### Failure cases to test
The corpus **is** the failure-case list. Every clarification and refusal case is a fixture.

### Rollback or debugging notes
Keep it as **JSON, not TypeScript** — so that a tired future you can add a failing case on Day 6 without touching test code.

---

## Step 11: Intent, recurrence, title, ambiguity

### Goal
Turn text into a validated `ParseResult`, and refuse to guess.

### Files to create or update
- `core/parsing/{parse-reminder,detect-intent,extract-recurrence,extract-title,detect-ambiguity,score-confidence,clarification}.ts`
- `tests/unit/detect-ambiguity.test.ts`

### Implementation instructions
1. `detectIntent`: closed allow-list. Check **sing patterns first** (more specific).
2. `extractRecurrence`: **chrono cannot do this.** Match `every|each <weekday>` → weekly; `daily|every day` → daily; `every month|every other|every N days` → **`unsupported`**, refuse honestly.
3. Strip only the `every` token, leaving the weekday for chrono to anchor.
4. `chrono.parse(strippedText, refDate, { forwardDate: true })` — the option is **mandatory**; without it `"Friday"` on a Saturday resolves to *last* Friday.
5. `detectAmbiguity` using `result.start.isCertain(component)`:
   - `isCertain('hour') === false` → `missing_time`
   - `isCertain('meridiem') === false && hour <= 12` → `ambiguous_meridiem` — **check this first, and never auto-assign**
   - recurrence + no certain hour → `recurrence_without_time`
6. `scoreConfidence` per `08` §6.
7. `parseReminder` returns a **discriminated union**: `{ok:true, reminder}` | `{ok:false, kind:'clarification'}` | `{ok:false, kind:'refusal'}`.

### Acceptance criteria
- 120/120 fixtures pass.
- `"every Monday at 7 AM to exercise"` → `FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0`, **not** a one-time reminder.
- `"remind me at 6"` asks AM or PM.
- `"remind me every month"` refuses, offering a one-time reminder instead.
- `parseReminder` never throws for ordinary input; ambiguity is a *result*, not an exception.

### Manual test steps
1. Type `remind me every Monday at 7 AM to exercise` → card shows **Every Monday at 7:00 AM**.
2. Type `remind me at 6` → Yogi asks *"Six in the morning, or six in the evening?"*
3. Type `what's the weather` → polite refusal with example chips.

### Expected result in the app
A crude confirmation card showing the interpreted title, absolute datetime and recurrence — or a clarification question with time chips.

### Automated tests to add
- The 120-fixture corpus.
- `isCertain` behaviour for `"at 6"`, `"at 18"`, `"at 6 PM"`.
- `forwardDate`: `"next Friday"` parsed **on a Friday** yields +7 days, not −0.

### Failure cases to test
- `remind me every month on the 1st` → refusal, not a silent one-time reminder. **This is the highest-severity parser bug**; it fails plausibly.
- `remind me in 5 million minutes` → `date_too_far`.
- `remind me on 31 February` → `invalid_date`.
- `remind me in 5 minutes to $(rm -rf /)` → the title is stored as literal text.

### Rollback or debugging notes
If `"every Monday"` produces a one-time reminder, `extractRecurrence` is not running before chrono. If `"next Friday"` lands in the past, `forwardDate: true` is missing. If ambiguity is never detected, you are using `chrono.parseDate()` — it discards the `isCertain` metadata. Use `chrono.parse()`.

---

## Step 12: The scheduler

### Goal
Fire reminders at the right time, across restarts, sleeps and 30-day horizons.

### Files to create or update
- `core/scheduling/{rrule,next-occurrence,rrule-to-human}.ts`
- `electron/scheduler/{scheduler,trigger-sink,overdue}.ts`
- `electron/notifications/notifier.ts`
- `tests/unit/{scheduler,next-occurrence,rrule}.test.ts`

### Implementation instructions
1. `createScheduler({ now, repo, sink })` — **the clock is a dependency.** Never call `Date.now()` inside.
2. `reconcile(cause)`: query `findDue(now())`, fire, then roll forward or mark triggered.
3. Wire three triggers: `app.whenReady()` → `reconcile('startup')`; `setInterval(30_000)`; `powerMonitor.on('resume'|'unlock-screen')`.
4. **Never `setTimeout` to a reminder's due time.** The 32-bit cap fires far-future reminders immediately.
5. Overdue policy (`08` §11): one-time missed while **closed** → `missed`, do **not** fire. Recurring missed → roll forward, fire **zero** times. Missed while running by < 2 ticks → fire.
6. `nextOccurrenceAfter` with **Luxon**, in the reminder's IANA zone. Do not add the `rrule` dependency (`02` A4).
7. `trigger-sink.fire()`: notification and history are **unconditional**; TTS, audio and the modal are wrapped in `safely()`.

### Acceptance criteria
- A reminder 2 minutes out fires a real Windows toast.
- A reminder 30 days out does **not** fire immediately.
- Four missed weekly occurrences produce 0 fires and 1 roll-forward.
- `reconcile` is idempotent.
- A throw from the TTS mock does not prevent the notification.

### Manual test steps
1. Create a reminder 2 minutes out. Minimise. Wait. → toast.
2. Create one 1 minute out. Quit LifeOS. Wait 3 minutes. Reopen. → catch-up modal says *missed*; it does **not** fire late.
3. Create a weekly reminder. Move the system clock forward 3 weeks. Reopen. → fires zero times, rolls to next Monday.
4. Sleep the laptop through a reminder; wake it. → fires on resume.

### Expected result in the app
Windows toasts at the right times. An honest catch-up modal on startup.

### Automated tests to add
- Does **not** fire a 30-days-out reminder (the `setTimeout` trap).
- Collapses 4 missed weekly occurrences into 0 fires + 1 roll-forward.
- Marks one-time missed-while-closed as `missed`, not fired.
- **Does** fire a one-time reminder 45 s late.
- Caps a clock-jump storm at 20 fires.
- `reconcile` twice fires once.
- DST spring-forward (2:30 AM does not exist) and fall-back (1:30 AM twice).

### Failure cases to test
- `setTimeout(fire, 30 * 86_400_000)` → fires immediately. Reproduce once, deliberately.
- Recurrence rule `FREQ=MONTHLY` in the DB → `status='error'`, surfaced as *"This reminder needs attention"*, never silently dropped.
- 100 reminders due at once → 20 fire, banner explains.

### Rollback or debugging notes
Reminder never fires? Check `is_paused`, check `status='pending'`, and check `next_fire_at` is milliseconds. Reminder fires instantly? You used `setTimeout` with a delay over 2³¹−1 ms. Reminder fires four times after a holiday? You are looping `+1 week` instead of recomputing past `now`.

---

# DAY 4 — Tray, TTS, MP3, modals

## Step 13: Tray and close-to-tray

### Goal
LifeOS lives in the tray, and says so once.

### Files to create or update
- `electron/tray/tray.ts`
- `electron/main/lifecycle.ts`

### Implementation instructions
1. `let tray: Tray | null = null` at **module scope** — the GC bug.
2. Menu: Open · View Active Schedules · Pause/Resume Reminders · *(disabled status label)* · Quit.
3. `win.on('close', e => { if (!isQuitting) { e.preventDefault(); win.hide(); } })`.
4. `app.on('before-quit', () => { isQuitting = true })`.
5. Guard `window-all-closed` so hiding the last window does **not** quit on Windows.
6. First close → `dialog.showMessageBox` with the exact copy from `12` §13 and a "Don't show again" checkbox. Persist `tray_notice_shown`.
7. `app.requestSingleInstanceLock()` — two schedulers on one WAL would double-fire.

### Acceptance criteria
- ✕ hides; the app keeps running; reminders still fire.
- The dialog appears exactly once, ever.
- Quit from the tray exits fully.
- A second launch focuses the first window.
- Tray icon alive after 15 minutes, packaged.

### Manual test steps
1. Click ✕ → dialog appears → app is in the tray.
2. Click ✕ again → no dialog.
3. Create a reminder 2 minutes out, close to tray, wait → toast fires.
4. Launch the exe again → the existing window focuses; no second instance.
5. Tray → Quit. Confirm the process is gone from Task Manager.

### Expected result in the app
A tray icon with a working menu, and a one-time explanation.

### Automated tests to add
- Unit: `close` with `isQuitting=false` calls `hide()`, not `destroy()`.
- Unit: `window-all-closed` does not call `app.quit()` on `win32`.

### Failure cases to test
- Declare the `Tray` in function scope → icon vanishes after ~10 s **packaged**. Reproduce once.
- Remove the `window-all-closed` guard → the app dies the moment you close the window.
- Launch twice without the single-instance lock → two schedulers, doubled toasts.

### Rollback or debugging notes
Icon gone after 10 seconds? The `Tray` was garbage-collected. Move the reference to module scope. App exits on close? The `window-all-closed` guard is missing.

---

## Step 14: TTS, MP3, and failure isolation

### Goal
Yogi speaks — and if he cannot, the reminder still arrives.

### Files to create or update
- `electron/tts/{tts-coordinator,web-speech-service}.ts` (or `sapi-tts-service.ts`)
- `electron/audio/audio-player.ts`
- `public/audio-host.html`
- `resources/audio/yogi-song.mp3`, `assets/audio/LICENSE.md`
- `electron/scheduler/trigger-sink.ts`

### Implementation instructions
1. Implement whichever provider SPIKE-3 selected, behind `TTSService`.
2. Gate on `voiceschanged` before `getVoices()`. Always.
3. `audio:play` carries a **filename key**, not a path. Main resolves it against a hardcoded map. A path from IPC is a file-read primitive.
4. `resourcePath()` for all assets — **never `__dirname`**, which points inside the asar when packaged.
5. In `fire()`, put `notifier.show()` and `history.record()` **first and outside** any try that could skip them. Wrap TTS, audio and the modal in `safely()`.
6. Source a royalty-free MP3, ≤ 15 s, ≤ 500 KB. Record its provenance in `assets/audio/LICENSE.md`.

### Acceptance criteria
- The reminder is spoken while the app is in the tray.
- `action_type='sing'` plays the MP3 from the tray.
- Throwing from `tts.speak()` does **not** prevent the toast.
- A machine with zero voices degrades to silence + one toast, and still notifies.

### Manual test steps
1. Reminder 2 minutes out, close to tray → toast **and** voice.
2. Type `please sing after 1 minute`, close to tray → the song plays.
3. Settings → disable *Speak reminders aloud* → toast only.
4. Uninstall all Windows voices (or stub `getVoices()` to `[]`) → the toast still fires.

### Expected result in the app
A voice and a song from a hidden application.

### Automated tests to add
- Unit: `fire()` still calls `notifier.show()` when `tts.speak()` rejects.
- Unit: `fire()` still calls `notifier.show()` when `audioPlayer.play()` throws.
- Unit (SAPI only): `expect(SCRIPT).not.toContain('${')`.
- Integration: `yogiSongPath()` exists in both packaged and unpackaged branches.

### Failure cases to test
- Delete `yogi-song.mp3` from `resources/` → log an error, fire the toast, skip the song.
- Kill the audio window mid-reminder → recreated; no crash.
- Two reminders fire at once → `speechSynthesis.cancel()` then speak the newer.

### Rollback or debugging notes
Silent in the tray? SPIKE-3's fallback is already specified: `SapiTTSService`, text over stdin, never interpolated. MP3 silent? Confirm `autoplay-policy` was appended **before** any window was created. Asset 404 in the installer? You used `__dirname`; use `resourcePath()`.

---

## Step 15: Trigger modal and overdue catch-up

### Goal
Make the reminder actionable, and the app honest about what it missed.

### Files to create or update
- `src/features/reminders/{TriggerModal,OverdueCatchupModal}.tsx`
- `electron/scheduler/overdue.ts`

### Implementation instructions
1. `TriggerModal`: `role="alertdialog"`, focus trap, focus lands on **Dismiss** (safest default).
2. **Hide Snooze for recurring reminders** — snoozing a weekly reminder is ambiguous, and we refuse to guess.
3. Queue simultaneous triggers: `1 of 3`, advancing.
4. **Never auto-dismiss on a timer.** A reminder the user never saw is a failed reminder.
5. `OverdueCatchupModal` lists what fired while closed, separating *missed* one-time from *rolled-forward* recurring.

### Acceptance criteria
- The modal appears and focuses the window when a reminder fires.
- Snooze is absent on recurring reminders.
- Three simultaneous reminders queue rather than stack.
- The catch-up modal appears once, on startup, only when something was overdue.

### Manual test steps
1. Reminder 1 minute out, window visible → modal appears; Yogi speaks; Escape dismisses.
2. Create a weekly reminder due in 1 minute → the modal has no Snooze button.
3. Create three reminders for the same minute → modal shows `1 of 3`.
4. Create a reminder 1 minute out, Quit, wait 3 minutes, reopen → catch-up modal says *missed*.

### Expected result in the app
A calm modal with Dismiss / Done, and an honest startup summary.

### Automated tests to add
- Unit: snooze is refused on a recurring reminder (`sing_not_recurring` sibling rule).
- Unit: overdue policy — one-time-while-closed → `missed`; recurring → rolled forward, zero fires.
- Renderer: the modal does not auto-close on a timer.

### Failure cases to test
- Delete the reminder while its modal is open → *"This reminder was removed."* and close.
- 20 reminders due at once → the modal queue does not lock the UI.

### Rollback or debugging notes
Modal never appears but the toast does? The renderer is not listening on `reminder:trigger`, or `mainWindow` is null — which is fine, and exactly why the toast is unconditional.

---

# DAY 5 — Speech-to-text

## Step 16: AudioWorklet and the resampler

### Goal
Convert 48 kHz Float32 microphone audio into 16 kHz mono PCM16 — correctly.

### Files to create or update
- `public/worklets/pcm16-downsampler.js`
- `src/hooks/useSpeech.ts`

### Implementation instructions
1. Write the worklet as a **real file** in `public/worklets/` — `AudioWorklet.addModule()` fetches a URL; Vite cannot bundle it into the main chunk.
2. Linear-interpolate 48 k → 16 k; clamp to `[-1, 1]`; scale to Int16.
3. Post 3200-sample (200 ms) frames with a **transfer**, not a copy.
4. Request `echoCancellation` and `noiseSuppression`; **do not trust** a `sampleRate: 16000` constraint — the browser may ignore it. Always resample defensively.
5. **Before touching the microphone**, feed the fixture WAV through the same resampling function in a unit test.

### Acceptance criteria
- The fixture WAV, resampled by this code, still transcribes correctly.
- Live mic frames are exactly 6,400 bytes.
- `ScriptProcessorNode` appears nowhere (it is deprecated).

### Manual test steps
1. Run the resampler unit test against the fixture WAV.
2. Press the mic; log `frame.byteLength` → 6400.
3. Speak; watch frames arrive roughly every 200 ms.

### Expected result in the app
No visible change yet. Console shows a steady frame cadence.

### Automated tests to add
- Unit: a 48 kHz sine wave in → a 16 kHz sine of the same frequency out (3:1 decimation).
- Unit: Float32 `1.0` → Int16 `32767`; `-1.0` → `-32768`; `2.0` clamps.

### Failure cases to test
- Feed 44.1 kHz audio → the ratio is non-integer; assert no crash and no NaN.
- Mic returning stereo → only channel 0 is used.

### Rollback or debugging notes
**If the transcript is garbage, suspect the resampler before the model.** That is why the fixture WAV exists. Feed the WAV straight to the recogniser (bypassing the worklet). If it transcribes, the bug is in your resampling. If it does not, the bug is in the model or its configuration. Skipping this bisection is the single most common way to lose a day here.

---

## Step 17: Sherpa service, partials, mic button

### Goal
Live transcription, with every failure degrading to typed input.

### Files to create or update
- `electron/speech/{speech-coordinator,sherpa-onnx-service}.ts`
- `electron/main/ipc/speech.ts`
- `src/features/chat/{MicButton,LiveTranscript}.tsx`

### Implementation instructions
1. `SpeechCoordinator` owns the model lifecycle: **lazy load on first mic press**, dispose after 5 minutes idle (`13` §11). This is what keeps idle tray RAM under 250 MB.
2. `speech:audio` handler: three guards — origin, `byteLength <= 64 * 1024`, and an active session. An unacknowledged channel that allocates is a memory-exhaustion primitive.
3. Broadcast `speech:partial` only when the text actually changed.
4. Mic states: idle / initializing / listening / processing / error, each with an `aria-live` announcement.
5. Press-to-start, press-to-stop. Not hold-to-talk — hostile for long sentences.
6. Auto-stop after 2 s of silence; hard cap 30 s.
7. **If the engine emits no partials, the live strip shows an animated "Listening…".** The layout must never depend on partials existing.

### Acceptance criteria
- First partial < 500 ms after speech onset.
- Windows asks for mic permission exactly once, on **first press** — not during onboarding.
- Denying permission leaves typed input fully functional.
- Idle tray RAM without STT loaded < 250 MB.
- Ten start/stop cycles return RAM to baseline.

### Manual test steps
1. Press the mic. Windows prompts for permission. Accept.
2. Speak `remind me tomorrow at 9 AM to attend the meeting`.
3. Watch words appear as you speak.
4. Stop. The confirmation card shows **Saturday, 11 July, 9:00 AM**.
5. Windows Settings → deny microphone access → press the mic → a banner explains; typing still works.
6. Task Manager: memory before first press, after, and 5 minutes later.

### Expected result in the app
Live text appearing word by word, then a confirmation card with an absolute date.

### Automated tests to add
- Integration: an oversized (1 MB) frame is dropped without allocating.
- Integration: frames with no active session are dropped.
- Unit: `speech:start` twice returns the same `sessionId` (idempotent).

### Failure cases to test
- Mic permission denied → typed input unaffected.
- No microphone device → mic in `error` state, tooltip explains.
- Mic unplugged mid-utterance → session stops, the partial transcript is kept in the input box.
- Model fails to load → mic disabled, `[Retry]` offered, typing works.
- Speak for 40 s → hard-stopped at 30 s, transcribes what it has.

### Rollback or debugging notes
**Hard stop at 8 hours.** Voice is Tier 1, not Tier 0; the other 20 Definition-of-Done points already pass. If it is not working, cut it: record the decision in `25-risk-register.md`, state it in the README, and ship. A LifeOS that reads is better than a LifeOS that does not exist.

---

# DAY 6 — Onboarding, settings, history, polish

## Step 18: The real confirmation and clarification cards

### Goal
Make the confirmation gate beautiful, honest and unbypassable.

### Files to create or update
- `src/features/chat/{ConfirmationCard,ClarificationCard,EditReminderForm}.tsx`
- `src/styles/tokens.css`
- `tests/unit/confirmation-card.test.tsx`

### Implementation instructions
1. The **When** row always shows two lines: the absolute datetime, and the relative form beneath it.
2. `ClarificationCard` has **no Confirm button**. Not a disabled one. It does not exist.
3. Answering a clarification **re-runs the parser** with merged slots. It never jumps to persistence.
4. Confidence dot: green ≥ 0.8, amber 0.55–0.8. Confidence never bypasses the gate.
5. Keyboard: `Enter` confirms, `E` edits, `Esc` cancels.
6. `EditReminderForm` validates live; a past datetime disables Save.

### Acceptance criteria
- The card shows `Tomorrow — Saturday, 11 July, 9:00 AM` **and** `in 15 hours 20 minutes`.
- Rendering the card creates nothing.
- `ClarificationCard` has no Confirm button.
- The only path to `repo.create()` is a Confirm press.

### Manual test steps
1. Type `remind me tomorrow at 9 AM to attend the meeting` → read both date lines.
2. Do **not** press Confirm. Check Active Schedules → empty. Restart the app → still empty.
3. Type `remind me at 6` → no Confirm button anywhere on the card.
4. Answer `6 PM` → a confirmation card appears with 6:00 PM.

### Expected result in the app
A card that shows exactly what will be stored, and stores nothing until asked.

### Automated tests to add
- Rendering `ConfirmationCard` does not call `onConfirm`.
- `ClarificationCard` renders no `button[name=/confirm/i]`.
- The absolute date string is present in the DOM.

### Failure cases to test
- Stare at an `in 60 seconds` card for 90 s, then press Confirm → the 5-second grace rule applies; anything staler gives `date_in_past` with the card still open and the input intact.
- Double-click Confirm → exactly one reminder is created.

### Rollback or debugging notes
If a reminder appears without a Confirm press, grep for `toCreateInput` — there must be exactly two call sites (Confirm, and the Edit form's Save). Any third is the bug.

---

## Step 19: Settings and Reset Local Data

### Goal
The most destructive operation in the app, made safe.

### Files to create or update
- `src/features/settings/*.tsx`
- `src/features/settings/ResetDataModal.tsx`
- `electron/services/reset-service.ts`
- `electron/services/secrets.ts`

### Implementation instructions
1. `resetLocalData()` takes **no arguments**. The IPC handler signature is `(event) => …`.
2. The path comes from `app.getPath('userData')`. Never from a setting, never from IPC.
3. Two guards: the resolved path must end in `LifeOS` (or be the portable data dir), and be ≥ 4 segments deep.
4. Close the DB before `fs.rm`. Retry once after 200 ms on `EBUSY`.
5. The modal requires typing **`RESET`** exactly, and enumerates live counts of what will be destroyed.
6. `fs.rm` may be imported in **this file only** (ESLint override).
7. API key: `safeStorage`. If `isEncryptionAvailable()` is false, **refuse to persist it**; offer session-only. Never write a plaintext key.

### Acceptance criteria
- Typing `reset` (lowercase) leaves the button disabled.
- Reset deletes `%APPDATA%\LifeOS\` and nothing else.
- After reset the app relaunches into onboarding.
- `settings:get` never returns the key, under any name.

### Manual test steps
1. Create 3 reminders. Settings → Reset → read the counts. Type `reset` → button disabled. Type `RESET` → enabled.
2. Confirm. App relaunches into onboarding. `%APPDATA%\LifeOS\` is gone.
3. Create a folder `C:\Test\LifeOS`, symlink `userData` to `C:\` → expect `UnsafeResetPathError` and nothing deleted.
4. DevTools: `await window.lifeos.settings.get()` → search the JSON for `sk-`. Nothing.

### Expected result in the app
A modal that is hard to trigger accidentally, and a clean slate afterwards.

### Automated tests to add
- `settings:get` response contains neither `sk-` nor `ciphertext`; `hasApiKey === true`.
- `resetLocalData` handler accepts no arguments.
- A symlinked/shallow path throws `UnsafeResetPathError`.

### Failure cases to test
- `userData` symlinked to `C:\` → refuse.
- `fs.rm` `EBUSY` → retry, then a clear message. **Never a half-deleted directory.**
- `safeStorage.isEncryptionAvailable() === false` → refuse to store; explain.

### Rollback or debugging notes
There is no rollback from Reset. That is the point, and why it costs six keystrokes. If `EBUSY` recurs, the WAL is still held: `db.close()` must run **before** `fs.rm`, not concurrently.

---

# DAY 7 — Release

## Step 20: Package, verify, publish

### Goal
A stranger downloads an exe and it works.

### Files to create or update
- `README.md`, `PRIVACY.md`, `LICENSE`, `CHANGELOG.md`
- `.github/workflows/release.yml`
- `release/SHA256SUMS.txt`

### Implementation instructions
1. Version `0.1.0`. `productName: LifeOS` — it determines `%APPDATA%\LifeOS\`.
2. `npx electron-builder --win` → NSIS + portable.
3. Verify `asarUnpack` by **installing and running**, not by reading the config.
4. Install on a **fresh Windows VM** as a standard user.
5. Run the full manual checklist (`18` §10).
6. Procmon: no writes outside `%APPDATA%\LifeOS\` and `%LOCALAPPDATA%\Programs\LifeOS\`.
7. **Wireshark: AI Assist off, 30-minute session including a fired reminder → zero packets.**
8. Generate SHA-256 checksums.
9. `GH_TOKEN=… npx electron-builder --win --publish always` → a draft release.
10. Write the README: privacy, the "LifeOS must be running" limitation, SmartScreen steps with a screenshot, supported commands, demo GIF.
11. Download the **published** artifact on a **different** machine and install it.

### Acceptance criteria
All 23 points of the brief's §27 pass, from the published artifact, on a machine that has never seen the source.

### Manual test steps
The complete `tests/manual/CHECKLIST.md`. Every line. No skipping the ones that "obviously" work — the tray GC bug and the AUMID bug both look like they obviously work.

### Expected result in the app
Install → onboarding → speak a reminder → confirm → get reminded. Without admin. Without network.

### Automated tests to add
- `tests/e2e/smoke.spec.ts` against the **packaged** exe: typed reminder → confirm → appears in schedules → survives restart.

### Failure cases to test
- Install as a standard (non-admin) user → no UAC.
- Run the **portable** exe → toasts still appear (it has no Start Menu shortcut; the AUMID must be set explicitly).
- Uninstall → `%APPDATA%\LifeOS\` remains. It is the user's data, not the installer's.
- Download over a metered connection with AI Assist off → zero packets.

### Rollback or debugging notes
Native module missing at runtime? `asarUnpack` is wrong; verify by browsing the installed `resources/app.asar.unpacked/`. Model not found? You used `__dirname`; use `resourcePath()`. If a release-blocking bug appears after the **12:00 feature freeze**, delete the draft release, fix, rebuild, and re-verify from step 4. Never publish a hotfix you have not installed from GitHub yourself.
