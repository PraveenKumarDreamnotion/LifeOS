# Backend (Electron Main Process)

> **Home:** [docs/README.md](./README.md) · **Related:** [ARCHITECTURE](./ARCHITECTURE.md) · [DATABASE](./DATABASE.md) · [IPC](./IPC.md) · [AI_INTEGRATIONS](./AI_INTEGRATIONS.md)

The main process is a plain Node event loop (never subject to Chromium renderer throttling — that is *the* reason a reminders app wants Electron). It owns all state and privileged operations. Everything is wired together in one composition root.

## 1. The composition root — `electron/main/index.ts`

A single ~930-line file that builds and connects every service on `app.whenReady()`. It is the map of the whole backend. Highlights, in wiring order:

1. **App identity & single instance** — `app.setName('LifeOS')`, AppUserModelID, `requestSingleInstanceLock()` (two schedulers on one WAL would double-fire).
2. **Database** — `openDatabase()` + migrate + `settings.seedDefaults()`; repos built (`ReminderRepository`, `HistoryRepository`, `SettingsRepository`, `ChatRepository`, `GmailRepository`).
3. **Security** — `installNavigationLocks()`, then `installSessionSecurity(cloudEnabled)` where `cloudEnabled` is a **live predicate** reading settings each request, so toggling AI Assist takes effect without a restart.
4. **API key store** — `ApiKeyStore` (the only place the key is encrypted/decrypted; ciphertext in `ai_key_ciphertext`).
5. **Provider config** — `providerConfig()` returns a snapshot of the settings the registry keys on, re-read per turn.
6. **Action layer** — `ConfirmationStore`, `persistReminder` (the verified writer), `ActionDispatcher`.
7. **Conversation** — `ContextBuilder`, `ConversationEngine` (with the local router, dispatcher, search provider, and all callbacks), and `startChatTurn` (the single entry point for both the main chat and the launcher).
8. **Windows** — hidden audio, reminder popup, and (if enabled) launcher windows created; `launcherApi` and `reminderPopup` coordinators built.
9. **Scheduler** — `createNotifier`, `createTriggerSink`, `createScheduler`; `ReminderExecutor` for AI-task reminders.
10. **Gmail** — provider → sync engine → sync scheduler → delivery coordinator (`EmailContextService`, `EmailResearchService`, `EmailDeliveryCoordinator`).
11. **IPC** — `registerIpcHandlers`, `registerGmailHandlers`, `registerChatHandlers`, `registerActionHandlers`, `registerLauncherHandlers`, `registerSpeechHandlers`, plus tray, audio-window channels, and the launch-at-login reconcile.
12. **Startup reconcile** — `scheduler.reconcile('startup')`, a 30s tick, and `powerMonitor` resume/unlock handlers; **main window created last** (a launch-at-login start stays in the tray).

The `fanout()` / `fanoutExcept()` helpers (broadcast to every window / every window except the originator) are defined here and are the backbone of cross-window sync.

## 2. Services by responsibility

### Conversation & intelligence
| Service | File | Role |
| --- | --- | --- |
| **ConversationEngine** | `electron/conversation/conversation-engine.ts` | Per-turn brain: local router → cloud LLM → Gate-1 validation → branch on intent → persist → broadcast. Guarantees one `chat:done` per turn and that the LLM never actuates. See [AI_INTEGRATIONS](./AI_INTEGRATIONS.md). |
| **ContextBuilder** | `electron/conversation/context-builder.ts` | Assembles the per-turn LLM input: system prompt + now/timezone + a **titles+relative-time-only** reminder summary + an (empty) `memories` slot. |
| **ChatTurnService** | `electron/main/chat/chat-turn-service.ts` | The local fallback: turns text into a reminder card or an honest offline notice when there's no LLM. |
| **local-command-router** | `electron/main/chat/local-command-router.ts` | Answers local commands (time/date/greeting/help/settings/schedules) with **no LLM**. |
| **Provider registry** | `electron/providers/registry.ts` | The factory that gates every cloud capability on enable+key+consent. |

### Actions (the actuation gate)
| Service | File | Role |
| --- | --- | --- |
| **ActionDispatcher** | `electron/actions/dispatcher.ts` | `propose` (validate + store a pending proposal) → `confirm` (execute the stored action) → `cancel`. |
| **ConfirmationStore** | `electron/actions/confirmation-store.ts` | Holds a single-use, validated proposal; 90s timeout = **cancel** (never auto-confirm). |
| **ExecutionLayer** | `electron/actions/execute.ts` | The **only** mutator; `reminder_create` reuses the same writer the direct path uses (byte-identical row). |
| **voice-confirm-matcher** | `electron/actions/voice-confirm-matcher.ts` | Deterministic yes/no/repeat matcher (runs in main, never the LLM). |
| **popup-lifecycle-matcher** | `electron/actions/popup-lifecycle-matcher.ts` | Deterministic complete/dismiss/snooze/cancel matcher for popup messages. |

### Scheduling & reminders
| Service | File | Role |
| --- | --- | --- |
| **Scheduler** | `electron/scheduler/scheduler.ts` | Wall-clock reconcile (`findDue` every 30s); missed-while-closed policy; no far-future timers. |
| **TriggerSink** | `electron/scheduler/trigger-sink.ts` | The fan-out: unconditional notify + history first, then best-effort TTS/popup/chat-delivery/execution. |
| **ReminderExecutor** | `electron/reminders/reminder-executor.ts` | Runs an AI-task reminder's intent (web search → answer) at fire time. |
| **Notifier** | `electron/notifications/notifier.ts` | Windows toast; click opens the reminder's chat via the launcher/main. |

See [REMINDER_SYSTEM](./REMINDER_SYSTEM.md).

### Voice
| Service | File | Role |
| --- | --- | --- |
| **SherpaSpeechService** | `electron/speech/sherpa-speech-service.ts` | Native offline STT (streaming Zipformer). |
| **speak coordinator** | `electron/main/tts/speak.ts` | Chooses the TTS path: streamed OpenAI audio (MSE) → bytes → Windows voice fallback. |
| **DesktopVoiceController** | `electron/main/desktop-voice/controller.ts` | The launcher lifecycle state machine. See [LAUNCHER](./LAUNCHER.md). |
| **ReminderPopup coordinator** | `electron/main/reminder-popup.ts` | Popup queue + lifecycle (electron-free, unit-tested). |

See [VOICE_PIPELINE](./VOICE_PIPELINE.md).

### Persistence & platform
| Service | File | Role |
| --- | --- | --- |
| Repositories | `electron/database/*-repository.ts` | See [DATABASE](./DATABASE.md). |
| **ApiKeyStore** / **GmailTokenStore** | `electron/services/` | DPAPI encrypt/decrypt; plaintext never crosses IPC. |
| **Logger** | `electron/services/logger.ts` | Level-gated `app_logs` with secret redaction. |
| **reset-service** / **reset-guard** | `electron/services/` | The only file allowed to import `fs`; `assertSafeResetPath` guards deletion. |
| **Tray** | `electron/tray/tray.ts` | Open / View schedules / Pause / Quit; active-count badge. |
| Gmail services | `electron/gmail/*` | OAuth, sync engine, scheduler, notifier, email context/research/delivery. See [AI_INTEGRATIONS §Gmail](./AI_INTEGRATIONS.md). |

## 3. IPC handler registration

Six handler modules under `electron/main/ipc/` register channels over `guard()`:

- `index.ts` — reminders, settings, parse, overdue, app version, reset.
- `chat.ts` — `chat:send` (routes through `startChatTurn` with the sender's webContents id as origin), cancel, session list/create/turns/rename/delete, active-session set.
- `actions.ts` — `action:confirm`/`cancel` (execute/discard the stored proposal), settle the chat turn.
- `speech.ts` — `speech:start/stop/audio`; resolves the STT provider per session (live rebind); offers the final transcript to the voice-confirm matcher; runs the optional cleanup pass.
- `launcher.ts` — the launcher control surface (returns a controller main drives).
- `gmail.ts` — connect/disconnect/test/credentials/deleteCache/status/syncNow; builds the safe `GmailStatusDto`.

Popup handlers (`popup:action`, `popup:message`) are registered inline in `index.ts` over the popup coordinator.

## 4. Cross-cutting patterns

- **Live rebind:** provider factories and settings-reading closures are re-invoked per operation, so toggling a setting takes effect without a restart.
- **Best-effort persistence:** `record` / delivery writes are wrapped so a DB write failure never breaks a live turn.
- **Single writer per entity:** the direct path and the dispatcher path call the *same* `persistReminder`, which **verifies** the row was stored + scheduled (reads it back) before anyone can claim success.
- **Broadcast-and-self-filter:** every window gets the broadcast and ignores what it didn't start.

## 5. Shutdown & timers

`stopBackgroundTimers()` clears the 30s tick and the Gmail scheduler before the DB handle closes (so a Reset that `app.exit()`s can't leave a timer ticking against a closed DB). `before-quit` destroys the tray, disposes speech, and checkpoints the WAL.
