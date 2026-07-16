# 12 — UI/UX Specification

> **Audience:** Implementer + Claude Code. This is prescriptive enough to build from without a Figma file.
>
> **v2 addition:** the fired-reminder surface is now the **conversational always-on-top popup**
> (bottom-right toast, speaks the reminder, act + keep talking) — full UI spec in
> [55-reminder-popup-workflow.md](55-reminder-popup-workflow.md) §4. It supersedes the in-app
> TriggerModal described below as the primary trigger UI.

---

## 1. Design principles

1. **Show the machine's understanding, always.** The confirmation card is the heart of the product. It is not a modal to dismiss; it is the proof that Yogi understood.
2. **Absolute over relative.** Never display only "tomorrow". Display "Tomorrow — Saturday, 11 July, 9:00 AM".
3. **Confirmation is a gate, not a formality.** The Confirm button is the only path to persistence.
4. **Calm, not chatty.** Yogi speaks in short declarative sentences. No emoji in Yogi's voice output.
5. **Privacy is visible, not buried.** A persistent "Local · Offline" chip in the header.
6. **Degrade, never dead-end.** Mic broken → typed input. TTS broken → notification still fires.

## 2. Visual system

### 2.1 Tokens

```css
:root {
  /* Spacing — 4px base */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;

  /* Radius */
  --r-sm: 6px; --r-md: 10px; --r-lg: 16px; --r-full: 999px;

  /* Type scale */
  --fs-xs: 12px; --fs-sm: 13px; --fs-md: 15px;
  --fs-lg: 18px; --fs-xl: 24px; --fs-2xl: 32px;
  --lh-tight: 1.25; --lh-normal: 1.5;

  /* Font */
  --font-ui: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  --font-mono: "Cascadia Code", ui-monospace, monospace;

  /* Motion */
  --dur-fast: 120ms; --dur-med: 200ms; --ease: cubic-bezier(.2,.8,.2,1);
}

/* Light */
:root {
  --bg:        #FBFBFD;
  --surface:   #FFFFFF;
  --surface-2: #F3F4F6;
  --border:    #E4E4E7;
  --text:      #18181B;
  --text-dim:  #52525B;
  --text-mute: #8A8A93;
  --accent:    #5B5BD6;   /* Yogi indigo */
  --accent-fg: #FFFFFF;
  --success:   #157F3D;
  --warn:      #9A5B00;
  --danger:    #B42318;
  --listening: #C2255C;   /* mic active */
}

/* Dark */
:root[data-theme="dark"] {
  --bg:        #0E0E11;
  --surface:   #17171B;
  --surface-2: #1F1F25;
  --border:    #2A2A31;
  --text:      #F4F4F5;
  --text-dim:  #A1A1AA;
  --text-mute: #71717A;
  --accent:    #8E8EF6;
  --accent-fg: #0E0E11;
  --success:   #4ADE80;
  --warn:      #FBBF24;
  --danger:    #F87171;
  --listening: #F472B6;
}
```

Theme follows `nativeTheme.shouldUseDarkColors` by default, overridable in Settings (System / Light / Dark).

### 2.2 Accessibility

- All text ≥ 4.5:1 contrast against its background (the tokens above are chosen to satisfy this).
- Every interactive element reachable by Tab; visible focus ring `2px solid var(--accent)` with `2px` offset.
- The mic button state is announced via `aria-live="polite"`: "Listening", "Processing", "Idle".
- The live transcript region is `aria-live="polite"` and `aria-atomic="false"`.
- Reminder trigger modal traps focus and is `role="alertdialog"`.
- Respect `prefers-reduced-motion`: disable the mic pulse animation and card slide-ins.
- Never encode meaning in colour alone — the "Local · Offline" chip has a lock glyph; error states have an icon plus text.

### 2.3 Window chrome

- Frameless window with a custom 40px title bar containing: app mark, "LifeOS", the privacy chip, and window controls.
- `titleBarStyle: 'hidden'` + `titleBarOverlay` on Windows so native controls remain.
- Minimum size 900×640. Default 1080×760.

## 3. Layout shell

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ◈ LifeOS            [ 🔒 Local · Offline ]              — □ ✕        │  40px title bar
├────────────┬─────────────────────────────────────────────────────────┤
│            │                                                         │
│  ◈ Yogi    │                                                         │
│            │                                                         │
│  💬 Chat   │                  <route content>                        │
│  📅 Sched  │                                                         │
│  🕘 History│                                                         │
│  ⚙ Settings│                                                         │
│            │                                                         │
│            │                                                         │
│  ─────────  │                                                        │
│  ● 3 active │                                                        │
└────────────┴─────────────────────────────────────────────────────────┘
     216px                        flexible
```

Left rail: fixed 216px, `--surface`. Bottom of rail shows a live count of active schedules and a Paused badge when reminders are paused.

## 4. Screen 1 — Onboarding

Shown once (`settings.onboarding_completed !== 'true'`). Three panes, dot indicator, Back/Continue.

### Pane 1 — Welcome

```text
                       ◈

              Welcome to LifeOS

        Meet Yogi, your privacy-first companion.

   Yogi listens when you ask, understands what you
   mean, and reminds you at exactly the right time.

                  [ Continue → ]
```

### Pane 2 — Your data stays here

```text
   🔒  Everything stays on this device

   ✓  Reminders, history and settings are stored in a
      local database on your computer.
   ✓  LifeOS has no server, no account, and no sync.
   ✓  Speech is transcribed on your machine, offline.
   ✓  Nothing is uploaded unless you explicitly turn on
      AI Assist in Settings — it is off by default.

   Your data lives at:
   %APPDATA%\LifeOS\                        [ Copy path ]

                [ ← Back ]  [ Continue → ]
```

### Pane 3 — Two things to know

```text
   🎤  Microphone
   Windows will ask for microphone permission the first
   time you press the mic button. Yogi only listens while
   you hold the button — there is no wake word and no
   background listening.

   🔔  Reminders need LifeOS running
   Closing the window keeps Yogi running in the system
   tray so reminders still fire. If you Quit from the
   tray menu, reminders will not fire until you reopen
   LifeOS.

   [ ] Show me example commands when I start

                [ ← Back ]  [ Get started ]
```

**Do not** request microphone permission during onboarding. Request it lazily on first mic press, so the permission prompt has obvious cause.

## 5. Screen 2 — Home / Chat

```text
┌───────────────────────────────────────────────────────────┐
│                                                           │
│   Good evening. What should I remember for you?           │  greeting, time-aware
│                                                           │
│   ┌─────────────────────────────────────────────────┐     │
│   │ You                                             │     │
│   │ Remind me tomorrow at 9 AM to attend the meeting│     │  user bubble, right
│   └─────────────────────────────────────────────────┘     │
│                                                           │
│   ┌─────────────────────────────────────────────────┐     │
│   │ ◈ Yogi understood                    ● 0.94     │     │  confirmation card
│   │                                                 │     │
│   │   Reminder                                      │     │
│   │   Attend the meeting                            │     │
│   │                                                 │     │
│   │   When                                          │     │
│   │   Tomorrow — Saturday, 11 July, 9:00 AM         │     │
│   │   in 15 hours 20 minutes                        │     │
│   │                                                 │     │
│   │   Repeat                                        │     │
│   │   Does not repeat                               │     │
│   │                                                 │     │
│   │  [ Confirm Reminder ]  [ Edit ]  [ Cancel ]     │     │
│   └─────────────────────────────────────────────────┘     │
│                                                           │
├───────────────────────────────────────────────────────────┤
│  “Remind me tomorrow at…”                                 │  live transcript strip
│  ┌──────────────────────────────────────────┐  ┌───────┐  │
│  │ Type a reminder, or press the mic…       │  │  🎤   │  │
│  └──────────────────────────────────────────┘  └───────┘  │
│   Try: “Remind me in 10 minutes to drink water”           │  quick chips
└───────────────────────────────────────────────────────────┘
```

### 5.1 Mic button states

| State | Visual | Announcement |
| --- | --- | --- |
| `idle` | `--accent` fill, mic glyph | "Microphone. Press to speak." |
| `initializing` | spinner, disabled | "Preparing microphone" |
| `listening` | `--listening` fill, 1.5s pulse ring, live waveform bars | "Listening" |
| `processing` | spinner | "Processing what you said" |
| `error` | `--danger` outline, slash glyph | "Microphone unavailable. Type instead." |

Press-to-start / press-to-stop (toggle), **not** hold-to-talk — hold-to-talk is hostile for long sentences. Auto-stop after 2.0 s of silence, hard cap 30 s.

### 5.2 Live transcript strip

- Occupies a fixed 24px row above the input so the layout never jumps.
- Interim text in `--text-mute`, italic. Final text in `--text`, then it moves into the input box.
- If the STT engine emits no partials, the strip shows an animated "Listening…" instead. **Layout must not depend on partials existing.**

### 5.3 Quick command chips

Four chips, click fills the input box (does not auto-submit):

```text
Remind me in 10 minutes to drink water
Remind me tomorrow at 9 AM to attend the meeting
Remind me every Monday at 7 AM to exercise
Please sing after 2 minutes
```

### 5.4 Confirmation card — anatomy

- Header: `◈ Yogi understood` + a confidence dot. Green ≥ 0.8, amber 0.5–0.8, red < 0.5 (red never reaches this card; it becomes a clarification).
- Body: labelled rows — Reminder / When / Repeat / (Action, only when `sing`).
- **When** row always shows two lines: the absolute formatted datetime, and a relative "in 15 hours 20 minutes" beneath it in `--text-dim`.
- Footer: `Confirm Reminder` (primary), `Edit` (secondary), `Cancel` (ghost).
- Keyboard: `Enter` confirms, `E` edits, `Esc` cancels.
- After confirm, the card collapses into a compact success row: `✓ Saved — Attend the meeting, Sat 11 July 9:00 AM  [View in Schedules]`.

### 5.5 Clarification card

When `needsClarification === true`, render this instead of the confirmation card. It never has a Confirm button.

```text
┌─────────────────────────────────────────────────┐
│ ◈ Yogi needs one detail                         │
│                                                 │
│ I can set a reminder for Friday, 17 July.       │
│ What time should I remind you?                  │
│                                                 │
│ [ 9:00 AM ] [ 12:00 PM ] [ 6:00 PM ]  ← chips   │
│                                                 │
│ ┌──────────────┐                                │
│ │  --:-- AM/PM │  [ Set time ]      [ Cancel ]  │
│ └──────────────┘                                │
└─────────────────────────────────────────────────┘
```

Chips are context-dependent:

| Ambiguity | Suggested chips |
| --- | --- |
| Missing time, generic | 9:00 AM, 12:00 PM, 6:00 PM |
| "morning" | 7:00 AM, 8:00 AM, **9:00 AM** (pre-selected) |
| "afternoon" | 1:00 PM, 3:00 PM, 4:00 PM |
| "evening" / "after lunch" | 5:00 PM, 6:00 PM, 7:00 PM |
| "at 6" (AM/PM unknown) | **6:00 AM**, **6:00 PM** only |
| Missing when, entirely | free time+date picker, no chips |

Answering a clarification **re-runs the parser** on the merged slots; it does not skip straight to persistence.

### 5.6 Edit form

Inline replacement of the card body:

```text
Title      [ Attend the meeting                    ]
Notes      [ (optional)                            ]
Date       [ 11 / 07 / 2026 ]   Time  [ 09:00 AM ]
Repeat     ( ) Does not repeat
           (•) Every week on  [M][T][W][T][F][S][S]
Action     ( ) Notify only    ( ) Notify and sing

                       [ Save reminder ]  [ Back ]
```

Validation is live: a past datetime disables Save and shows `That time has already passed.` beneath the field.

## 6. Screen 3 — Active Schedules

Never uses the words "cron", "job", or "RRULE" in the UI.

```text
Active Schedules                          [ ⏸ Pause all reminders ]

  NEXT UP
  ┌───────────────────────────────────────────────────────────┐
  │  ⏱  In 2 minutes                                          │
  │     Play Yogi song                          🎵 sing       │
  │     Next run: Today, 4:20 PM                              │
  │                                        [ Edit ] [ Delete ]│
  └───────────────────────────────────────────────────────────┘

  UPCOMING
  ┌───────────────────────────────────────────────────────────┐
  │  📅  Tomorrow at 9:00 AM                                  │
  │     Attend the meeting                                    │
  │     Next run: Saturday, 11 July, 9:00 AM                  │
  │                                        [ Edit ] [ Delete ]│
  └───────────────────────────────────────────────────────────┘

  REPEATING
  ┌───────────────────────────────────────────────────────────┐
  │  🔁  Every Monday at 7:00 AM                              │
  │     Exercise                                              │
  │     Next run: Monday, 13 July, 7:00 AM                    │
  │                       [ Pause ] [ Edit ] [ Delete ]       │
  └───────────────────────────────────────────────────────────┘
```

- "Next up" (< 1 hour) shows a **live countdown**, updating every second via a single shared interval. Everything else updates every 30 s.
- Recurrence rendered by an `rruleToHuman()` helper: `FREQ=WEEKLY;BYDAY=MO` → "Every Monday at 7:00 AM".
- Delete asks for confirmation inline (the row transforms into `Delete "Exercise"? [Yes, delete] [Keep]`) — no modal.
- Pausing an individual reminder greys the row and shows `Paused — will not run`.

### Empty state

```text
              📅

     No active schedules yet

  Ask Yogi to remind you about something.

  Try: “Remind me in 10 minutes to drink water”
                                    [ Go to Chat ]
```

### Paused banner

When `settings.reminders_paused === 'true'`, a sticky amber banner across all screens:

```text
⏸  Reminders are paused. Nothing will trigger.   [ Resume reminders ]
```

## 7. Screen 4 — Reminder History

Filter tabs: `All · Completed · Dismissed · Missed · Cancelled`

```text
  TODAY
  ✓  4:20 PM   Play Yogi song            Completed
  ✕  2:00 PM   Drink water               Dismissed
  ⚠  9:00 AM   Attend the meeting        Missed — LifeOS was closed

  YESTERDAY
  ✓  7:00 AM   Exercise                  Completed        🔁 weekly
```

- Grouped by day. Infinite scroll, page size 50.
- "Missed" rows carry the explanation inline — this is where the app's key limitation becomes honest and visible.
- A `Clear history` action in the header, guarded by a confirm. It deletes `reminder_history` rows only, never `reminders`.

### Empty state

`Nothing has triggered yet. Reminder activity will appear here.`

## 8. Screen 5 — Settings

Sectioned, single scroll column, max-width 720px.

```text
  PRIVACY
  🔒 LifeOS stores everything on this device.
     No account. No server. No sync. No telemetry.
     Data folder: %APPDATA%\LifeOS\        [ Open folder ] [ Copy path ]

  ─────────────────────────────────────────────────────────

  SPEECH
  Speech-to-text provider     [ Local (offline)        ▾ ]
                              Runs entirely on your computer.
  Model                       Small English model · 41 MB · loaded ✓
  Microphone                  [ Default — Realtek Audio ▾ ]  [ Test ]

  Text-to-speech voice        [ Microsoft Zira (offline) ▾ ]  [ Preview ]
  Speech rate                 [———●———————] 1.0×
  Speak reminders aloud       [ ●— ] On

  ─────────────────────────────────────────────────────────

  AI ASSIST                                            [ —● ] Off
  ⚠ When enabled, LifeOS may send the text of a command to your
    chosen AI provider — and only when local understanding is
    uncertain. Your reminders, history and memories always stay
    on this device.

    (disabled until toggled on)
    Provider                  [ OpenAI ▾ ]
    API key                   [ ••••••••••••••••  ] [ Save ] [ Remove ]
                              Stored encrypted on this device.
    Only when uncertain       [ ●— ] On   (recommended)
    Last used                 Never

  ─────────────────────────────────────────────────────────

  REMINDERS
  Notification sound          [ ●— ] On
  Snooze duration             [ 10 minutes ▾ ]
  Tick interval               [ 30 seconds ▾ ]   (advanced)

  ─────────────────────────────────────────────────────────

  WINDOW & TRAY
  Closing the window          (•) Keep Yogi running in the tray
                              ( ) Quit LifeOS completely
  ⚠ If LifeOS is not running, reminders cannot trigger.

  Theme                       [ System ▾ ]

  ─────────────────────────────────────────────────────────

  DANGER ZONE
  Reset LifeOS local data
  Permanently deletes reminders, history and settings stored in
  %APPDATA%\LifeOS\. Nothing outside this folder is touched.
                                        [ Reset local data… ]

  ─────────────────────────────────────────────────────────

  ABOUT
  LifeOS 0.1.0 · Yogi
  MIT License · github.com/<user>/lifeos
  [ View privacy statement ] [ Known limitations ] [ Open logs folder ]
```

### 8.1 Reset confirmation modal

Destructive, so it demands typing:

```text
  Reset LifeOS local data

  This will permanently delete:
    • 3 active reminders
    • 27 history entries
    • All settings, including your AI Assist key

  This will NOT touch any file outside:
    %APPDATA%\LifeOS\

  This cannot be undone.

  Type  RESET  to confirm:   [          ]

              [ Cancel ]   [ Reset local data ]   ← disabled until exact match
```

After reset: the app relaunches into onboarding.

### 8.2 AI Assist enable modal

Toggling AI Assist on opens a consent dialog — the toggle does not flip until consent is given.

```text
  Enable AI Assist?

  What gets sent:
    • The text of the command you typed or spoke,
      only when Yogi is not confident locally.
  What never gets sent:
    • Your reminders, history, memories or settings.
    • Any audio. Transcription always happens locally.

  Requests go to OpenAI under your own API key and are
  billed to your OpenAI account. Typical cost is well under
  ₹1 per month for normal use.

  [ Cancel ]                          [ I understand, enable ]
```

## 9. Screen 6 — Reminder trigger modal

Fires in the main window, which is shown and focused. Also fires as a Windows toast (which is what the user sees if the app is in the tray).

```text
┌────────────────────────────────────────────────┐
│                     ◈                          │
│                                                │
│            Time to attend the meeting          │  ← title, --fs-xl
│                                                │
│        Conference room B, bring the deck       │  ← description, --text-dim
│                                                │
│              Saturday, 11 July · 9:00 AM       │
│                                                │
│   [ Snooze 10 min ]  [ Dismiss ]  [ ✓ Done ]   │
└────────────────────────────────────────────────┘
```

Rules:
- Yogi speaks the title as the modal appears: *"Time to attend the meeting."*
- If `action_type = 'sing'`, the MP3 plays; the modal shows a stop button and a small equaliser animation.
- **Snooze is hidden** when the reminder is recurring (the next occurrence is already scheduled) — snoozing a weekly reminder is ambiguous and we refuse to guess.
- Focus lands on `Dismiss` (safest default), not `Done`.
- `Esc` = Dismiss. Never auto-dismiss on a timer; a reminder the user never saw is a failed reminder.
- If several reminders fire at once, they queue: the modal shows `1 of 3` and advances.

## 10. Global states

### 10.1 Error surfaces

| Failure | Surface | Recovery offered |
| --- | --- | --- |
| Mic permission denied | Inline banner under input | "Open Windows sound settings" + keep typing |
| Mic device missing | Mic button in error state | Typed input remains fully functional |
| STT model failed to load | Inline banner, mic disabled | "Retry" + "Use typed input" |
| Parse produced `unknown` intent | Yogi bubble | "I can only set reminders right now. Try: …" + chips |
| Date in the past | Confirmation card blocked | "That time has already passed. Did you mean tomorrow?" |
| DB write failed | Toast + Yogi bubble | "Couldn't save. [Retry] [Open logs]" |
| TTS unavailable | Silent degrade, one-time toast | Notification and modal still fire |
| AI Assist call failed | Yogi bubble | Falls back to local clarification question |
| App started, reminders overdue | Catch-up modal on launch | "3 reminders fired while LifeOS was closed" + list |

### 10.2 Overdue catch-up modal

Shown once on start when `scheduled_at < now` and `status = 'pending'`:

```text
   While LifeOS was closed…

   3 reminders were due and could not notify you.

   ⚠  9:00 AM   Attend the meeting
   ⚠  1:00 PM   Drink water
   ⚠  Mon 7 AM  Exercise         → rescheduled to Mon 13 July

   [ Dismiss all ]        [ Review in History ]

   Tip: use Quit only when you want reminders to stop.
```

Recurring reminders are silently rolled forward to their next future occurrence. One-time reminders are marked `missed`.

## 11. Yogi's voice — copy rules

| Do | Don't |
| --- | --- |
| "Okay. I'll remind you tomorrow at 9 AM to attend the meeting." | "Sure thing!! 😄 Reminder set!" |
| "I can set that. What time on Friday?" | "Hmm, I'm not sure what you mean." |
| "That time has already passed." | "Error: invalid date." |
| "I only set reminders right now." | "I'm sorry, I cannot do that." |

- Spoken confirmation template: `Okay. I will remind you {relative_or_absolute} to {title}.`
- Spoken trigger template: `{title}.` — short. Nothing else. It may be 3 AM.
- Spoken clarification template: `{clarificationQuestion}` verbatim from the parser.
- Yogi never says "I've saved that" before the DB write resolves.

## 12. Component inventory (for implementation)

```text
src/components/
  Button.tsx            variants: primary | secondary | ghost | danger
  Card.tsx
  Chip.tsx
  Banner.tsx            variants: info | warn | danger
  Modal.tsx             focus-trap, esc-to-close, role configurable
  ConfirmDestructive.tsx type-to-confirm modal
  Toast.tsx
  EmptyState.tsx
  Spinner.tsx
  Toggle.tsx
  Select.tsx
  TimeField.tsx
  DateField.tsx
  WeekdayPicker.tsx
  Countdown.tsx         shared 1s ticker via context

src/features/chat/
  ChatScreen.tsx
  MessageList.tsx
  UserBubble.tsx
  YogiBubble.tsx
  ConfirmationCard.tsx
  ClarificationCard.tsx
  EditReminderForm.tsx
  MicButton.tsx
  LiveTranscript.tsx
  QuickCommands.tsx
  Composer.tsx

src/features/schedules/
  SchedulesScreen.tsx
  ScheduleGroup.tsx
  ScheduleRow.tsx
  PausedBanner.tsx

src/features/history/
  HistoryScreen.tsx
  HistoryRow.tsx
  HistoryFilters.tsx

src/features/settings/
  SettingsScreen.tsx
  PrivacySection.tsx
  SpeechSection.tsx
  AiAssistSection.tsx
  AiAssistConsentModal.tsx
  RemindersSection.tsx
  TraySection.tsx
  DangerZone.tsx
  ResetDataModal.tsx
  AboutSection.tsx

src/features/reminders/
  TriggerModal.tsx
  OverdueCatchupModal.tsx

src/features/onboarding/
  OnboardingFlow.tsx
  PaneWelcome.tsx
  PaneData.tsx
  PaneMicAndTray.tsx
```

## 13. First-close-to-tray message

A native `dialog.showMessageBox` (not an HTML modal — the window is about to hide):

```text
Title:  LifeOS is still running
Body:   Yogi will keep running in the background so your reminders
        can work. Use Quit from the tray menu to fully close LifeOS.
Check:  [ ] Don't show this again
Button: [ Got it ]
```

Persist `settings.tray_notice_shown = 'true'`. Also show a tray balloon on the same event.

## 14. Tray menu

```text
  Open LifeOS
  View Active Schedules
  ─────────────────────
  Pause Reminders          ← swaps to "Resume Reminders" when paused
  ─────────────────────
  3 active · next in 12 min      (disabled label)
  ─────────────────────
  Quit LifeOS
```

Tray tooltip: `LifeOS — 3 active reminders`. Tray icon gets a small dot overlay when reminders are paused.

Left-click on the tray icon toggles window visibility; right-click opens the menu.
