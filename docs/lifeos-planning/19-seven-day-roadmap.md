# 19 — Seven-Day Roadmap

> The brief invited a challenge: *"Claude must challenge this sequence if a better order is safer."* This document challenges it, states why, and then commits.

---

## 1. The challenge to the brief's sequence

The brief proposes:

```text
Day 1: Setup, security, SQLite spike, mic spike, STT spike, TTS spike.
Day 2: Database, migrations, repository, typed reminder creation.
Day 3: NL parser, chrono, parser tests.
Day 4: Chat UI, live transcript, confirmation workflow.
Day 5: Scheduler, tray, notifications, TTS, MP3.
Day 6: Polish, onboarding, schedules, history, settings.
Day 7: Packaging, installer, GitHub Release, README, QA.
```

Three problems, in descending severity.

**Problem 1 — the core loop is not provable until Day 5.**
Parser (Day 3) and scheduler (Day 5) are the two halves of the product. Nothing demonstrates *"speak → confirm → get reminded"* until Day 5 evening. If Day 5 slips, there is no product to cut down to. `RISK (high)`.

**Problem 2 — Day 1 loads six spikes, and the riskiest one is unbounded.**
STT is the highest-risk item in the project (`06`), and the brief places it on the same day as project setup. If STT eats Day 1 and half of Day 2 — the single most likely outcome — everything shifts by 1.5 days into a plan with no slack.

**Problem 3 — packaging is on Day 7.**
`VERIFIED FACT` — Windows toasts silently fail unpackaged without an AUMID; the tray icon vanishes after ~10 s only in packaged builds; hidden-renderer TTS throttling differs packaged. Three of the app's core behaviours **cannot be validated in `npm run dev`**. Discovering this on Day 7 is the classic Electron disaster.

## 2. The resequenced plan

Three inversions:

| Change | Effect |
| --- | --- |
| **Typed input before voice.** Build `parse → confirm → persist → tick → notify` on a text box. | The Definition of Done is demonstrable on **Day 3**, not Day 5. Voice becomes an upgrade to a working product, not a dependency. |
| **Package on Day 1.** Produce an installer before writing a feature. | Toast/tray/TTS-in-tray bugs surface on Day 1, when there are six days to fix them. |
| **Scheduler on Day 3, not Day 5.** It only needs the repository, not the UI. | The riskiest correctness code gets built while fresh, and the "it actually reminded me" moment arrives on Day 3. |

STT moves to Day 4–5 as a **timeboxed, cancellable** work item with a pre-decided fallback ladder (`06` §5). If it fails entirely, LifeOS still ships every one of the 23 Definition-of-Done points except the three that mention voice.

```text
Day 1  Foundation + spikes + AN INSTALLER.       ← packaging risk retired first
Day 2  Database, repository, migrations, typed composer.
Day 3  Parser + scheduler + notifications.       ← THE PRODUCT EXISTS TONIGHT
Day 4  Tray, TTS, MP3, trigger modal, overdue.   ← the loop is complete and polished
Day 5  Speech-to-text.                           ← timeboxed. Cuttable.
Day 6  Onboarding, settings, history, polish, error states.
Day 7  Release: package, sign-off QA, README, screenshots, GitHub Release.
```

`MVP DECISION` — **Day 3 evening is the go/no-go gate.** If a typed reminder does not fire a Windows toast by the end of Day 3, stop all feature work and fix that. Nothing else matters.

---

## Day 1 — Foundation, spikes, and an installer

### Daily goal
Retire the five unknowns that could invalidate the plan, and prove the app can be installed.

### Estimated hours
**9 hours** (the longest day; front-load the risk).

### Tasks in order

| # | Task | Timebox |
| --- | --- | --- |
| 1 | Scaffold electron-vite + React + TS. Pin `electron@43.1.0` exactly. | 45 m |
| 2 | Apply secure defaults: `sandbox`, `contextIsolation`, CSP, permission handler, default-deny network filter, navigation locks. | 60 m |
| 3 | **SPIKE-1** — `node:sqlite` flag-free in Electron 43 main. | 60 m |
| 4 | **SPIKE-5** — `electron-builder --win` → NSIS + portable. Install on a clean VM, no UAC. | 45 m |
| 5 | **SPIKE-4** — packaged: main-process toast appears; tray icon survives 15 min. | 30 m |
| 6 | **SPIKE-3** — packaged: hidden window `speechSynthesis` speaks while in tray, after 10 min idle. | 60 m |
| 7 | **SPIKE-0** — hardcoded reminder 60 s out → 30 s tick → toast fires. **No DB, no UI, no parser.** | 60 m |
| 8 | **SPIKE-2** — `npm i sherpa-onnx-node` on a machine with no C++ toolchain; load model; transcribe the fixture WAV. **Engine only, no mic.** | 120 m |
| 9 | Record every spike outcome in `docs/lifeos-planning/25-risk-register.md`. | 30 m |

> SPIKE-2 is last on purpose. Everything above it must be green before the day's riskiest item is allowed to consume what's left.

### Files expected
```text
package.json  electron.vite.config.ts  electron-builder.yml  tsconfig.json  .eslintrc.json  .npmrc
electron/main/index.ts  electron/main/windows.ts  electron/main/session.ts
electron/preload/index.ts
src/app/App.tsx  src/app/main.tsx
public/index.html  public/audio-host.html
tests/fixtures/audio/remind-me-5-min.wav
build/icon.ico  assets/icons/tray.ico
```

### Dependencies
Node 24 ✅ · npm 11 ✅ · git ✅ · a clean Windows VM for install testing (or a spare user account) · a 16 kHz mono PCM16 test WAV (record it with Audacity, 10 minutes).

### Risks
| Risk | Mitigation |
| --- | --- |
| SPIKE-2 overruns | Hard timebox 120 m. Switch to transformers.js. **Do not extend.** |
| SPIKE-3 fails (throttled TTS) | Switch to `SapiTTSService`. +90 m on Day 4, not Day 1. |
| SPIKE-1 fails | `better-sqlite3` + `install-app-deps` + `asarUnpack`. +90 m on Day 2. |
| No clean VM available | Test with a second Windows user account. Weaker, but catches the UAC and AUMID issues. |

### Testing plan
Each spike's acceptance criteria (`06` §9, `07` §8, `10` §12) **is** the test. Spike code is throwaway; the criteria carry forward into the manual checklist. Nothing is committed to `tests/` today.

### Expected visible app behaviour by end of day
An installed LifeOS in the Start Menu. Opening it shows an empty window. Sixty seconds after launch, **a Windows toast appears and Yogi says "hello"** — with no database, no parser and no UI. The skeleton of the product is proven end to end.

### Definition of done
```text
□ npm run dev opens a window with sandbox:true and no CSP warnings in the console.
□ An NSIS installer exists and installs with NO UAC prompt.
□ A toast fires from the packaged app while it sits in the tray.
□ The tray icon is still there after 15 minutes.
□ SPIKE-1 verdict recorded: node:sqlite | better-sqlite3.
□ SPIKE-2 verdict recorded: sherpa-onnx | transformers.js | deferred.
□ SPIKE-3 verdict recorded: speechSynthesis | SAPI.
□ Every verdict, with its evidence, is written into 25-risk-register.md.
```

---

## Day 2 — Database, repository, typed composer

### Daily goal
Durable storage with real constraints, and a text box that can create a reminder by hand.

### Estimated hours
**8 hours.**

### Tasks in order
1. `SqliteDriver` interface + the driver chosen by SPIKE-1. (60 m)
2. `migrate.ts` (`PRAGMA user_version`) + `migrations.ts` (M001/M002 as inline TS constants — no path-resolution risk when packaged). (75 m)
3. `ReminderRepository`: create, get, list, findDue, update, delete, pause, setNextFireAt. **Parameterized, always.** (120 m)
4. `HistoryRepository`, `SettingsRepository`, `logger.ts`. (60 m)
5. Integration tests against a real temp-file SQLite. (75 m)
6. IPC: `reminders:create|list|delete`, with `guard()`, Zod `.strict()`, `Result<T>` envelope. (60 m)
7. Renderer: app shell, left rail, routes, and a **temporary dev form** (title + datetime-local + repeat) → `reminders:create`. (75 m)

### Files expected
```text
core/types/{reminder,settings,ipc}.ts
electron/database/{driver,open,migrate}.ts
electron/database/drivers/*.ts
electron/database/migrations/{001_initial,002_memory}.sql
electron/database/{reminder,history,settings,log}-repository.ts
electron/main/ipc/{index,reminders}.ts
electron/services/logger.ts
src/app/{router,providers}.tsx  src/lib/ipc.ts  src/hooks/useReminders.ts
src/features/schedules/SchedulesScreen.tsx      (minimal list)
tests/integration/{reminder-repository,migrations}.test.ts
```

### Dependencies
SPIKE-1 verdict. `zod`, `luxon` installed.

### Risks
| Risk | Mitigation |
| --- | --- |
| `better-sqlite3` rebuild fails | Prebuilds exist (`10` §1); `install-app-deps` + `asarUnpack`. Fall back to `node-sqlite3-wasm`. |
| Time sunk into the dev form | It is **throwaway**. 75 minutes, ugly, no styling. It exists to prove the IPC path. |

### Testing plan
- `reminder-repository.test.ts`: create/get/list/delete; **SQL-injection title stored as literal text**; empty title rejected by `CHECK`; unknown `action_type` rejected; survives close+reopen; `findDue` excludes paused and caps at 20.
- `migrations.test.ts`: fresh DB reaches `user_version = 2`; re-running is a no-op; a newer `user_version` throws `DatabaseFromNewerVersionError`.

### Expected visible app behaviour by end of day
Type a title, pick a date and time in the dev form, press Save. The reminder appears in a plain list. Close LifeOS, reopen it, **the reminder is still there.** Nothing fires yet.

### Definition of done
```text
□ %APPDATA%\LifeOS\lifeos.db exists, journal_mode=wal, user_version=2.
□ A reminder created in the dev form survives a full app restart.
□ `'); DROP TABLE reminders;--` as a title is stored verbatim; the table survives.
□ An empty title is rejected at BOTH the Zod layer and the SQLite CHECK constraint.
□ reminders:create rejects an unknown key (.strict()).
□ All integration tests green.
```

---

## Day 3 — Parser + scheduler + notifications ◄ **THE GATE**

### Daily goal
The core loop, on typed input. By tonight, LifeOS reminds you of things.

### Estimated hours
**9 hours.**

### Tasks in order
1. **Write `tests/fixtures/commands.json` — 120 fixtures — before any parser code.** The brief's §7 and §10 are already a specification; transcribe them. (60 m)
2. `detect-intent.ts` + `extract-recurrence.ts` (the layer chrono cannot provide). (75 m)
3. chrono wrapper with `{ forwardDate: true }`; `extract-title.ts`. (60 m)
4. `detect-ambiguity.ts` using `isCertain()`. All eight brief cases. (90 m)
5. `score-confidence.ts`, `clarification.ts`. (45 m)
6. `core/scheduling/`: `rrule.ts` (two shapes), `next-occurrence.ts` (Luxon), `rrule-to-human.ts`. (60 m)
7. `scheduler.ts` — injected clock, 30 s `setInterval`, `powerMonitor`, startup catch-up, overdue policy. (90 m)
8. `notifier.ts` — main-process `Notification`, `click` → show + focus. (45 m)
9. Wire the dev form's text box to `parse:reminder` → a crude confirmation card. (45 m)

### Files expected
```text
tests/fixtures/commands.json                        ← write FIRST
core/parsing/{parse-reminder,detect-intent,extract-recurrence,extract-title,detect-ambiguity,score-confidence,clarification}.ts
core/scheduling/{rrule,next-occurrence,rrule-to-human}.ts
core/time/format.ts
electron/scheduler/{scheduler,trigger-sink,overdue}.ts
electron/notifications/notifier.ts
electron/main/ipc/parse.ts
tests/unit/{parse-reminder,detect-ambiguity,next-occurrence,rrule,scheduler}.test.ts
```

### Dependencies
Day 2's repository. `chrono-node@2.9.1`.

### Risks
| Risk | Mitigation |
| --- | --- |
| Title extraction is fiddly | It is the **least dangerous** step to get wrong — the user sees and edits the title. Timebox it; move on. |
| `every Monday` silently becomes one-time | The highest-severity parser bug available. Fixture #3 catches it. Written first, on purpose. |
| DST / 24.8-day bugs are invisible from India | They are **unit tests**, not manual checks. Non-negotiable. |
| Scheduler tempted toward `setTimeout` | `08` §9. The persisted `next_fire_at` is the contract. |

### Testing plan
- 120 parser fixtures green.
- Scheduler with an injected clock: does **not** fire a 30-days-out reminder; collapses 4 missed weekly occurrences into 0 fires + 1 roll-forward; marks a one-time missed-while-closed reminder `missed`, not fired; fires one that is 45 s late; caps a clock-jump storm at 20; `reconcile` is idempotent.
- `next-occurrence`: DST spring-forward (2:30 AM does not exist), fall-back (1:30 AM twice), 7 AM wall-clock preserved.

### Expected visible app behaviour by end of day
Type *"remind me in 2 minutes to drink water"*. A card shows **Drink water · Today, 4:20 PM · in 2 minutes · Does not repeat**. Press Confirm. Two minutes later, **a Windows toast appears**, even with the window minimised. Type *"remind me at 6"* and Yogi asks whether you mean morning or evening.

### Definition of done — **GO / NO-GO**
```text
□ 120/120 parser fixtures pass.
□ All 8 ambiguity cases from the brief §10 ask instead of guessing.
□ "every Monday at 7 AM" produces FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0.
□ A typed reminder fires a real Windows toast at the right time.        ← THE GATE
□ A reminder 30 days out does not fire immediately.
□ Scheduler unit tests green, including both DST cases.

IF THE TOAST DOES NOT FIRE: cancel Day 4's plan. Fix this. Nothing else matters.
```

---

## Day 4 — Tray, TTS, MP3, trigger modal, overdue

### Daily goal
Close the loop: the reminder is heard, not just seen, and the app lives in the tray.

### Estimated hours
**8 hours.**

### Tasks in order
1. Tray: module-scope ref (the GC bug), multi-res `.ico`, full menu, tooltip, paused overlay. (75 m)
2. Close-to-tray + the one-time native dialog + `window-all-closed` guard + single-instance lock. (60 m)
3. Hidden audio window; `WebSpeechTTSService` gated on `voiceschanged` — **or** `SapiTTSService` if SPIKE-3 failed. (90 m)
4. `audio-player.ts` + `yogi-song.mp3` + the `autoplay-policy` switch. (45 m)
5. `TriggerModal`: dismiss / complete / snooze (hidden for recurring); queue `1 of 3`. (75 m)
6. `OverdueCatchupModal` + the missed-while-closed policy. (60 m)
7. Pause / Resume, per-reminder and global. (45 m)
8. `safely()` isolation in `trigger-sink.ts` — prove a TTS throw cannot skip the toast. (30 m)

### Files expected
```text
electron/tray/tray.ts
electron/main/lifecycle.ts
electron/tts/{tts-coordinator,web-speech-service,sapi-tts-service?}.ts
electron/audio/audio-player.ts
electron/preload/audio.ts
resources/audio/yogi-song.mp3      ← MUST BE SOURCED BY NOW (assets/audio/LICENSE.md)
src/features/reminders/{TriggerModal,OverdueCatchupModal}.tsx
src/features/schedules/PausedBanner.tsx
```

### Dependencies
Day 3's scheduler. SPIKE-3's verdict. **A royalty-free MP3, sourced and licensed** (`02` A12).

### Risks
| Risk | Mitigation |
| --- | --- |
| Tray icon vanishes | Module-scope ref. Only reproduces packaged — test packaged. |
| Hidden-window TTS silent in tray | SPIKE-3 already answered this on Day 1. Fallback is ready. |
| A TTS exception skips the notification | The `safely()` wrapper + a unit test that throws from the TTS mock and asserts the toast still fired. |
| No MP3 asset | Blocks the sing demo. Source it Day 3 evening. |

### Testing plan
- Unit: `fire()` still calls `notifier.show()` when `tts.speak()` throws.
- Unit: snooze is refused on a recurring reminder.
- Manual (**packaged**): 10-minute tray test — toast + voice; MP3 plays from the tray; tray icon alive at 15 min; quit → reopen → catch-up modal.

### Expected visible app behaviour by end of day
Close the window; a dialog explains Yogi is still running. Two minutes later a toast appears **and Yogi speaks the reminder aloud**. Say *"please sing after 1 minute"* (typed) and the Yogi song plays. Quit, wait, reopen — a modal reports what was missed while LifeOS was closed.

### Definition of done
```text
□ ✕ hides to tray with a one-time explanation. Quit from the tray fully exits.
□ Toast + spoken reminder both fire while in tray. (SPIKE-3, in production.)
□ action_type='sing' plays the bundled MP3 from the tray.
□ Trigger modal: dismiss / complete work; snooze is hidden for recurring reminders.
□ Killing the TTS service does not prevent the toast.
□ Overdue catch-up modal appears and is honest about what was missed.
□ Tray icon present and sharp after 15 minutes at 150% scaling.
```

---

## Day 5 — Speech-to-text ◄ **timeboxed, cuttable**

### Daily goal
Add voice. If it does not land by the end of the day, **ship without it.**

### Estimated hours
**8 hours, hard stop.**

### Tasks in order
1. `public/worklets/pcm16-downsampler.js` — AudioWorklet, 48k→16k, Float32→Int16. (75 m)
2. **Validate the resampler against the fixture WAV before touching the microphone.** (45 m)
3. `useSpeech.ts`: `getUserMedia`, worklet, `speech:audio` frames every 200 ms. (60 m)
4. `SherpaOnnxSpeechService` in main; lazy model load; dispose after 5 min idle. (90 m)
5. `speech:partial` / `speech:final` broadcast; `LiveTranscript` strip. (75 m)
6. `MicButton` states: idle / initializing / listening / processing / error. Auto-stop on 2 s silence, 30 s cap. (60 m)
7. Degradation: permission denied, no device, model load failure → **typed input keeps working**. (45 m)
8. The three IPC guards on `speech:audio` (origin, ≤ 64 KB, active session). (30 m)

### Files expected
```text
public/worklets/pcm16-downsampler.js
src/hooks/useSpeech.ts
src/features/chat/{MicButton,LiveTranscript}.tsx
electron/speech/{speech-coordinator,sherpa-onnx-service}.ts
electron/speech/stubs/*.ts
electron/main/ipc/speech.ts
```

### Dependencies
SPIKE-2's verdict. The fixture WAV from Day 1.

### Risks
| Risk | Mitigation |
| --- | --- |
| Resampler bug blamed on the model | **Step 2 exists to prevent exactly this.** Test the engine with a known-good WAV first. |
| Day 5 overruns | Hard stop at 8 h. Voice is Tier 1, not Tier 0. The 20 non-voice DoD points already pass. |
| No partials from the engine | The live strip shows an animated "Listening…". `12` §5.2 already forbids the layout depending on partials. |
| STT model adds 250 MB RAM at boot | **Lazy load on first mic press**, dispose after 5 min idle (`13` §11). |

### Testing plan
- Fixture WAV → correct transcript (proves the **engine**).
- Live mic → same transcript (proves the **pipe**).
- First partial < 500 ms; ≥ 2 partial updates in a 3 s utterance.
- 10 start/stop cycles → RAM returns to baseline (no leak).
- Disable the mic in Windows → typed input unaffected, mic shows an error state.
- IPC: a 1 MB frame is dropped without allocating.

### Expected visible app behaviour by end of day
Press the mic. It pulses. Speak *"remind me tomorrow at 9 AM to attend the meeting"* and the words appear as you say them. On stop, the confirmation card shows **Saturday, 11 July, 9:00 AM**.

### Definition of done
```text
□ Mic → live partials → final transcript → confirmation card.
□ Windows asks for mic permission exactly once, on FIRST PRESS (not at onboarding).
□ Model loads lazily; idle tray RAM without STT < 250 MB.
□ Every mic failure degrades to typed input with a clear message.
□ OR: voice is formally cut, recorded in the risk register, and the README says so.
```

---

## Day 6 — Onboarding, settings, history, polish

### Daily goal
Turn a working prototype into something a stranger can install and understand.

### Estimated hours
**8 hours.**

### Tasks in order
1. Design tokens, light + dark, focus rings, `prefers-reduced-motion`. (60 m)
2. Onboarding, 3 panes. **Do not request mic permission here.** (60 m)
3. `ConfirmationCard` + `ClarificationCard` + `EditReminderForm` — the real ones. Absolute dates. (90 m)
4. `SchedulesScreen`: Next up / Upcoming / Repeating, live countdown, inline delete confirm. (75 m)
5. `HistoryScreen` with filters and honest "Missed — LifeOS was closed" rows. (60 m)
6. `SettingsScreen`: privacy, speech, reminders, tray, **Reset (type RESET)**, About. (75 m)
7. Every error state from `17` §2. Every empty state. (60 m)
8. **Cut list, in order:** memory tables UI → provider selectors → AI Assist → key encryption → pause → history → partials. (as needed)

### Files expected
```text
src/styles/{tokens,global}.css
src/components/*.tsx                       (the 14-component inventory)
src/features/onboarding/*.tsx
src/features/chat/{ConfirmationCard,ClarificationCard,EditReminderForm,QuickCommands}.tsx
src/features/schedules/*.tsx
src/features/history/*.tsx
src/features/settings/*.tsx  +  ResetDataModal.tsx
electron/services/reset-service.ts
tests/unit/confirmation-card.test.tsx
```

### Dependencies
Days 3–5. A decision on whether AI Assist ships (Tier 2).

### Risks
| Risk | Mitigation |
| --- | --- |
| Polish expands without limit | The cut list is **pre-decided** (`03` §2). Cut in order, without debate. |
| Reset deletes the wrong thing | Two path guards + a no-argument IPC handler + a symlink test. |
| AI Assist half-finished | Ship the interface and a **disabled** toggle. That satisfies the brief; a broken toggle does not. |

### Testing plan
- 3 renderer tests, all on the confirmation gate: rendering ≠ consenting; `ClarificationCard` has no Confirm button; the absolute date is displayed.
- Reset with a symlinked `userData` → `UnsafeResetPathError`, nothing deleted.
- Keyboard-only pass across all five screens; visible focus everywhere.
- Contrast check on both themes.

### Expected visible app behaviour by end of day
A stranger installs LifeOS, reads three onboarding panes, types a reminder, sees exactly how Yogi understood it, confirms, and gets reminded. Every screen has an empty state. Nothing says "cron".

### Definition of done
```text
□ All five screens implemented, light + dark, keyboard-navigable.
□ Confirmation card shows the ABSOLUTE date, never only "Tomorrow".
□ Clarification card has no Confirm button.
□ Reset Local Data requires typing RESET and deletes only %APPDATA%\LifeOS\.
□ Every error in 17 §2 has its sentence, on screen.
□ AI Assist either works, or ships as a documented disabled toggle.
```

---

## Day 7 — Release

### Daily goal
A stranger downloads a `.exe` from GitHub and it works.

### Estimated hours
**7 hours.**

### Tasks in order
1. Version `0.1.0`. Icons at every size. `productName: LifeOS`. (30 m)
2. `electron-builder --win` → NSIS + portable. `asarUnpack` verified. (45 m)
3. **Fresh Windows VM.** Install. Run the full manual checklist (`18` §10). (120 m)
4. Procmon: no writes outside `%APPDATA%\LifeOS\`. No registry, no Task Scheduler, no service. (30 m)
5. **Wireshark: AI Assist off, 30-minute session with a fired reminder → zero packets.** Record it. (30 m)
6. README, PRIVACY.md, LICENSE, known limitations, supported commands, SmartScreen instructions. (75 m)
7. Screenshots (5) + a 60–90 s demo GIF/video. **Film the renderer-killed-but-toast-still-fires moment.** (60 m)
8. SHA-256 checksums. Tag `v0.1.0`. Publish the GitHub Release. (45 m)
9. Download the published artifact **on a different machine** and install it. (30 m)

### Files expected
```text
README.md  PRIVACY.md  LICENSE  CHANGELOG.md
docs/screenshots/*.png   docs/demo.gif
release/LifeOS-Setup-0.1.0.exe
release/LifeOS-0.1.0-portable.exe
release/SHA256SUMS.txt
.github/workflows/release.yml
```

### Dependencies
A GitHub repository. `GH_TOKEN` with `repo` scope. A clean VM.

### Risks
| Risk | Mitigation |
| --- | --- |
| SmartScreen scares users | Documented with a screenshot and exact steps. Checksums published. Signing is a `FUTURE OPTION` (~$120/yr). |
| Native module missing from the asar | `asarUnpack` verified by installing and running, not by reading the config. |
| Model path breaks when packaged | `resourcePath()` never uses `__dirname`. Asserted in the smoke test. |
| A last-minute fix breaks the build | **Feature freeze at 12:00 on Day 7.** Only release-blocking fixes after that. |

### Testing plan
The full manual checklist against the **installed** artifact, on a machine that has never seen the source. Plus the one Playwright smoke test. Plus the two measurements that test the *product's claims* rather than its code: Procmon and Wireshark.

### Expected visible app behaviour by end of day
Someone with a Windows laptop and no context clicks a link, downloads `LifeOS-Setup-0.1.0.exe`, clicks past SmartScreen as the README instructs, installs without an admin prompt, speaks a reminder, and is reminded.

### Definition of done
```text
□ All 23 points of the brief's §27 pass, from the PUBLISHED artifact, on a FRESH machine.
□ GitHub Release v0.1.0 has: NSIS installer, portable exe, SHA256SUMS.txt, notes.
□ README: privacy behaviour, the "LifeOS must be running" limitation, SmartScreen steps,
  supported commands, screenshots, demo GIF.
□ Wireshark evidence of zero network traffic with AI Assist off.
□ Procmon evidence of zero writes outside %APPDATA%\LifeOS\.
□ The app never asked for administrator access.
```

---

## 3. Slack, and where it hides

There is no dedicated buffer day; a 7-day plan with a buffer day is a 6-day plan. Slack is distributed:

| Source of slack | Hours |
| --- | --- |
| Day 5 (STT) is entirely cuttable | 8 |
| Tier 2 items on Day 6 (AI Assist, key encryption, provider selectors) | 4 |
| History screen (Tier 1) | 2 |
| Live partials (Tier 1) | 2 |
| **Total recoverable** | **16 h ≈ 2 days** |

`MVP DECISION` — Slack is consumed **in that order, from the bottom of the tier list up** (`03` §2). It is never taken from Days 1–4, because those days *are* the product.

## 4. The one-sentence version

> Prove it can be installed on Day 1, prove it can remind you on Day 3, make it hear you on Day 5, and spend the last two days making sure a stranger can trust it.
