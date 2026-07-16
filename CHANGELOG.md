# Changelog

## Unreleased

### Added
- **Repeat scheduling for reminders** — One time, Every day, Every week, Every month, Every year,
  and Custom (every-N days/weeks/months/years, selectable weekdays, and an optional end: never,
  on a date, or after N occurrences). Available from the new **create/edit reminder editor** on the
  Schedules screen (＋ New reminder / per-row Edit). Bounded reminders end automatically after their
  last occurrence. Existing one-time and daily/weekly reminders are unaffected (no data migration).
- Chat still understands daily/weekly recurrence; monthly/yearly/custom are set up in the editor.

### Changed
- Yogi logo recolored from the placeholder indigo to the **LifeOS orange brand** (`#F97316`).

## 0.1.0 — first release (2026-07)

The first public MVP of LifeOS. Yogi can hear or read a reminder, show you exactly how it
was understood, and remind you at the right time — entirely on your device.

### What works
- Speak or type a reminder in natural language (relative, absolute, and daily/weekly recurring)
- Offline speech-to-text with live partial transcripts; offline spoken reminders
- Yogi **asks instead of guessing** when a command is ambiguous
- A confirmation card showing the exact date and time before anything is saved
- Windows notifications + spoken reminders, while minimised to the system tray
- Active Schedules, History (including reminders missed while LifeOS was closed), pause/resume,
  snooze, complete, dismiss, delete
- Onboarding, Settings, light/dark theme, and a guarded "Reset Local Data"
- Everything stored locally in SQLite. No account, no server, no telemetry, no network activity.

### Known limitations
- Reminders only fire while LifeOS is running (closed-to-tray is fine; Quit is not)
- Daily and weekly recurrence only — no monthly
- English only
- Unsigned installer → a one-time Windows SmartScreen warning
- No auto-update yet

### Not in this release (planned)
- "Sing" / bundled audio playback
- Optional AI Assist (OpenAI) for uncertain commands
- Long-term memory
