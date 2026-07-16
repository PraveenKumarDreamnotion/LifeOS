# User Flows

> **Home:** [docs/README.md](./README.md) · **Related:** [FEATURE_GUIDE](./FEATURE_GUIDE.md) · [ARCHITECTURE](./ARCHITECTURE.md)

End-to-end journeys, each traceable to source. These are the flows that work today.

## 1. App launch → ready

```mermaid
flowchart TB
    L[Launch LifeOS] --> SI{single-instance lock}
    SI -->|second instance| F[focus existing window · quit]
    SI -->|first| DB[open + migrate SQLite · seed 50 settings]
    DB --> SEC[install session security · default-deny network]
    SEC --> SVC[build engine · dispatcher · scheduler · providers · Gmail]
    SVC --> WIN[create hidden audio/popup/launcher windows]
    WIN --> REC[scheduler.reconcile 'startup' · overdue catch-up]
    REC --> MW{opened at login?}
    MW -->|yes, hidden flag| TRAY[stay in tray · scheduler runs]
    MW -->|no| SHOW[show main window]
    SHOW --> OB{onboarding_completed?}
    OB -->|no| ONB[3-pane onboarding]
    OB -->|yes| CHAT[Chat screen · offline chip reflects key presence]
```

## 2. Conversation (typed or voice)

```mermaid
sequenceDiagram
    participant U as User
    participant CS as ChatScreen / useConversation
    participant M as main · startChatTurn
    participant E as ConversationEngine
    participant AW as Audio window
    U->>CS: type, or press mic → speak → transcript fills composer
    CS->>M: chat:send(text, sessionId)
    M->>E: startTurn (turnId)
    Note over CS: optimistic user bubble + thinking indicator
    E->>E: local router? → cloud LLM? → offline parser?
    E-->>CS: chat:done {turnId, reply, parse?, proposal?}
    E->>AW: onSpeak(reply) → Stop-speaking button appears
    Note over CS: reply renders — a reminder proposal shows a card
```

- Offline (no key): reminder-shaped input → local parser; time/greeting/settings → local router; genuine reasoning → honest "connect OpenAI" notice.
- Online: conversational reply, with a thinking / "🔎 Searching the web…" indicator, and a **Stop speaking** button while Yogi talks. Pressing the mic mid-speech interrupts.

## 3. Create a reminder (the confirmation gate)

```mermaid
flowchart LR
    U["'remind me after two minutes to call Biplab'"] --> ENG[engine]
    ENG --> PARSE[LOCAL parseReminder → ParsedReminder]
    PARSE --> DISP[ActionDispatcher.propose → card + spoken prompt]
    DISP --> CONF{confirm?}
    CONF -->|click Confirm OR say 'yes'| EXEC[ExecutionLayer → SQLite + verify next_fire_at]
    CONF -->|90s no answer| CANCEL[expire = cancel]
    EXEC --> SCH[appears under Active Schedules · scheduler picks it up]
```

The reminder shows the title, absolute + **live** relative time, and recurrence. Nothing persists until you confirm. See [REMINDER_SYSTEM](./REMINDER_SYSTEM.md).

## 4. Reminder fires

```mermaid
flowchart TB
    DUE[next_fire_at ≤ now · 30s reconcile] --> FIRE[TriggerSink.fire]
    FIRE --> N[Windows notification — UNCONDITIONAL]
    FIRE --> H[history 'triggered' — UNCONDITIONAL]
    N --> POP[reminder popup bottom-right · speaks natural line]
    POP --> ACT{user acts}
    ACT -->|Complete/Snooze/Dismiss OR 'mark it done'| LC[lifecycle write + history]
    ACT -->|ask a follow-up| CHATC[continues the reminder's chat]
    FIRE --> DEL[delivered back into its originating chat]
    LC --> DRAIN[queue drains → resume any paused conversation]
```

If it was an **AI-task** reminder, the executor runs the web search and speaks/delivers the answer instead of the title.

## 5. Voice launcher (hotkey → answer)

```mermaid
stateDiagram-v2
    idle --> listening: Alt+Shift+Space
    listening --> processing: press again / silence
    processing --> review: transcript
    review --> sending: Send
    sending --> speaking: reply + TTS
    speaking --> idle: TTS ends
```

Press the hotkey anywhere → the launcher slides in bottom-right, listens, transcribes, and Yogi answers — as a compact live chat that stays in sync with the main window. See [LAUNCHER](./LAUNCHER.md).

## 6. Web-search question

"Contact number of NIT Hamirpur" → the engine classifies `research` → forces a search → "🔎 Searching the web…" in both windows → answer + Sources. On failure it says so honestly. See [WEB_SEARCH](./WEB_SEARCH.md).

## 7. New email (Gmail connected)

```mermaid
flowchart LR
    SYNC[incremental sync finds new INBOX+UNREAD mail] --> SUM[summarize via gated LLM]
    SUM --> QC[quiet email chat + assistant delivery turn]
    QC --> TOAST[one notification + one spoken heads-up per batch]
    TOAST --> CLICK[click → open that email's chat in launcher/main]
    CLICK --> QA[ask Yogi about it — summary/sender/action grounded]
    SUM -->|research-worthy| RES[auto web-research → silent turn with sources]
```

See [AI_INTEGRATIONS §Gmail](./AI_INTEGRATIONS.md).

## 8. Offline session (no API key)

```mermaid
flowchart TB
    A[No key · chip shows '🔒 Offline · on-device'] --> B{input}
    B -->|'what time is it'| C[local router · instant]
    B -->|'remind me in 5 to stretch'| D[local parser → confirmable card → schedule]
    B -->|'hello' / 'help'| E[local greeting/help]
    B -->|'explain quantum computing'| F[honest 'needs an online provider' notice]
```

Reminders, time/date, greetings, help, and "open settings"/"show schedules" all work with **zero network**. See [BACKEND §local-command-router](./BACKEND.md).

## 9. Manage & maintain

- **Schedules** — see/pause/delete upcoming reminders (live-ticking times).
- **History** — filter past events (All/Completed/Dismissed/Missed).
- **Settings** — key, voice, Gmail, theme, launch-at-login, close-to-tray, **Reset local data** (type `RESET` → wipe + relaunch to onboarding).
- **Tray** — Open / View schedules / Pause-all / Quit; the app lives in the tray (close-to-tray by default).

## 10. Pause / resume everything

Pause-all (tray / banner / settings) stops the scheduler firing; Resume reconciles to catch anything that came due while paused.
