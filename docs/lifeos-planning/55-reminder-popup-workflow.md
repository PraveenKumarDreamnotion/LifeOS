# 55 — Reminder Popup Workflow (conversational always-on-top toast)

> **Status:** design + execution plan. **Supersedes** the in-app `TriggerModal` as the primary
> reminder surface (the modal is retired once P1 ships). **Builds on:** CONV (persistent sessions +
> reminder→chat link + fire-into-chat), EP-3 STT, EP-4 TTS, EP-5 ConversationEngine, EP-6/EP-7
> dispatcher + voice-confirm. **Design authority for this feature.** Referenced from `12`
> (UI/UX), `35` (voice), `36` (dispatcher), `41` (roadmap), `53` (testing).
>
> **One-line objective:** when a reminder fires, Yogi shows a lightweight, always-on-top desktop
> popup at the bottom-right that speaks the reminder and lets the user **act on it and keep talking
> by voice or text** — without returning to the main window.

---

## 1. Objective & user story

Today a fired reminder produces an OS notification, an in-app `TriggerModal` (a dead-end
Dismiss/Snooze/Done), and — since CONV — a bubble in the reminder's chat. None of that is a
*conversation you can act on in place*. This feature replaces the modal with a **conversational
popup**:

- Appears bottom-right, above whatever app the user is in, **without stealing focus**.
- **Speaks** the reminder automatically.
- Shows title, description, time, Yogi avatar, and **mic + text input + Send**, plus
  **Complete / Dismiss / Snooze** buttons.
- The user can **talk or type back** — "remind me again in 30 minutes", "I already called him",
  "cancel this", "what was this about?", "thanks" — and Yogi acts / replies naturally.
- The exchange is bound to the reminder's **chat session** (CONV), so it lands in the right
  conversation and Yogi has the full prior context.

---

## 2. Electron technical research & recommendations

### 2.1 Always-on-top, above other apps, no focus-stealing

A dedicated frameless `BrowserWindow` per popup:

```ts
new BrowserWindow({
  width: 380, height: 220,           // grows if a conversation opens
  frame: false, resizable: false, movable: true, minimizable: false, maximizable: false,
  skipTaskbar: true,                 // it is not an app window
  show: false,                       // shown via showInactive() — see below
  alwaysOnTop: true,
  focusable: true,                   // the text input MUST accept keys when clicked
  webPreferences: { ...secureDefaults, preload: <popup preload> },
});
win.setAlwaysOnTop(true, 'screen-saver'); // highest practical level on Windows — over fullscreen apps
win.showInactive();                        // KEY: shows without activating → the user's app keeps focus
```

- **`showInactive()` (not `show()`/`focus()`) is the anti-focus-steal mechanism.** The popup is
  visible and on top, but the foreground app keeps keyboard focus. The user *clicks* the popup to
  type — normal, expected, non-intrusive. Never call `.focus()` on appear.
- **`focusable: true`, not `false`.** `focusable:false` would block the text input entirely;
  `showInactive` already prevents the steal.
- `setAlwaysOnTop(true, 'screen-saver')` keeps it above other always-on-top windows and most
  fullscreen apps on Windows. (True exclusive-fullscreen games can still cover it — acceptable; the
  OS notification remains the floor.)

### 2.2 Bottom-right positioning + multi-monitor

Use the **`screen`** module and the display's **`workArea`** (excludes the taskbar), on the display
where the user's cursor is:

```ts
const cursor = screen.getCursorScreenPoint();
const { workArea } = screen.getDisplayNearestPoint(cursor);   // multi-monitor aware
const MARGIN = 16;
win.setBounds({
  x: workArea.x + workArea.width  - width  - MARGIN,
  y: workArea.y + workArea.height - height - MARGIN,
  width, height,
});
```

- `workArea` (not `bounds`) sits the popup **above the taskbar**, whatever its edge/size.
- `getDisplayNearestPoint(getCursorScreenPoint())` puts it on the monitor the user is actually
  using. Re-read on each show (displays can change; laptops dock/undock).
- If the window grows when a conversation opens, re-pin the bottom-right corner (anchor bottom-right,
  grow upward) so it never runs off-screen.

### 2.3 Popup lifetime & focus behavior

- **Persists until the user acts** (Complete/Dismiss/Snooze) or replies. No aggressive auto-close.
- A **generous safety timeout** (e.g. 10 min) auto-hides the popup **without** touching the reminder
  (it stays in Active Schedules) so an ignored popup doesn't pile up forever — fails safe, never
  auto-completes.
- Focus: shown inactive; gains focus only when the user clicks it. Losing focus does **not** close
  it (unlike a menu) — it's a persistent toast.

### 2.4 Preventing focus stealing — summary

`show:false` → `showInactive()` → never `.focus()`. That is the whole mechanism. TTS speaking does
not require focus (it plays through the hidden audio window, `13 §4`).

### 2.5 Smooth animations

- **CSS transform slide-in from the right** + fade on mount inside the popup renderer (cheap,
  smooth, no window-bounds animation jank on Windows).
- **Honor `prefers-reduced-motion`** — no slide, just a fade/instant (accessibility ask).

### 2.6 Interaction with Windows notifications

- **The OS `Notification` still fires FIRST and UNCONDITIONALLY** (the `41 §8.6` reliability
  invariant, and the screen-reader floor for a non-focusable popup). The popup is the **rich layer
  on top**, not a replacement gated on failure detection.
- The redundancy (OS toast + popup) is the deliberate safe choice; de-duping/tuning is a later
  decision, not architecture. Clicking the OS toast focuses the main window (unchanged).

### 2.7 Multiple reminders — QUEUE, not stack (first cut)

`RECOMMENDATION` — **one popup at a time, with a FIFO queue** (not N stacked windows), because:

- The **speech pipeline is a single-session singleton** (`electron/main/ipc/speech.ts`:
  `provider`/`sessionId`/`sessionActive` are module globals). Stacked popups all wanting the mic
  would contend for one capture session. A single active popup bounds contention to *main + one
  popup*.
- **TTS is serialized** naturally — one popup speaks at a time; the queue advances only after the
  current is handled, so voices never overlap (Test 4).
- Position/focus math collapses to one window.

Behavior: the popup shows a **"+N more" chip** when reminders are queued; acting on the current one
(or dismissing) advances to the next. Stacked/side-by-side popups are a **future enhancement** once
speech is multi-session (see `Deferred`).

### 2.8 Accessibility

- OS notification remains the accessible, screen-reader-friendly path (fires first).
- Popup content: `role="alertdialog"`, `aria-live="assertive"` on the reminder text, all controls
  keyboard-reachable and labelled; a global shortcut (e.g. `Ctrl+Shift+Y`) to focus the newest
  popup for keyboard users (since it shows inactive).
- `prefers-reduced-motion` honored. Full reminder actions remain available from the main window's
  Active Schedules (never popup-only).

### 2.9 Security (do-not-weaken, `11`)

- The popup is a **clone of `createAudioWindow`** (`electron/main/windows.ts`): `secureDefaults`
  (contextIsolation, sandbox, no nodeIntegration), the `loadRenderer` dev/prod helper, its own
  bundled preload (named functions only, no `ipcRenderer` exposed), and a self-heal cap.
- Building on that pattern is what makes the popup inherit `installSessionSecurity` — the CSP +
  `api.openai.com` allowlist + navigation locks. A popup on a fresh/un-secured session would be
  either dead (no OpenAI) or a hole. **New renderer = new html entry + preload + electron-vite
  input**, all modelled on `audio-host`.
- `isSenderOurWindow` (guard.ts) must accept the popup's frame, or its IPC (including mic frames)
  is silently dropped.

---

## 3. The linchpin for the conversation phase (P2)

**All chat/action broadcasts are currently hardcoded to `mainWindow`** (`electron/main/index.ts`):
`CHAT_DONE`, `ACTION_RESOLVED`, `ACTION_EXPIRED`, `CHAT_TURN_APPENDED` all do
`const w = mainWindow; w.webContents.send(...)`. A popup that calls `chatSend` sets `busy=true` and
waits for a `chat:done` that **only reaches the main window → it hangs forever** (the exact failure
`src/lib/ipc.ts` warns about).

`FIX (P2 foundation)` — switch those four sends to the **all-windows fan-out** already used by
`broadcastRemindersChanged`:

```ts
for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
```

This is **safe** because every consumer already self-filters: each renderer's `chatSend` adapter
matches by `turnId`, `action:resolved`/`action:expired` filter by `turnId`, `chat:turn:appended`
filters by `sessionId`. A window ignores what it didn't initiate. This change is the first task of
P2; nothing conversational in the popup works without it.

---

## 4. UI specification

```text
┌────────────────────────────────────────────┐
│  🔵 Yogi                              ✕     │   ← avatar + close (dismiss-popup, not reminder)
│  Reminder · 9:00 AM                         │   ← kind label + reminder time
│  Call Rahul                                 │   ← title (bold)
│  Ask about the Q3 numbers                   │   ← description (dim, if any)
│  "It's time to call Rahul."                 │   ← spoken line (Yogi speaks it on show)
│                                             │
│  ┌───────────────────────────────┐         │
│  │ 🎤  type a reply…          ➤ │         │   ← mic + text input + send  (P2)
│  └───────────────────────────────┘         │
│  [ Complete ]  [ Snooze ▾ ]  [ Dismiss ]    │   ← lifecycle buttons (P1)
│                                    +2 more  │   ← queue chip when reminders are queued
└────────────────────────────────────────────┘
```

- **P1** ships everything except the mic/text/send row and conversational replies (that row is
  present but disabled/hidden until P2).
- **Snooze ▾** offers quick options (10 min / 1 hour / tonight) — reuses `reminders:snooze`.
- **Complete** → `reminders:complete`; **Dismiss** → `reminders:dismiss`; **✕** hides the popup only
  (reminder untouched, still in Active Schedules).
- Recurring reminders: Snooze hidden or labelled per the existing `TriggerModal` caution
  (`TriggerModal.tsx`).

---

## 5. Conversation from the popup (P2)

The popup is a **mini chat bound to the reminder's `sessionId`** (CONV). Voice/text → `chat:send`
with that session → `ConversationEngine` → reply on `chat:done` (via the §3 fan-out). Yogi has the
full prior context of that chat automatically.

**Natural-language → reminder lifecycle** — this is the deferred EP-6/EP-7 conversational lifecycle
(`36`, `48`): only `reminder_create` exists today. P2 adds, behind the dispatcher + a confirm gate
where consequential:

| User says | Intent | Action |
| --- | --- | --- |
| "remind me again in 30 minutes" / "snooze an hour" | `reminder_update` (snooze) | `reminders:snooze`, popup updates/closes |
| "I already called him" / "done" | `reminder_complete` | `reminders:complete`, popup closes; Active Schedules updates; History records |
| "cancel this reminder" | `reminder_delete` | confirm → `reminders:delete` |
| "what was this about?" | `question` | Yogi explains from the chat context |
| "thanks" | `chat` | natural reply |

`SCOPE HONESTY` — **P1 landing does not mean P2 is close.** P2 is real NLU→action work
(complete/snooze/update/delete by voice/text), each needing the dispatcher path and, for
delete, a confirmation (reuse EP-7's voice-confirm matcher). The "reference resolution" is trivial
here (the popup already *is* about one specific reminder — no `reminderRef` ambiguity), which is
what makes doing it from the popup much smaller than the general conversational edit/delete.

**Voice from the popup** reuses EP-3 STT, but the speech singleton means: the popup owns the mic
while open; the matcher/transcript routing (`speech.ts`) must key off the *active popup's* session,
not `mainWindow`. Serialize with any main-window dictation.

**Null-session reminder** (manual/pre-existing, `session_id = null`): the popup still shows, speaks,
and offers the buttons; a chat session is **minted lazily** only if the user starts talking. Never
crash on null session.

---

## 6. Execution phases

| Phase | Ships | Depends on | Conversational? |
| --- | --- | --- | --- |
| **P1 — Popup shell** | Frameless always-on-top popup, bottom-right, multi-monitor, `showInactive`, speak-on-show, avatar/title/desc/time, **Complete/Dismiss/Snooze** buttons (existing `reminders:*` IPC), single-popup **queue** with "+N more", slide-in + reduced-motion, retire `TriggerModal`. **No conversation.** | CONV, EP-4 TTS, `reminders:*` lifecycle IPC | ✗ |
| **P2 — Conversation** | §3 broadcast fan-out; text + voice reply bound to the reminder's session; NLU→lifecycle (complete/snooze/update/delete-with-confirm); lazy session for null-session reminders. | P1 + the EP-6/7 dispatcher lifecycle | ✓ |
| **P3 — Polish** | Multi-popup UX beyond the queue (if speech goes multi-session), accessibility pass (focus shortcut, full ARIA), animation polish, focus-rule edge cases, Windows-notification de-dupe tuning. | P1 + P2 | — |

P1 is a **clean, shippable, live-testable slice** that needs neither the broadcast fan-out nor the
speech rework — its buttons are the existing lifecycle IPC.

---

## 7. Files (P1)

| File | Change |
| --- | --- |
| `electron/main/windows.ts` | **New** `createReminderPopupWindow()` — clone of `createAudioWindow`: frameless, always-on-top (`'screen-saver'`), `skipTaskbar`, `showInactive`, secure defaults, own preload, self-heal cap. |
| `electron/main/reminder-popup.ts` | **New** popup coordinator (main): position bottom-right of the cursor display; the **FIFO queue** (one visible at a time, "+N more"); speak-on-show; safety timeout; map Complete/Dismiss/Snooze to `reminders:*`. |
| `electron/preload/popup.ts` | **New** popup preload (named fns only): receive the reminder to show; invoke complete/dismiss/snooze; report "shown". |
| `src/popup/*` + `popup.html` | **New** popup renderer (React): the §4 UI; speak-on-show handled in main via the audio window. |
| `electron.vite.config.*` | Add the popup html entry + preload input (model on `audio-host`). |
| `electron/scheduler/trigger-sink.ts` | The `ui` step now shows the **popup** instead of (or alongside) `reminder:trigger`→`TriggerModal`. Notification+history stay first/unconditional. |
| `electron/main/session.ts` | Ensure `installSessionSecurity` + CSP/allowlist apply to the popup window (inherited via the shared session — verify). |
| `src/features/reminders/TriggerModal.tsx` | Retired as the primary surface once the popup ships (kept behind a flag for one release as rollback, per `41 §10`). |

---

## 8. Testing (P1 unless noted)

**Automated (unit/integration):**
- Popup coordinator queue: N reminders in → one visible, "+N more" correct; advancing dequeues FIFO;
  empty queue hides the popup.
- Positioning math: given a `workArea`, computes bottom-right minus margin; picks the cursor's
  display; re-pins on grow.
- Trigger-sink: notification+history still fire first/unconditionally; popup show is best-effort
  (a throw never blocks the notification) — extends `tests/unit/trigger-sink.test.ts`.
- Lifecycle mapping: Complete/Dismiss/Snooze call the correct `reminders:*` IPC.
- (P2) Broadcast fan-out: a `chat:done`/`resolved`/`appended` reaches every window; each renderer
  self-filters by turnId/sessionId.

**Manual (the user's acceptance tests):**

*Test 1 — over another app.* Minimize LifeOS to tray → open VS Code/Chrome → wait for a reminder.
**Expect:** popup appears bottom-right **above** the active app; Yogi speaks it; the main window
stays minimized; the user's app keeps keyboard focus (no steal).

*Test 2 (P2) — voice.* Click mic in the popup, say "remind me again after 30 minutes." **Expect:**
recognized; Yogi snoozes the reminder; popup updates/closes.

*Test 3 (P2) — text.* Type "I already completed it." → Send. **Expect:** Yogi marks it complete; it
leaves Active Schedules; History records it.

*Test 4 — multiple.* Trigger several reminders close together. **Expect:** popups are **queued**
(one shown, "+N more"); no confusing overlap; voices do **not** talk over each other; each reminder
is actionable independently as the queue advances.

*Test 5 — multi-monitor.* Move the cursor to a second display; trigger a reminder. **Expect:** popup
appears bottom-right of **that** display, above the taskbar.

*Test 6 — reduced motion.* Enable OS "reduce motion"; trigger a reminder. **Expect:** no slide
animation (fade/instant), popup still appears correctly.

*Test 7 — reliability.* Kill the popup renderer (or force a show failure); trigger a reminder.
**Expect:** the OS notification + history still fire; a missed reminder is never possible.

---

## 9. Risks

- `RISK` — **broadcasts stay mainWindow-only into P2** → popup chat hangs. *Mitigation:* §3
  fan-out is the first P2 task, with a unit test that all windows receive `chat:done`.
- `RISK` — **speech singleton contention** if two surfaces capture at once. *Mitigation:* one popup
  at a time (queue); the active popup owns the mic; serialize with main-window dictation.
- `RISK` — **focus-steal regression** (a stray `.focus()` / `show()`). *Mitigation:* `showInactive`
  only; a manual Test-1 focus check every release.
- `RISK` — **popup escapes the secured session** (no CSP/allowlist) → dead or a hole.
  *Mitigation:* clone `createAudioWindow`; verify `isSenderOurWindow` accepts the popup frame.
- `RISK` — **reliability inverted** (notification gated on popup failure). *Mitigation:* OS
  notification unconditional-and-first, always (Test 7).

---

## 10. Rollback

- **P1:** a `reminder_popup_enabled` flag (default on once verified); off → the retained
  `TriggerModal` path (`41 §10`). A regression is a flag flip.
- **P2:** conversation degrades to P1 buttons if the engine/speech is unavailable; the buttons never
  depend on cloud.
- Full kill: notification + history + Active Schedules always work — the reminder loop never depends
  on any popup code.
