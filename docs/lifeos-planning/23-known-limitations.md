# 23 — Known Limitations

> A limitation that is documented is a scope decision. A limitation that is undocumented is a bug, discovered by a user, at 7 a.m., when they miss their meeting.
>
> This list ships. It appears in the README, in the release notes, and — for the first three items — inside the app itself.

---

## 1. The one that matters most

### ⚠️ Reminders only fire while LifeOS is running

If you **Quit** LifeOS from the tray menu, no reminder will fire until you open it again.

- Closing the window with ✕ is **safe** — Yogi keeps running in the system tray and reminders work normally.
- Quitting from the tray menu stops everything.
- If your computer is shut down or LifeOS is not running when a reminder comes due, it will not notify you at that time.
- When you next open LifeOS, it tells you what you missed. It does **not** fire the missed alarms hours late, because a 9 a.m. reminder announced at 6 p.m. is noise wearing a reminder's clothes.

**Why:** LifeOS deliberately does not create Windows Task Scheduler jobs, install a background service, or add itself to Windows startup. Those are exactly the system-level behaviours the app promises never to perform. An app that guarantees reminders while quit is an app that has installed something you did not ask for.

**Where this appears in the product:** README (above the fold), onboarding pane 3, the first close-to-tray dialog, Settings → Window & Tray, and the startup catch-up modal.

`FUTURE OPTION` — v0.2 will offer an **opt-in** "Launch LifeOS when Windows starts" toggle, implemented with `app.setLoginItemSettings()` (a per-user registry key under `HKCU`, no elevation, removed cleanly on uninstall). It will be off by default and will never be enabled without an explicit click.

---

## 2. Scheduling

| Limitation | Detail | Future |
| --- | --- | --- |
| **Accuracy is ±30 seconds** | The scheduler ticks every 30 seconds and fires whatever is due. It is not a stopwatch. | Configurable in Settings (advanced). |
| **Only daily and weekly recurrence** | `every Monday at 7 AM` ✅ · `every day at 10 PM` ✅ · `every month on the 1st` ❌ · `every other Tuesday` ❌ · `every 3 days` ❌ | v0.2. The data is already stored as an RRULE string, so no migration is needed. |
| Unsupported recurrence is **refused, not degraded** | Asking for "every month" gets an honest "I can't do that yet", never a silent one-time reminder. | — |
| **Recurring reminders keep the timezone they were created in** | Set "every Monday at 7 AM" in Kolkata, fly to New York, and it fires at 7 AM *Kolkata* time. The Schedules screen shows the zone when it differs from yours. | v0.3: a setting to choose. |
| A reminder due during **sleep** fires late, on wake | Windows pauses timers during sleep. On resume, LifeOS reconciles and fires. Late, but present. | Inherent to the platform. |
| Moving your system clock **backwards** stalls reminders | Not defended against. It is your machine. | — |
| Moving it **forwards** fires up to 20 at once | Capped at 20 per tick, with a banner explaining. | — |
| **Snooze is unavailable on recurring reminders** | Snoozing "every Monday" is ambiguous — does it move this week, or the rule? We refuse to guess. | v0.2, with an explicit choice. |
| Maximum horizon is **2 years** | Beyond that, `date_too_far`. | — |

---

## 3. Language and understanding

| Limitation | Detail |
| --- | --- |
| **English only** | Both the parser and the speech model. Other languages produce a polite refusal. |
| **Only reminders** | Yogi is not a chatbot. "What's the weather?" gets an honest "I only set reminders right now," with examples. |
| Ambiguity produces a **question, never a guess** | `remind me at 6` will always ask AM or PM. Some users will find this pedantic. It is deliberate: an auto-assigned meridiem is a twelve-hour error you discover by missing something. |
| Answering a clarification by chip **refines the original text** (Day-3 behaviour) | Picking a time chip re-parses your original words with the time added (so "tomorrow morning" keeps its date). This resolves the date/time/recurrence cases. A clarification that *also* lacks a title (e.g. "remind me tomorrow morning" with no action) then correctly asks for the title, but you must **retype** to supply it — there is no title input on the Day-3 clarification card. The real slot-merging card with inline editing lands in v0.1 Day-6 polish (08 §5, tracked in the risk register). |
| Title extraction is imperfect | Odd phrasing may produce an odd title. You see it on the confirmation card before anything is saved, and you can edit it. |
| `remind me to sing` is read as the **sing action** | The sing intent is checked first. Documented, not fixed. |
| **No memory, no context between commands** | Yogi does not remember that you mentioned your grandfather yesterday. The database has the tables; the feature is not built. |
| No wake word, no background listening | Deliberate. See `22`. |

---

## 4. Speech

| Limitation | Detail |
| --- | --- |
| Recognition quality varies with microphone, accent and noise | It is a small offline model, not a cloud service. It is good at short commands. |
| The transcript is **editable before parsing** | Because the previous line is true. |
| Speech model adds ~250 MB RAM **while in use** | It loads lazily on your first mic press and is released after five minutes of inactivity. If you only ever type, you never pay for it. |
| First mic press has a load delay | A second or two, once per session. |
| Thirty-second maximum utterance | Then it stops and transcribes what it has. |
| If your machine has **no microphone**, or you deny permission | Everything else keeps working. Typed input is a first-class path, not a fallback. |

---

## 5. Voice output

| Limitation | Detail |
| --- | --- |
| Uses the **voices installed on your Windows** | It sounds like Windows, because it is Windows. There is no neural voice, because a neural voice means either a cloud service (not private) or a 50 MB download (not free). |
| If your machine has **no voices installed**, reminders are silent | The notification still appears. LifeOS tells you once and points you at Windows speech settings. |
| Voice output while minimised depends on Windows | This was tested extensively (it is the app's trickiest behaviour). If it ever fails on your machine, the notification still fires. |
| The Yogi song is **one bundled clip** | It is a demo, not a music feature. |

---

## 6. Installation and distribution

| Limitation | Detail |
| --- | --- |
| **Windows will warn you when you install** | LifeOS is unsigned. A code-signing certificate costs money this free project does not have. You will see *"Windows protected your PC"*. Click **More info → Run anyway**. The README has a screenshot. |
| We publish **SHA-256 checksums** | So you can verify the download yourself rather than trusting Microsoft's opinion of an unknown publisher. |
| **Never disable SmartScreen** | We will never ask you to. |
| **No auto-update** | To update, download the new installer. `latest.yml` is already generated, so this arrives in v0.2. |
| Windows 10 (1809+) and Windows 11, **x64 only** | Electron 43's floor. No 32-bit, no ARM64. |
| The installer is ~150 MB | Electron ships a browser; the speech model is 40 MB of it. |
| Idle RAM ~200 MB in the tray | Electron. |
| **No macOS, Linux, mobile or web** | The architecture keeps the door open (`core/` is pure TypeScript with no Electron imports), but no port is attempted. |
| Running from a **network share is unsupported** | SQLite over SMB is a known hazard. Untested; do not. |
| The **portable exe** keeps its data next to itself | So it travels on a USB stick. Its notifications need an explicitly-set AppUserModelID because it has no Start Menu shortcut; this is handled, but it is the less-tested artifact. |

---

## 7. Data and privacy

| Limitation | Detail |
| --- | --- |
| **Uninstalling does not delete your data** | `%APPDATA%\LifeOS\` remains, so reinstalling keeps your reminders. Delete the folder by hand, or use Settings → Reset first. |
| **No export or import** | Your data is one SQLite file in a documented location, in the world's most portable format. Copy it. Open it with any SQLite browser. v0.2 adds JSON export. |
| **No backup** | LifeOS keeps two `.bak` copies across schema migrations, and nothing else. Back up `lifeos.db` yourself if it matters. |
| **No sync, no multi-device** | There is no server. That is the point. |
| DPAPI protects your API key from a **copied folder**, not from software running as you | Stated plainly in `PRIVACY.md`. Nothing on a desktop can do better. |
| Reminder titles are in your **local logs** | Read them before attaching one to a GitHub issue. The app says so. |
| The `memories` and `conversations` tables exist but are **empty** | Created now so a future migration is not a surprise. LifeOS 0.1.0 writes nothing to them. |

---

## 8. AI Assist

| Limitation | Detail |
| --- | --- |
| **Off by default**, and requires your own OpenAI key | You are billed by OpenAI, directly. Typically well under ₹1 a month. |
| Only fires when local understanding is **uncertain** | Roughly 8% of commands, in our fixture corpus. |
| Sends **only the text** of that one command, plus the date and your timezone | Never audio. Never your reminders. |
| **The AI can never create a reminder** | It returns a proposal. You still press Confirm. This is not a policy; there is no code path from the model's output to the database. |
| Requires an internet connection | If offline, LifeOS falls back to asking you a clarifying question. |
| Any AI failure degrades to a local clarification | It can never make the app worse than not having it. |

---

## 9. Accessibility

| Limitation | Detail |
| --- | --- |
| Screen-reader support is **untested** | Semantic HTML, ARIA roles and live regions are implemented; no NVDA or JAWS pass was performed. |
| High-contrast mode untested | Both themes meet 4.5:1 contrast. Windows High Contrast is a different mechanism. |
| No custom keyboard shortcuts | Full Tab navigation and visible focus, but no rebinding. |
| `prefers-reduced-motion` is respected | The mic pulse becomes a static dot. |

`RISK (medium)` — Untested is not the same as unsupported, and this is the section most likely to contain a real, fixable problem that nobody noticed. `FUTURE OPTION` — an NVDA pass before v1.0.

---

## 10. What this list is for

Every row above is a decision, taken deliberately, with a reason recorded elsewhere in these documents. None of them is a surprise to the developer.

The purpose of writing them down is that none of them should be a surprise to the user either.

If you find a limitation that is **not** on this list, that is a bug — not because the behaviour is necessarily wrong, but because the documentation is. Please open an issue.
