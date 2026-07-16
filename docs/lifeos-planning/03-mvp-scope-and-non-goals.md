# 03 — MVP Scope and Non-Goals

> **Purpose:** Draw a hard line around the 7-day build. Anything on the wrong side of this line is a roadmap item, not a task.

---

## 1. The scope test

Before adding any task to the plan, ask:

> *Does this make the sentence "speak a reminder → confirm it → get reminded at the right time, offline" more reliable?*

If **no**, it is out of scope. If **yes but only marginally**, it is P2 and gets cut on Day 6 if behind schedule.

## 2. Scope tiers

Work is tiered so that cuts happen in a pre-decided order rather than in a panic on Day 6.

### Tier 0 — The demo cannot exist without these

These must all work. If any is at risk on Day 5, stop feature work and fix it.

1. Electron app with secure defaults that opens a window on Windows.
2. SQLite database in `%APPDATA%/LifeOS/`, migrated, with a `reminders` table.
3. **Typed** command → parsed → confirmation card → persisted reminder.
4. Main-process scheduler with a periodic tick that fires due reminders.
5. Windows notification + spoken reminder on trigger.
6. `sing` action plays the bundled MP3.
7. Close-to-tray; trigger fires while hidden in tray.
8. Active Schedules list with delete.
9. Reminders survive app restart.
10. Packaged NSIS installer + portable exe, published to GitHub Releases.
11. README with privacy statement and the "app must be running" limitation.

### Tier 1 — What makes it feel like the product in the brief

12. Microphone button → speech-to-text → transcript fills the input box.
13. Live interim transcript rendering.
14. Ambiguity clarification questions (the 8 cases in `01` §7).
15. Edit flow on the confirmation card.
16. Onboarding screen with privacy explanation.
17. Reminder trigger modal with Dismiss / Complete / Snooze.
18. Reminder History screen.
19. Settings screen with Reset Local Data.
20. Overdue-reminder catch-up on app start.
21. Pause / Resume reminders from tray.

### Tier 2 — Cut first, without regret

22. Optional OpenAI AI Assist fallback (ship the *interface* and the settings toggle disabled, even if the call path is stubbed).
23. Encrypted API key storage via `safeStorage`.
24. Provider selector UI for STT/TTS.
25. Demo video / GIF (a screenshot set is acceptable if time is gone).
26. `memories` / `conversations` tables (create in migration; no UI).

> **Cut order on Day 6 if behind:** 26 → 24 → 22 → 23 → 21 → 18 → 13.
> Never cut anything in Tier 0.

## 3. In-scope, precisely

| Capability | In MVP | Notes |
| --- | --- | --- |
| Typed natural-language reminders | ✅ | Primary, built first |
| Spoken natural-language reminders | ✅ | Layered on top of typed path |
| Live interim transcript | ✅ (Tier 1) | Degrades to final-only if engine lacks partials |
| Relative times ("in 5 minutes") | ✅ | |
| Absolute times ("tomorrow at 9 AM") | ✅ | |
| Weekly recurrence ("every Monday at 7 AM") | ✅ | Only `FREQ=WEEKLY` |
| Daily recurrence | ⚠️ Free bonus | `FREQ=DAILY` falls out of the same code path; add only if trivial |
| Monthly/yearly recurrence | ❌ | Roadmap |
| Ambiguity clarification | ✅ | 8 defined cases |
| Confirmation gate | ✅ | Mandatory, no bypass |
| Local SQLite persistence | ✅ | |
| Main-process scheduler | ✅ | |
| Windows toast notification | ✅ | |
| Offline TTS | ✅ | |
| Bundled MP3 playback | ✅ | One file, `yogi-song.mp3` |
| System tray | ✅ | |
| Pause/Resume | ✅ (Tier 1) | |
| Edit reminder | ✅ (Tier 1) | |
| Delete reminder | ✅ (Tier 0) | |
| Snooze | ✅ (Tier 1) | Non-recurring only |
| History screen | ✅ (Tier 1) | |
| Onboarding | ✅ (Tier 1) | |
| Reset local data | ✅ (Tier 0) | |
| Optional OpenAI fallback | ⚠️ Tier 2 | Off by default; interface must exist |
| NSIS installer + portable exe | ✅ | |
| Code signing | ❌ | Cost. Documented limitation. |
| Auto-update | ❌ | Roadmap |

## 4. Non-goals (explicit)

### 4.1 Not building — capability

| Non-goal | Why not in MVP | Roadmap? |
| --- | --- | --- |
| Wake word / "Hello Yogi" | Requires always-on audio + KWS model + battery/privacy design. Multi-day. | Yes, v0.3 |
| Continuous background listening | Same as above, plus a serious privacy posture and a recording indicator. | Yes, gated |
| Full chatbot conversation | Needs an LLM by default; breaks ₹0 and offline-first. | Yes, v0.4 (local Ollama) |
| Semantic memory recall | Needs embeddings + vector index. Schema is prepared; feature is not. | Yes, v0.3 |
| Gmail / WhatsApp / Calendar / Drive | OAuth, review processes, cloud data. Weeks of work each. | Maybe, v1.0 |
| Cloud sync / multi-device | Contradicts local-first MVP; needs a backend (₹0 violated). | Maybe, v1.0 opt-in E2EE |
| User accounts / login / subscription | No server. Not needed. | Maybe |
| Web research / browsing | Needs network, search API, and safety review. | Yes, v0.5 opt-in |
| PDF / document summarization | Needs an LLM. | Yes, v0.5 |
| Weather / restaurants / routes | Third-party APIs, keys, quotas. | Yes, v0.5 |
| Medical, legal, financial advice | Liability and safety. Never as advice; only as sourced information with disclaimers. | Constrained |
| Autonomous agents | Contradicts the confirmation gate. | No |

### 4.2 Not building — system behavior (permanently forbidden, not "roadmap")

These are not deferred. They are architectural prohibitions.

- Requiring administrator privileges.
- Modifying Windows system files or the registry.
- Installing drivers or services.
- Running shell/PowerShell commands constructed from user input.
- Executing any command, script, or code returned by an LLM.
- Creating Windows Task Scheduler jobs.
- Deleting or modifying files outside `%APPDATA%/LifeOS/`.
- Adding itself to Windows startup without an explicit opt-in toggle.
- Unrestricted desktop automation / input synthesis.
- Silent software installation or self-update without consent.
- Uploading user data anywhere by default.

> The only shell-adjacent operation permitted anywhere in the codebase is a **hardcoded, constant-argument** invocation (no interpolation of any dynamic value) and only if no in-process API exists. See `11-electron-security-architecture.md` §7. The chosen TTS approach avoids even this.

### 4.3 Not building — platform

Android, iOS, macOS, Linux, web, browser extension. The architecture keeps platform-specific code behind service interfaces (`TTSService`, `SpeechService`, `NotificationService`) so ports remain possible, but no port is attempted.

## 5. Deliberate simplifications (and their debt)

| Simplification | Debt incurred | Repayment trigger |
| --- | --- | --- |
| Only `FREQ=WEEKLY` and `FREQ=DAILY` recurrence | Users will ask for monthly | v0.2 |
| Scheduler ticks every 30 s → up to 30 s late | Not suitable for second-precision | Never needed |
| Reminders don't fire when app is quit | Core UX limitation, must be documented loudly | v0.2 opt-in autostart |
| One bundled MP3 | "sing" is a demo, not a music feature | v0.3 |
| English only | i18n absent | v0.4 |
| No code signing | SmartScreen warning on install | When funded |
| No auto-update | Users must re-download | v0.2 (`electron-updater` + GitHub) |
| Settings stored in SQLite `settings` table, key/value strings | No typed config schema | Fine |
| No telemetry at all | Zero visibility into crashes | Deliberate. Keep it. |

## 6. What "polished" means for this MVP

Polish is not extra features. For this build, polish means:

1. **No dead ends.** Every error state has a message and a next action.
2. **No lies.** The confirmation card shows the *actual* stored time, formatted absolutely.
3. **No silent failures.** If TTS fails, the notification still fires. If the mic fails, typed input still works.
4. **No surprises.** Close-to-tray is explained once, on first close.
5. **Consistent visuals.** One spacing scale, one type scale, one accent colour, light + dark.
6. **Empty states.** "No active schedules yet — try: *remind me in 10 minutes to drink water*."
7. **It survives abuse.** Empty title, past date, 500-character title, system clock change, rapid double-confirm.

## 7. Definition of "out of scope" enforcement

Any GitHub issue, TODO, or Claude Code prompt that proposes work not in Tier 0/1/2 above must be closed with a link to `24-future-roadmap.md`. During the 7 days, **the plan does not change**; only cuts are allowed, in the pre-decided order in §2.
