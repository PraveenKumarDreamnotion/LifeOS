# Glossary

> **Home:** [docs/README.md](./README.md)

Terms, acronyms, and internal names used across LifeOS. Alphabetical.

| Term | Meaning |
| --- | --- |
| **Action Dispatcher** | The central gate every proposed action flows through: `propose` (validate + store) → `confirm` (execute the stored action) → `cancel`. `electron/actions/dispatcher.ts`. |
| **AI-task reminder** | A reminder whose title is a lookup; at fire time the `ReminderExecutor` runs a web search and speaks/delivers the answer instead of the title. See [REMINDER_SYSTEM](./REMINDER_SYSTEM.md). |
| **AppUserModelID** | The Windows app-model id (`com.dreamnotion.lifeos`) that drives notification grouping/title. |
| **AssistantTurn** | The single strict-JSON object the LLM returns; used both as the OpenAI Structured-Outputs schema and the Zod validator. `core/conversation/turn-schema.ts`. |
| **audio window** | A hidden renderer that hosts TTS playback (`speechSynthesis` + `<audio>`/MSE). `src/audio-host.ts`. |
| **`CH`** | The channel-constant map (62 entries) in `core/types/channels.ts`; dependency-free so the sandboxed preload can import it. |
| **`chat:done`** | The broadcast that carries a completed turn's result; exactly one fires per turn. |
| **`chat_turns`** | The **faithful render source** — one row per turn, `id == turnId`, `assistant_text` = what was shown. Distinct from the unused `conversations` telemetry table. |
| **ConfirmationStore** | Holds a single-use, validated proposal; a 90 s timeout counts as **cancel** (never auto-confirm). |
| **ContextBuilder** | Assembles the per-turn LLM input (system prompt + now/timezone + a titles+relative-time reminder summary + an empty `memories` slot). |
| **ConversationEngine** | The per-turn brain in main: route → LLM → Gate-1 → branch → persist → broadcast. Guarantees one `chat:done`/turn and that the LLM never actuates. |
| **core/** | The pure-TypeScript layer (no Electron/Node imports, ESLint-enforced); the portable, most-tested code. |
| **DPAPI** | Windows Data Protection API — what Electron `safeStorage` uses to encrypt the OpenAI key + Gmail tokens/secret at rest. |
| **DesktopVoiceController** | The voice launcher's lifecycle state machine. `electron/main/desktop-voice/controller.ts`. |
| **`fanout` / `fanoutExcept`** | Broadcast a channel to every window / every window except the originator — the cross-window sync backbone. |
| **Gate 1 / Gate 2** | Gate 1 = the `AssistantTurnSchema` shape validation; Gate 2 = the reminder business-rule check (no past time, ≤2 years, no sing+recurring). |
| **`guard()`** | The IPC handler wrapper: origin check → run → `Result<T>` envelope; handlers never throw across IPC. `electron/main/ipc/guard.ts`. |
| **`historyId`** | Gmail's incremental-sync checkpoint cursor; the sync engine advances it only after a batch persists (crash-safe). |
| **intent** | The turn classification from a closed taxonomy (`chat`/`question`/`research`/`reminder_create`/…). `core/conversation/intent.ts`. |
| **launcher** | The frameless floating voice widget summoned by `Alt+Shift+Space`. See [LAUNCHER](./LAUNCHER.md). |
| **LegacyChatScreen** | The pre-conversation single-shot parse→card screen, retained behind the `conversation_ui_enabled` flag. |
| **live rebind** | Provider factories / settings-reading closures re-run per operation, so toggling a setting takes effect without a restart. |
| **local-command-router** | Answers time/date/greeting/help/settings/schedules with **no LLM**; runs first in the engine. `electron/main/chat/local-command-router.ts`. |
| **MSE** | Media Source Extensions — used to stream OpenAI TTS audio to the audio window so playback starts on the first bytes. |
| **`next_fire_at`** | The epoch-ms the scheduler compares against (vs `scheduled_at`, the original intent). |
| **normalize-reminder** | STT-tolerant normalization that fixes a mis-heard reminder cue ("remained me" → "remind me"). |
| **offline capability router** | The confidence-scored local classifier (`core/routing/local-intent.ts`) + the command router that make the app useful with no key. |
| **PKCE** | Proof Key for Code Exchange — the OAuth extension used (with loopback) for Gmail connect. |
| **preload** | The sandboxed bridge script exposing a frozen `window.lifeos*` object; each is bundled to one CJS file (no shared chunk). |
| **provider seam** | A pure `core/` interface (`LlmProvider`, `SpeechProvider`, `TextToSpeechProvider`, `SearchProvider`, `TranscriptCleaner`) behind which a concrete backend is chosen by the registry. |
| **reconcile** | The scheduler's wall-clock pass that queries `findDue(now)` and fires/rolls-forward due reminders (causes: startup/tick/resume/unlock/mutation). |
| **reminder popup** | The always-on-top toast that is also a chat client; the primary fired-reminder surface. `electron/main/reminder-popup.ts`. |
| **`Result<T>`** | The IPC envelope `{ ok:true, data } | { ok:false, error }`; unwrapped renderer-side into a value or a thrown `AppError`. |
| **RRULE** | The recurrence rule string (`FREQ=DAILY`/`WEEKLY` only) stored on a reminder. |
| **safeStorage** | Electron's OS-backed encryption API (DPAPI on Windows). |
| **sherpa** | `sherpa-onnx-node` — the local streaming STT engine (Zipformer, ~68 MB int8); the default STT. |
| **shared active-session pointer** | `activeSessionId` in main — the single source of truth for which conversation the launcher continues. |
| **spine** | The v1 reminder loop (parse → confirm → schedule → notify+speak), the reliability core the v2 conversation wraps. |
| **STT / TTS** | Speech-to-text / text-to-speech. |
| **`supportsPartials`** | Returned by `speech:start`; true for streaming STT (live ticks), false for batch (a "Transcribing…" spinner). |
| **`tts:speaking`** | The broadcast (from the audio window's `audio:playing`) that drives the Stop-speaking button and gates email TTS. |
| **TriggerSink** | The reminder fan-out: unconditional notify+history first, then best-effort TTS/popup/chat-delivery/execution. |
| **turnId** | A per-turn UUID; the `chat_turns` row id, the key every window self-filters broadcasts by. |
| **`user_version`** | SQLite's migration version pragma; currently **8** (M001–M008). |
| **VAD** | Voice Activity Detection (`core/speech/vad.ts`); the pipeline currently uses energy-gated endpointing in `useSpeech`. |
| **wall-clock authoritative** | The scheduler trusts the persisted `next_fire_at`, not timers — avoiding the ~24.8-day `setTimeout` trap and surviving sleep. |
| **`withFallback`** | Wraps a cloud STT provider so any init/start/stop failure transparently swaps to sherpa. |
| **Yogi** | The assistant persona; **LifeOS** is the app. |

## Abbreviations seen in code comments

The planning docs and code comments reference numbered specs (e.g. `08 §10`, `31 §3`, `EP-5`, `55 §7`, `57`, `M006`). These map to files in `docs/lifeos-planning/` (numbered design docs) and migration/phase ids. `EP-n` = an execution-plan phase; `M0nn` = a database migration; `Dn` = a decision from the architecture audit.
