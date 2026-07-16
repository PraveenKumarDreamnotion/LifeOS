<<<<<<< HEAD
# LifeOS — meet Yogi

> A privacy-first AI reminder companion for Windows. Everything stays on your device.

<!-- ![demo](docs/screenshots/demo.gif) -->
<!-- Add a 60–90s demo GIF here: speak a reminder → confirm → get reminded. -->

LifeOS lets you **speak or type a reminder in plain English**. Yogi understands it, shows you exactly how it was interpreted, waits for you to confirm, and then reminds you — with a Windows notification and a spoken reminder — at the right time. Everything runs **on your computer, offline**.

---

## What it does

- **Speak or type** a reminder: *"remind me in 10 minutes to drink water"*, *"remind me tomorrow at 9 AM to call mom"*, *"remind me every Monday at 7 AM to exercise"*.
- **See exactly how Yogi understood it** — the precise date and time, spelled out — before anything is saved.
- **Yogi asks instead of guessing** when a command is ambiguous (*"remind me at 6"* → "morning or evening?").
- **Reminders fire** as a Windows notification **and** a spoken reminder — even when the window is closed to the system tray.
- **Manage everything** in Active Schedules and History; pause, snooze, complete, or delete.

Speech recognition and voice both run **offline**, on-device.

## Privacy in one paragraph

LifeOS has no server, no account, and no sync. Your reminders live in a SQLite file at `%APPDATA%\LifeOS\`. Speech is transcribed on your computer. **Nothing is uploaded — there is no telemetry and, in this release, no network activity at all.** [Full privacy statement →](PRIVACY.md)

## Install

1. Download **`LifeOS-Setup-0.1.0.exe`** from the [latest release](https://github.com/dreamnotion/lifeos/releases/latest).
2. Windows will show **"Windows protected your PC"**. This is because LifeOS is **not code-signed** — a signing certificate costs money this free project doesn't have. Click **More info → Run anyway**.
   <!-- ![smartscreen](docs/screenshots/smartscreen.png) -->
3. LifeOS installs **for your user only. It never asks for administrator access.**

Prefer no installer? The **portable** build (`LifeOS-0.1.0-portable.exe`) runs directly and keeps its data next to itself.

### Verify your download (optional)

```powershell
Get-FileHash LifeOS-Setup-0.1.0.exe -Algorithm SHA256
```

Compare the result against `SHA256SUMS.txt` in the release.

## ⚠️ Important: reminders need LifeOS running

Closing the window keeps Yogi running in the **system tray** so reminders still fire. **If you Quit from the tray menu, reminders will not fire until you reopen LifeOS.** LifeOS does not add itself to Windows startup — that is deliberate.

## Supported commands

**Relative:** *remind me in 5 minutes to call my mother* · *remind me after 2 hours to drink water*
**Absolute:** *remind me tomorrow at 9 AM to attend the meeting* · *remind me on 25 July at 6 PM to pay the electricity bill* · *remind me next Friday at 10 AM to submit the report*
**Recurring:** *remind me every Monday at 7 AM to exercise* · *remind me every day at 10 PM to sleep*

### When Yogi asks instead of guessing

| You say | Yogi asks |
| --- | --- |
| "remind me at 6" | Six in the morning, or six in the evening? |
| "remind me tomorrow morning" | What time — shall I suggest one? |
| "remind me every Monday" | Every Monday — at what time? |
| "remind me to call Rahul" | When should I remind you? |

## Screens

- **Chat** — speak or type a reminder; see the confirmation card.
- **Active Schedules** — upcoming reminders with plain-language times; pause / delete.
- **History** — what fired, was completed, dismissed, or missed while LifeOS was closed.
- **Settings** — privacy, speak-aloud, theme (system/light/dark), close-to-tray behaviour, and Reset Local Data.

## Known limitations

- Reminders only fire while LifeOS is running (closed-to-tray is fine; Quit is not).
- Daily and weekly recurrence only (no monthly yet).
- English only. Offline speech recognition is good for clear commands; you can always edit the text before confirming.
- Unsigned installer → a one-time Windows SmartScreen warning (see Install).
- No auto-update yet — download the new installer to update.

Full list: [docs/lifeos-planning/23-known-limitations.md](docs/lifeos-planning/23-known-limitations.md)

## Building from source

```bash
npm ci
npm run fetch:model  # downloads the offline STT model (~68MB, not committed to git)
npm run dev          # run in development
npm run test         # unit + integration tests
npm run build:win    # produce the NSIS installer + portable exe in release/
```

Requires Node 24 on Windows. No native compiler is needed — the database is built into Electron (`node:sqlite`) and the speech engine ships as a prebuilt binary.

## How it works

Electron 43 + React 19 + TypeScript. A pure-TypeScript `core/` layer holds the natural-language parser and scheduling math; the Electron main process owns the SQLite database, a wall-clock scheduler, the system tray, notifications, and offline speech-to-text; a sandboxed renderer holds the UI. The full design lives in [`docs/lifeos-planning/`](docs/lifeos-planning/).

## License

MIT — see [LICENSE](LICENSE). Speech model: [k2-fsa / sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache 2.0).
=======
# LifeOS
>>>>>>> cf6e81f762f11b4eae297d4c624c739581fcd72f
