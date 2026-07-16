# Frontend (React Renderers)

> **Home:** [docs/README.md](./README.md) · **Related:** [ARCHITECTURE](./ARCHITECTURE.md) · [IPC](./IPC.md) · [USER_FLOWS](./USER_FLOWS.md) · [LAUNCHER](./LAUNCHER.md)

The renderer is **React 19 + TypeScript**, sandboxed (no Node access). There are **four separate renderer entry points** — the main window, the reminder popup, the voice launcher, and the hidden audio host — each with its own HTML file and `main.tsx`, all sharing `core/` and `src/styles/global.css`.

**Styling is plain CSS with custom properties — no Tailwind, no CSS-in-JS.**

## 1. The four windows

| Window | Root component | Bridge | HTML entry |
| --- | --- | --- | --- |
| Main | `src/app/App.tsx` | `window.lifeos` | `src/index.html` |
| Reminder popup | `src/popup/PopupApp.tsx` | `window.lifeosPopup` | `src/popup.html` |
| Voice launcher | `src/launcher/LauncherApp.tsx` | `window.lifeosLauncher` | `src/launcher.html` |
| Hidden audio | `src/audio-host.ts` (no React) | `window.lifeosAudio` | `src/audio-host.html` |

The IPC wrapper `src/lib/ipc.ts` is the **sole toucher** of `window.lifeos`; it unwraps the `Result<T>` envelope into a value or throws `AppError`. `src/types/window.d.ts` declares all three bridge shapes.

## 2. Main window (`App.tsx`)

**State-based navigation** (no router). `type View = 'chat' | 'schedules' | 'history' | 'settings'`; a left rail switches `view`. Gating: `!settings` → branded spinner; `!settings.onboardingCompleted` → `OnboardingFlow`; else the app.

- **Offline chip** (rail foot): keyed off `settings.hasApiKey` → `🔒 Offline · on-device` vs `☁ OpenAI connected`. It reflects runtime capability (no key = provably offline), not provider selection.
- **Paused banner** when `settings.remindersPaused`.
- **Global subscriptions** (one `useEffect`): `onReminderTrigger` → queue a `TriggerModal`; `onNavigate` → switch view (local "open settings"); `onGmailOpenChat` → switch to Chat + open that email's session.
- **Modals**: `TriggerModal` (in-app fired reminder when the popup is disabled) and `OverdueModal` (missed-while-closed).

### Screens

| Screen | File | What it shows |
| --- | --- | --- |
| **Chat** | `features/chat/ChatScreen.tsx` | Sessions sidebar (resumable, deletable, auto-titled) + scrolling transcript + composer + mic. Empty-state guides the `Shift+Alt+Space` shortcut. |
| **Schedules** | `features/schedules/SchedulesScreen.tsx` | Active reminders (pending/triggered) with **live-ticking** relative time, per-reminder pause (recurring), delete (confirmed), pause-all. |
| **History** | `features/history/HistoryScreen.tsx` | Past events with filter chips (All/Completed/Dismissed/Missed); illustrated empty state. |
| **Settings** | `features/settings/SettingsScreen.tsx` | Privacy, OpenAI, Voice, Gmail sections + Speech/Launcher/Reminders/Window&tray/Danger/About. See [SETTINGS](./SETTINGS.md). |
| **Onboarding** | `features/onboarding/OnboardingFlow.tsx` | 3-pane first-run intro (Welcome / Data / Mic+Tray); mic permission deferred. |

### Chat internals

- **`useSessions`** — the sidebar list + `currentId`; opens the most-recent **non-email** chat on mount (or creates the first); reports the open chat via `setActiveSession` (launcher continuity); refreshes on `onSessionsChanged`.
- **`useConversation(sessionId)`** — the message model. Holds `messages: ChatMessage[]`, `busy`, `searching`. Subscribes to `onSearching`, `onTurnStarted` (live launcher turns → user + thinking placeholder), history hydration on session change, `onActionExpired` (auto-cancel a pending proposal after 90s), `onTurnAppended` (live mirror of external turns), `onActionResolved` (settle a voice-confirmed proposal). Actions: `send` → `chatSend`, `confirm/cancel` (EP-2 local proposal → `createReminder`), `confirmDispatch/cancelDispatch` (EP-6 dispatcher → `actionConfirm(turnId)`).
- **`conversation-types.ts`** — `ChatMessage` (`role`, `text`, `kind?`, `pending?: 'thinking'|'searching'`, `proposal?` local, `dispatchProposal?` main-stored), `MessageProposal`, `DispatchProposal`.
- **`MessageList` / `MessageBubble`** — auto-scroll, `aria-live`; a bubble renders text or a thinking/searching placeholder, then a `ProposalCard` (local parse card with clarification chips) or a `DispatchCard` (Confirm/Cancel relaying `turnId`, with a voice hint). Reminder and email delivery turns get distinct bubble styles. A **normal assistant reply is rendered as Markdown** (`<Markdown>`); user bubbles and email/reminder deliveries stay plain pre-wrap text.
- **`components/Markdown.tsx`** — a tiny, dependency-free Markdown → React renderer shared by the main chat, the voice launcher, and the reminder popup, so all three show AI replies identically. Supports `#`–`######` headings (capped at `<h3>`), `-`/`*`/`1.` lists (list items may be separated by blank lines, as the model emits them → one `<ol>`/`<ul>`), `**bold**`, `*italic*`, `` `code` ``, and `[text](url)` links (rendered as **text only** — the URL is dropped). It builds **React elements only, never `dangerouslySetInnerHTML`** (XSS-safe on untrusted model output) and is **tolerant of partial/malformed Markdown** (an unclosed `**` or half-typed link degrades to literal text, never throws). `_`/`__` are intentionally not emphasis, so `snake_case` survives. Styles: `.md*` in `styles/global.css` (+ compact `.launcher-md` overrides in `launcher.css`). See [AI_INTEGRATIONS](./AI_INTEGRATIONS.md).
- **`MicButton`** — state-driven icon/label from `useSpeech`'s `MicState`.
- **`LegacyChatScreen`** — the pre-conversation single-shot parse→card screen, retained behind the `conversation_ui_enabled` flag (a maintenance fork — see [ROADMAP](./ROADMAP.md)).

## 3. Hooks (`src/hooks/`)

| Hook | Returns | IPC |
| --- | --- | --- |
| `useSettings` | `{settings, update, refresh}` | `getSettings`, `updateSettings`, `onSettingsChanged`; `applyTheme` sets/removes `data-theme` on `<html>` |
| `useReminders` | `{reminders, error, refresh}` | `listReminders`, `onRemindersChanged` |
| `useNow(intervalMs=20000)` | current `Date.now()` (re-renders on interval) | none — drives live-ticking relative times |
| `useSpeech(onFinal, bridge, beforeStart?)` | `{state, partial, errorMsg, toggle, supportsPartials, volume}` | injected `bridge` (`start/stop/pushAudio/onPartial/onError`) — same hook drives main, popup, and launcher windows |

`useSpeech` is the renderer half of the audio pipe: `getUserMedia` → `AudioContext` → the `pcm16-downsampler` AudioWorklet → `bridge.pushAudio`, with RMS-based `volume` (voice bars) and energy-gated endpointing (2s trailing silence, 30s hard cap). See [VOICE_PIPELINE](./VOICE_PIPELINE.md).

## 4. Reminder popup (`src/popup/PopupApp.tsx`)

A separate renderer that is a **compact chat client**. It renders the current reminder (title/description/spoken line) + a scrollable message thread + a docked composer (mic + input) + footer actions (Complete / Snooze menu / Dismiss) with a "+N more" queue chip. It uses `useSpeech` with the `window.lifeosPopup.speech` bridge. `submit()` first tries a lifecycle classification via `popup:message`, else sends a normal chat turn. No explicit phase enum — it's "data present" vs `if (!data) return null` (so the entrance animation replays on each show). See [REMINDER_SYSTEM §popup](./REMINDER_SYSTEM.md).

## 5. Voice launcher (`src/launcher/LauncherApp.tsx`)

A frameless floating widget; a compact live chat. Driven by a `DesktopVoiceState` (phases: `idle`/`hover`/`listening`/`processing`/`sending`/`speaking`/`review`/`complete`/`error`) received over `onStateChanged`. Renders `null` when idle/hover. Live mic bars (`Waveform` from `speech.volume`), a chat switcher dropdown in the header, and `useLauncherMessages(sessionId)` — a **pure subscriber** to the shared turn broadcasts (`onTurnStarted`/`onSearching`/`onTurnAppended`). See [LAUNCHER](./LAUNCHER.md).

## 6. Hidden audio host (`src/audio-host.ts`)

Not React — a script that hosts TTS playback. Two paths: `speechSynthesis` (Windows voices, resolved via the voice catalog) and OpenAI audio via `<audio>` (whole-clip `blob:` URL, or **MSE streaming** for low latency). Reports `audio:playing` (drives the Stop-speaking button and gates email TTS) and `audio:playbackError` (triggers the Windows fallback). See [VOICE_PIPELINE §TTS](./VOICE_PIPELINE.md).

## 7. Styling & theming

- Three stylesheets: `src/styles/global.css` (the shared design system, imported by every window), `src/launcher/launcher.css`, `src/popup/popup.css` (window-specific, consume the shared tokens).
- **Theming**: `:root` defines light tokens (`--bg`, `--surface`, `--text`, `--accent: #f97316` orange, …); `@media (prefers-color-scheme: dark)` overrides for system-dark; `:root[data-theme='dark']` forces dark. `useSettings.applyTheme` sets/removes `data-theme` on `<html>` (`system` → attribute removed so the media query governs). All windows honor the user's forced theme; the main process also drives Chromium's `nativeTheme` so the frameless popup/launcher follow it.
- **`Modal`** (`src/components/Modal.tsx`) — a real focus trap (Tab/Shift+Tab wrap, Escape handler); the overlay has **no click-to-dismiss** (a reminder must be acted on, not dismissed by a stray click). Used by TriggerModal, OverdueModal, ResetModal, and the consent modals.

## 8. Known frontend debt

- **No shared `.btn` primitive** — primary/ghost button styles are redefined across selector groups (a restyle touches several).
- **`LegacyChatScreen`** duplicates card logic (a fork behind a flag).
- **Popup snooze menu** uses `role="menu"` without arrow-key nav or click-outside-to-close.

See [ROADMAP §technical debt](./ROADMAP.md).
