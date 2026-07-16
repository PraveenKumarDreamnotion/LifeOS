# Architecture

> **Home:** [docs/README.md](./README.md) · **Related:** [BACKEND](./BACKEND.md) · [FRONTEND](./FRONTEND.md) · [IPC](./IPC.md)

LifeOS is a standard-but-hardened Electron application: one privileged **main process** (Node), several **renderer windows** (sandboxed Chromium), and **sandboxed preload** bridges between them. The valuable, portable logic lives in a pure-TypeScript **`core/`** layer with no Electron or Node imports.

## 1. Layered architecture

```mermaid
flowchart TB
    subgraph core["core/ — pure TypeScript (no Electron, no Node)"]
        P[parsing/ · scheduling/ · time/]
        C[conversation/ system-prompt · turn-schema · intent]
        S[llm/ speech/ tts/ search/ — provider SEAMS]
        T[types/ · actions/ · routing/ · settings/ · gmail/ · tts/]
    end

    subgraph main["electron/ — MAIN PROCESS (Node, never throttled)"]
        DB[(SQLite via node:sqlite)]
        SCH[Scheduler + TriggerSink]
        ENG[ConversationEngine]
        DISP[Action Dispatcher]
        REG[Provider Registry]
        GM[Gmail sync + delivery]
        TRAY[Tray · Notifications · STT service]
        POP[Reminder-popup coordinator]
        LAU[Desktop-voice controller]
    end

    subgraph windows["RENDERERS — sandbox:true, no Node"]
        MW[Main window · React 19]
        RP[Reminder popup window]
        LW[Voice launcher window]
        AW[Hidden audio window]
    end

    subgraph preload["PRELOAD — sandboxed CJS, one bundled file each"]
        PL1[index.ts → window.lifeos]
        PL2[popup.ts → window.lifeosPopup]
        PL3[launcher.ts → window.lifeosLauncher]
        PL4[audio.ts → window.lifeosAudio]
    end

    core --> main
    main <-->|validated IPC · Result envelope| preload
    preload <--> windows

    ENG --> REG
    REG -->|opt-in, keyed, consented| OA[(api.openai.com)]
    GM --> GG[(Google Gmail API)]
```

`core/` is imported by `electron/` and `src/` but imports nothing from them (enforced by ESLint `no-restricted-imports` — `eslint.config.js`). This is the single rule that keeps the framework decision reversible.

## 2. Processes & windows

| Surface | Role | Key file |
| --- | --- | --- |
| **Main process** | The privileged Node loop. Owns SQLite, the scheduler, tray, notifications, STT service, ConversationEngine, Action Dispatcher, provider registry, Gmail, and the popup/launcher coordinators. | `electron/main/index.ts` (the composition root) |
| **Main window** | The primary React UI: rail nav (Chat / Schedules / History / Settings), chat with a sessions sidebar, mic capture. | `src/app/App.tsx` |
| **Hidden audio window** | TTS playback host: OS `speechSynthesis` OR streamed OpenAI audio via Media Source Extensions. Created hidden at startup. | `src/audio-host.ts` |
| **Reminder popup window** | Frameless, always-on-top toast that is *also* a chat client. Shown inactive (never steals focus). | `src/popup/PopupApp.tsx` + `electron/main/reminder-popup.ts` |
| **Voice launcher window** | Frameless, always-on-top floating widget triggered by `Alt+Shift+Space`; a compact live chat. | `src/launcher/LauncherApp.tsx` + `electron/main/desktop-voice/controller.ts` |

All four windows are created in `electron/main/windows.ts`; the audio, popup, and launcher windows are created hidden at startup so they inherit the secured session.

### The `fanout` linchpin

The main process broadcasts conversation/action/TTS/popup events to **every** window via a `fanout()` helper (`electron/main/index.ts:84`), with a `fanoutExcept()` variant that skips the originating window to avoid double-rendering (`:92`). This is what lets the launcher, the popup, and the main chat share **one live conversation** — every consumer self-filters by `turnId` / `sessionId`.

## 3. IPC & the security boundary

```mermaid
sequenceDiagram
    participant R as Renderer sandboxed
    participant PL as Preload window.lifeos
    participant G as guard in main
    participant H as Handler + Repo/Engine
    R->>PL: ipc.createReminder(input)
    PL->>G: ipcRenderer.invoke('reminders:create', input)
    G->>G: assertSenderIsOurWindow(origin)
    G->>H: Schema.parse(raw)  (Zod .strict())
    H->>H: business rules → repo.create → broadcast
    H-->>G: value
    G-->>PL: { ok:true, data } — never throws
    PL-->>R: unwrap Result → value (or throw AppError)
```

Every invoke handler is wrapped by `guard()` (`electron/main/ipc/guard.ts`): it checks the sender origin, runs the handler, and returns a `Result<T>` envelope — handlers **never reject**, and a stack trace never crosses IPC. Input is validated with Zod `.strict()` (an unknown key is a rejection). The renderer only ever holds named bridge functions; it never sees `ipcRenderer`. See [IPC](./IPC.md) for the full contract and channel list.

**Network is default-deny.** `installSessionSecurity()` (`electron/main/session.ts`) installs a CSP response header, a request filter that cancels any outbound request not on the allowlist, and a permission handler that grants only the microphone. The allowlist is empty except `api.openai.com`, and only when a cloud capability is enabled + keyed + consented. See [PERFORMANCE §privacy](./PERFORMANCE.md) and [IPC §security](./IPC.md).

## 4. The provider-seam pattern (privacy gating)

Every cloud capability sits behind a **pure interface in `core/`** (`LlmProvider`, `SpeechProvider`, `TextToSpeechProvider`, `SearchProvider`, `TranscriptCleaner`). Concrete OpenAI implementations live in `electron/providers/`. A **registry factory** (`electron/providers/registry.ts`) returns the cloud provider **only** when that capability is enabled + keyed + consented; otherwise a local provider or `null`.

```mermaid
flowchart LR
    APP[ConversationEngine / TriggerSink / STT handler] -->|asks for a provider| REG{registry factory}
    REG -->|enabled + key + consent| CLOUD[OpenAI provider]
    REG -->|else| LOCAL[sherpa STT / Windows TTS / null LLM]
    CLOUD -.->|any failure| LOCAL
```

Factories are **re-run per turn** (live rebind), so toggling AI Assist takes effect without a restart. Web search is deliberately a *separate* seam from the LLM. See [AI_INTEGRATIONS](./AI_INTEGRATIONS.md).

## 5. Conversation turn flow

```mermaid
flowchart TB
    U[User text / transcript] --> STT[startChatTurn]
    STT --> ENG[ConversationEngine.run]
    ENG --> LR{local router?<br/>time/greeting/settings}
    LR -->|hit| DONE1[reply · no LLM]
    LR -->|miss| PROV{cloud LLM?}
    PROV -->|no| OFF[local parser · reminder or offline notice]
    PROV -->|yes| LLM[OpenAI gpt-4o-mini · strict JSON]
    LLM --> GATE[AssistantTurnSchema Gate 1]
    GATE --> BR{intent}
    BR -->|chat/question/research| ANS[reply · maybe web search]
    BR -->|reminder_create / mis-tagged| PARSE[LOCAL parseReminder]
    PARSE --> DISPATCH[Action Dispatcher → proposal card]
    DISPATCH --> CONFIRM[confirm click or voice → execute → SQLite]
    ANS --> BCAST[chat:done broadcast to all windows]
    DONE1 --> BCAST
    OFF --> BCAST
    CONFIRM --> BCAST
```

**Two invariants** the engine guarantees (`electron/conversation/conversation-engine.ts`): exactly one `chat:done` per turn (even on a throw), and **the LLM never actuates** — a reminder's fields always come from the local parser, never from raw LLM output. See [AI_INTEGRATIONS](./AI_INTEGRATIONS.md) and [REMINDER_SYSTEM](./REMINDER_SYSTEM.md).

## 6. Reminder trigger flow (reliability-ordered)

```mermaid
sequenceDiagram
    participant SCH as Scheduler 30s reconcile
    participant SINK as TriggerSink.fire
    participant N as Notification UNCONDITIONAL
    participant Hst as History UNCONDITIONAL
    participant TTS as TTS best-effort
    participant POP as Popup best-effort
    participant CH as Chat delivery best-effort
    SCH->>SINK: reminder due
    SINK->>N: notifier.show(r)
    SINK->>Hst: history.record(triggered)
    Note over SINK: notify + history come FIRST, outside any try
    SINK->>POP: pauseConversation() then enqueue(r)
    SINK->>TTS: speak (only if popup off)
    SINK->>CH: deliver into originating chat
```

The scheduler is wall-clock authoritative (a 30s reconcile query, never a far-future timer) and handles missed-while-closed reminders. See [REMINDER_SYSTEM](./REMINDER_SYSTEM.md).

## 7. Startup sequence

From `electron/main/index.ts`, `app.whenReady()`:

```mermaid
flowchart TB
    A[app.setName · AppUserModelID · single-instance lock] --> B[navigation locks + origin]
    B --> C[open + migrate SQLite · seed defaults]
    C --> D[install session security · live cloud predicate]
    D --> E[build repos · apiKeyStore · Gmail auth/repo]
    E --> F[ConfirmationStore · ActionDispatcher · ContextBuilder]
    F --> G[ConversationEngine · local router]
    G --> H[create audio + popup + launcher windows hidden]
    H --> I[TriggerSink · Scheduler · Notifier]
    I --> J[Gmail provider→sync→scheduler→delivery]
    J --> K[register IPC handlers · tray]
    K --> L[scheduler.reconcile 'startup' · 30s tick · powerMonitor]
    L --> M[create MAIN window last · close-to-tray]
```

## 8. Data model (bird's-eye)

SQLite at `%APPDATA%\LifeOS\lifeos.db`, WAL, **schema version 8**, **18 tables**. Core entities: `reminders` (+ `reminder_history`), `chat_sessions` (+ `chat_turns`), `settings`, `app_logs`, `memories` (unused), `conversations` (unused telemetry), and 10 Gmail tables (`gmail_*`, `email_ai_context`, `web_research`). Full schema in [DATABASE](./DATABASE.md).

## 9. Reliability & provider principles (summary)

- **Reliability:** in the trigger path, notification + history are unconditional and fire first; everything else is individually wrapped best-effort.
- **Provider seam:** every cloud capability is a pure interface gated by enable + key + consent; the engine degrades gracefully to local providers or `null`.
- **Actuation gate:** the LLM never writes; a reminder is created only via the local parser → Action Dispatcher → single execution layer.
- **One conversation, many windows:** `fanout`/`fanoutExcept` + self-filtering keeps the main chat, popup, and launcher in sync.

## 10. Known architectural gaps

- The **voice launcher and reminder popup are not yet in the top-level architecture diagram** in the legacy planning docs (they are here).
- The **reminder popup is not yet a subscriber** to the live cross-window turn stream (the same fanout pattern would extend it).
- **State-based navigation** (no router) in the renderer — fine for 4 screens.
- STT decode runs on the **main thread** (fast, RTF ~0.07, but a worker would isolate it).

See [ROADMAP §technical debt](./ROADMAP.md) for the full list.
