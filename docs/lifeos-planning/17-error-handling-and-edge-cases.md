# 17 — Error Handling and Edge Cases

> **The rule:** every failure has a message, a next action, and a place it was logged. A dialog that says "An error occurred" is a bug.
>
> **The second rule:** the notification path never depends on anything optional. Speech, audio, the LLM, the renderer, and the network may all fail. The reminder still fires.

---

## 1. Error taxonomy

| Class | Example | User sees | App does |
| --- | --- | --- | --- |
| **Expected** | Past date, empty title | A sentence explaining what to fix | Blocks the action, keeps the input |
| **Degraded** | No TTS voices, no mic | A one-time notice, then silence | Continues with reduced capability |
| **Recoverable** | DB write failed, LLM 500 | Message + Retry | Retries or falls back |
| **Fatal** | DB from a newer version | Explanation + Reset option | Refuses to start; **does not guess** |
| **Security** | Bad IPC origin, unsafe reset path | Nothing (it isn't the user) | Throws, logs, refuses |

`MVP DECISION` — A **Degraded** failure must never become **Fatal** by accident. That is the single most common Electron reminders-app bug: TTS throws, the trigger handler unwinds, and the notification never fires. Every optional call site is individually wrapped.

```ts
// electron/scheduler/trigger-sink.ts
export function fire(r: Reminder): void {
  // UNCONDITIONAL — must not be inside any try that could skip it
  notifier.show(r);
  historyRepo.record(r.id, Date.now(), 'triggered');

  // OPTIONAL — each isolated. A throw here cannot reach the two lines above.
  safely('tts',   () => ttsCoordinator.speak(r.title));
  safely('audio', () => r.actionType === 'sing' && audioPlayer.play('yogi-song'));
  safely('ui',    () => mainWindow?.webContents.send(CH.REMINDER_TRIGGER, r));
}

function safely(module: string, fn: () => unknown): void {
  try { Promise.resolve(fn()).catch(e => log.warn(module, String(e))); }
  catch (e) { log.warn(module, String(e)); }
}
```

Note the ordering and the `safely` wrapper together *are* the reliability argument. Read them as a claim: **nothing below line 4 can prevent lines 3 and 4 from happening.**

## 2. Every `ValidationCode` has a sentence

A code without a user-facing sentence is an incomplete error. This table is the source of truth; `toIpcError` reads from it.

| Code | Sentence | Where it surfaces |
| --- | --- | --- |
| `empty_title` | "What should I remind you about?" | Confirmation card, edit form |
| `date_in_past` | "That time has already passed." | Card, edit form (live, on the field) |
| `date_too_far` | "I can't schedule more than two years ahead." | Edit form |
| `invalid_date` | "I couldn't make sense of that date." | Chat |
| `unsupported_recurrence` | "I can only repeat daily or weekly right now." | Chat, as a refusal card |
| `unsupported_intent` | "I only set reminders right now." | Chat, with example chips |
| `unsafe_content` | "That reminder contains something I can't store." | Chat (AI Assist path only) |
| `sing_not_recurring` | "The Yogi song is a one-time thing." | Edit form |
| `clarification_without_question` | *(internal — never shown)* | Log only; degrades to local clarification |
| `invalid_input` | "That input was not valid." | Generic Zod failure |
| `internal_error` | "Something went wrong." + `[Open logs]` | Toast |
| `encryption_unavailable` | "Windows won't let LifeOS store your key securely. I can keep it for this session only." | Settings |
| `db_write_failed` | "Couldn't save that reminder." + `[Retry]` | Toast + card stays open |
| `db_newer_version` | "This data was created by a newer version of LifeOS." | Startup dialog |

## 3. Edge cases: the parser

| Input | Behaviour | Why not the obvious thing |
| --- | --- | --- |
| `remind me at 6` | Ask "morning or evening?" | Auto-assigning is a 12-hour error the user won't notice until they miss a flight. |
| `remind me at 18` | 6:00 PM, no question | `meridiem` is certain in 24-hour input. |
| `remind me at 25` | `invalid_date` | Not an hour. |
| `remind me tomorrow` (no time) | Ask, offering 9 AM / 12 PM / 6 PM | chrono implied noon. `isCertain('hour')` is false. |
| `remind me every Monday` | Ask for a time | Recurrence without a time is a half-thought. |
| `remind me every month on the 1st` | Refuse honestly | Silently degrading to one-time is worse than saying no. |
| `remind me in 0 minutes` | Fire on the next tick (≤ 30 s) | Not an error. The user meant "now". |
| `remind me in -5 minutes` | `date_in_past` | |
| `remind me in 5 million minutes` | `date_too_far` | Also the 24.8-day `setTimeout` trap, defused by the tick architecture. |
| `remind me` | "I can set that. When, and about what?" | Two missing slots, one question. |
| Empty string / whitespace | Submit button disabled | Not an error path at all. |
| 5,000-character transcript | Truncate to 1,000 with a notice | `z.string().max(1000)` at the IPC boundary. |
| `remind me to sing` | `create_sing_reminder`, ask when | Ambiguous by design; sing wins. Documented. |
| `Remind me on 31 February` | `invalid_date` | Luxon rejects it; chrono may not. |
| `remind me next Friday` **on a Friday** | The *coming* Friday, 7 days out | `forwardDate: true`. Without it: **last** Friday. |
| Non-English text | `unknown_intent`, friendly refusal | English-only is a documented limitation. |
| `remind me in 5 minutes to $(rm -rf /)` | Title stored as literal text | Nothing executes strings. It renders as a title. |

`MVP DECISION` — Every row in this table is a test case in `tests/fixtures/commands.json`.

## 4. Edge cases: the scheduler

| Situation | Behaviour |
| --- | --- |
| Reminder due 30 days out | Never touched by a `setTimeout`. The tick queries `next_fire_at <= now`. The 32-bit trap cannot fire. |
| Laptop sleeps through a reminder | On `powerMonitor.resume`, `reconcile('resume')` fires it late. Late beats never. |
| App closed through a one-time reminder | On startup, marked **`missed`**, shown in the catch-up modal, **not fired**. A 9 AM alert at 6 PM is noise wearing a reminder's clothes. |
| App closed through 4 weekly occurrences | Rolled forward to the next future occurrence. Fires **zero** times. Four "Exercise" alarms at once is hostile. |
| App closed for 3 minutes over a one-time reminder | `lateBy < 2 × TICK` → **fires**. The user expected the app to be watching; it nearly was. |
| System clock jumps forward 1 year | `LIMIT 20` on `findDue` + a banner: *"Your system clock changed — 47 reminders became due at once."* |
| System clock jumps backward | Reminders silently wait. Not defended; it's the user's machine. |
| DST spring-forward: weekly reminder at 2:30 AM, a time that does not exist | Luxon resolves forward to 3:30 AM. Pinned by a unit test, not left to chance. |
| DST fall-back: 1:30 AM occurs twice | Luxon picks the first. Pinned by a test. |
| Recurring reminder with an unparseable rule | `status = 'error'`. Shown as *"This reminder needs attention."* **Never silently dropped.** |
| Two reminders due in the same tick | Both fire. Modal queues, showing `1 of 2`. |
| 20 reminders due in the same tick | 20 fire, capped. A 21st waits for the next tick. |
| `reconcile()` throws mid-loop | One tick lost. The next tick (30 s) recovers. `reconcile` is idempotent by construction. |
| Reminder deleted while its modal is open | Modal shows *"This reminder was removed."* and closes. |
| Reminder is paused, then becomes due | `findDue` filters `is_paused = 0`. It waits. On resume, if overdue, standard overdue policy applies. |
| All reminders paused via tray | `reconcile` returns immediately. Amber banner on every screen. |

`MVP DECISION` — India has no DST, so the DST cases will never bite the primary user in testing. **That is exactly why they need unit tests rather than manual checks.** A bug you cannot reproduce locally is a bug you ship.

## 5. Edge cases: speech

| Situation | Behaviour |
| --- | --- |
| Microphone permission denied | Inline banner: *"LifeOS can't hear you."* + `[Open Windows sound settings]`. **Typed input keeps working.** |
| No microphone device | Mic button in `error` state, tooltip explains. Typed input works. |
| Mic unplugged mid-utterance | `speech:error` → stop session, keep the partial transcript in the input box so nothing is lost. |
| STT model fails to load | Mic disabled, banner with `[Retry]`. App fully usable by typing. |
| Model load takes 8 seconds | Mic shows `initializing` with a spinner. Loads lazily on **first press**, not at boot (`13` §11). |
| User speaks for 40 seconds | Hard cap at 30 s, auto-stop, transcribe what we have. |
| User presses mic, says nothing | Auto-stop after 2 s of silence. No card. No error. |
| Transcript is `""` | Nothing happens. Not an error; the user changed their mind. |
| Engine returns no partials | Live strip shows an animated "Listening…". **Layout must not depend on partials existing.** |
| Two mic sessions started at once | `speech:start` returns the existing `sessionId`. Idempotent. |
| Audio frames arrive with no active session | Dropped in the IPC guard, no allocation. |
| 1 MB audio frame arrives | Dropped (`> 64 KB`). A 200 ms PCM16 frame is 6.4 KB. |
| Model loaded, then 5 minutes idle | Disposed. RAM returns to baseline. Next press reloads it. |

`MVP DECISION` — **Every speech failure degrades to typed input, and typed input is always present.** This is why the composer text box is never hidden, never disabled, and is built on Day 2 rather than Day 4.

## 6. Edge cases: TTS and audio

| Situation | Behaviour |
| --- | --- |
| No voices installed | `tts_degraded = true`, one toast, `Speak reminders aloud` toggle disabled with an explanation and a link to Windows speech settings. **Notifications still fire.** |
| `getVoices()` returns `[]` on first call | Wait for `voiceschanged`. This is the documented, mandatory pattern (`07` §2). |
| Hidden audio window is throttled, speech never plays | The **known risk** SPIKE-3 exists to catch. Fallback: `SapiTTSService` in main. |
| Audio window crashes | `render-process-gone` → recreate. The notification for the in-flight reminder already fired. |
| MP3 file missing from `resources/` | Log an error, fire the notification, skip the song. An integration test asserts the file exists in the packaged app. |
| `audio.play()` rejects (autoplay policy) | Should be impossible — the switch is set before any window exists. If it happens, log and continue. |
| Reminder fires while Yogi is already speaking | `speechSynthesis.cancel()` then speak the new one. The newer reminder is the more urgent. |
| User's speech rate set to 0.1× | Clamped to `[0.5, 2.0]` at the setting boundary. |

## 7. Edge cases: database

| Situation | Behaviour |
| --- | --- |
| `%APPDATA%\LifeOS\` not writable | Fatal dialog with the exact path and a suggestion to check permissions. Do not fall back to a temp dir; a reminders app that silently forgets is worse than one that won't start. |
| Disk full on write | `db_write_failed`, `[Retry]`, card stays open with the user's input intact. |
| DB file corrupted | `PRAGMA integrity_check` on open. On failure: offer `[Restore backup]` (from `lifeos.db.bak-vN`) or `[Reset local data]`. |
| DB `user_version` > known migrations | Refuse to open. *"This data was created by a newer version."* **Never run a migration backwards.** |
| Migration throws halfway | It ran inside a transaction. Rolls back. `user_version` unchanged. Backup untouched. |
| Two LifeOS instances launched | `requestSingleInstanceLock()` → the second focuses the first and exits. Two schedulers on one WAL would double-fire. |
| WAL locked on reset (`EBUSY`) | Close driver, retry once after 200 ms, then tell the user to quit and reopen. Never leave a half-deleted directory. |
| 50,000 `app_logs` rows | Retention sweep on startup deletes rows older than 14 days, then `incremental_vacuum`. |
| Portable exe on a read-only USB stick | Detected at open; fatal dialog. |

## 8. Edge cases: AI Assist

| Situation | Behaviour |
| --- | --- |
| Enabled, offline | Skip the call. Local clarification. Toast: *"AI Assist needs a connection."* |
| Invalid API key (401) | Local clarification. Settings banner. **Disable further calls this session** — don't burn a rate limit on a dead key. |
| Rate limited (429) | One retry after 2 s, then local clarification. |
| Response takes 9 seconds | Aborted at 8 s. Local clarification. A user waiting 8 s for a reminder has already lost. |
| Response is not JSON | Zod throws → local clarification. Log the *reason code*, never the raw output. |
| Response has an extra key | `.strict()` rejects. This is the point of `.strict()`. |
| Response has `intent: "delete_all_reminders"` | Rejected: intent is a closed enum. |
| Response title contains `Invoke-Expression` | Rejected by the unsafe-content scanner. |
| Response date is in the past | Rejected by semantic validation. |
| Response is perfect | Rendered on a **confirmation card**. The user still presses Confirm. |
| `needsClarification: true` and high confidence | Renders a **Clarification** card, which has no Confirm button. The model cannot talk its way past the gate. |
| Consent absent, renderer calls anyway | `ConsentRequiredError` thrown **in main**. `fetch` is never reached. |

`MVP DECISION` — **Every AI Assist failure degrades to the local clarification question.** The feature can never make the app worse than not having it. That property is what makes it safe to ship as Tier 2.

## 9. Edge cases: window, tray, lifecycle

| Situation | Behaviour |
| --- | --- |
| User clicks ✕ the first time | Native dialog explaining tray behaviour, with `[ ] Don't show again`. Then hides. |
| User clicks ✕ with `closeAction = 'quit'` | Quits. Their choice, made in Settings. |
| Last window hidden | `window-all-closed` does **not** quit on Windows. Guarded explicitly, or the tray app dies the moment you close it. |
| Tray icon vanishes after ~10 s | The GC bug. `let tray: Tray \| null = null` at **module scope**. Manifests only in packaged builds — which is why SPIKE-4 is packaged. |
| Tray icon blurry at 125% scaling | Multi-resolution `.ico` (16 @72dpi, 32 @144dpi). Windows 11 wants 20×20 and upscales a lone 16 badly. |
| Second tray icon hidden in overflow | Windows behaviour. Documented, not fixable. |
| Notification click | `Notification.on('click')` → `win.show()` + `win.focus()`. **Not automatic.** |
| Toasts don't appear in dev | `app.setAppUserModelId(process.execPath)` when unpackaged. Packaged NSIS sets it automatically. |
| Toasts don't appear in the portable exe | No Start Menu shortcut → no AUMID. Set it explicitly; test the portable artifact separately. |
| Quit while a reminder is 10 s away | It does not fire. Documented, loudly, in three places. |
| Machine hibernates for 3 days | On resume, `reconcile('resume')` handles everything. Recurring rolls forward; one-time within 2 ticks fires. |

## 10. The Reset flow

The most destructive operation in the app, so it gets the most guards.

| Situation | Behaviour |
| --- | --- |
| User types `reset` (lowercase) | Button stays disabled. Exact match only. |
| `userData` is a symlink to `C:\` | `UnsafeResetPathError`. Two guards: path must end in `LifeOS`, must be ≥ 4 segments deep. |
| Renderer sends a path | Impossible. `resetLocalData()` **takes no arguments** (`16` §1). |
| Reset while a reminder is firing | Scheduler stopped first, then DB closed, then `fs.rm`. |
| `fs.rm` fails with `EBUSY` | Retry once after 200 ms; then tell the user to quit and reopen. Never a half-deleted state. |
| Reset succeeds | `app.relaunch()` + `app.exit(0)`. Reopens into onboarding. |
| User expects uninstall to delete data | It does not. `%APPDATA%` is the user's, not the installer's. Stated in the README. |

## 11. Renderer error boundaries

```tsx
// One boundary per route, not one for the whole app.
<ErrorBoundary fallback={<ScreenCrashed screen="Active Schedules" />}>
  <SchedulesScreen />
</ErrorBoundary>
```

`MVP DECISION` — A crash in the History screen must not take down the Chat screen. The `ScreenCrashed` fallback offers `[Reload this screen]` and `[Open logs]`, and reports to `app_logs` via IPC.

`MVP DECISION` — A renderer crash **never affects reminders**, because the scheduler is in main. The most it costs is the in-app modal; the toast and the spoken reminder still happen. This is the strongest practical argument for the main-process scheduler, and it should be demonstrated in the demo video by killing the renderer with DevTools and watching a reminder fire anyway.

## 12. What we deliberately do not handle

| Not handled | Why |
| --- | --- |
| Malware running as the user | It can read `%APPDATA%`, key-log, and inject into our process. No desktop app defends against this. Claiming otherwise is dishonest. |
| User manually editing `lifeos.db` | Their file. `integrity_check` catches corruption; `CHECK` constraints catch bad values. |
| System clock moved backwards | Self-inflicted. The forward case gets a storm guard because it produces *visible harm*. |
| Running from a network share | Untested. SQLite over SMB is a known hazard. Documented as unsupported. |
| Multiple Windows users sharing one install | Each gets their own `%APPDATA%`. Works by construction. |
| 32-bit Windows | x64 only. sherpa-onnx prebuilds and the model assume it. |
| Windows 7/8 | Electron 43 requires Windows 10 1809+. |

`MVP DECISION` — Every row here appears verbatim in `23-known-limitations.md`. An unhandled case that is *documented* is a scope decision. An unhandled case that is *undocumented* is a bug waiting to be discovered by a user.
