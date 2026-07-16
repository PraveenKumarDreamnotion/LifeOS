# Feature Guide

> **Home:** [docs/README.md](./README.md) · **Related:** [USER_FLOWS](./USER_FLOWS.md) · [ROADMAP](./ROADMAP.md)

One section per feature: what it is, the experience, how it works, files, status. `[Screenshot placeholder]` marks where a UI capture would go. Status legend: ✅ Done · ⚠️ Partial · ⛔ Planned/schema-only.

---

## Voice conversation ✅

- **Purpose:** talk to Yogi hands-free; get a spoken answer.
- **UX:** press the mic (or `Alt+Shift+Space`); live voice bars while listening; a thinking/searching indicator; a spoken reply with a Stop-speaking button. `[Screenshot placeholder: chat with mic active]`
- **How:** `useSpeech` (mic → worklet → PCM) → `speech:*` IPC → STT provider → `ConversationEngine` → `onSpeak` → audio window. Mic interrupts speech.
- **Files:** `src/hooks/useSpeech.ts`, `electron/main/ipc/speech.ts`, `electron/conversation/conversation-engine.ts`, `src/audio-host.ts`.
- **Docs:** [VOICE_PIPELINE](./VOICE_PIPELINE.md).

## Natural-language reminders ✅

- **Purpose:** set reminders by talking/typing plainly.
- **UX:** "remind me after two minutes to call Biplab" → a confirmation card (title, absolute + live relative time, recurrence) → confirm by click or "yes". `[Screenshot placeholder: proposal card]`
- **How:** local `parseReminder` (STT-tolerant) → Action Dispatcher → verified write. The LLM never creates the reminder.
- **Files:** `core/parsing/*`, `electron/actions/*`.
- **Docs:** [REMINDER_SYSTEM](./REMINDER_SYSTEM.md).

## Reminder confirmation (click or voice) ✅

- **Purpose:** never persist a reminder without explicit consent.
- **UX:** a card with Confirm / Cancel; or say "yes"/"no"; 90s no-answer = cancel.
- **How:** `ConfirmationStore` (single-use, timeout=cancel) + `voice-confirm-matcher` (deterministic, in main).
- **Files:** `electron/actions/confirmation-store.ts`, `dispatcher.ts`, `voice-confirm-matcher.ts`.

## Reminder scheduling ✅

- **Purpose:** fire reliably even after sleep/restart/close.
- **UX:** invisible; reminders just fire on time, and missed-while-closed ones are handled honestly.
- **How:** wall-clock 30s reconcile on `next_fire_at`; `powerMonitor` resume; overdue policy (one-time → missed + OverdueModal; recurring → rolled forward).
- **Files:** `electron/scheduler/scheduler.ts`.

## Reminder firing & popup ✅

- **Purpose:** a reminder you can't miss and can act on by voice.
- **UX:** a Windows toast **and** a spoken line **and** an always-on-top popup (bottom-right, never steals focus) that is a chat client — Complete/Snooze/Dismiss by button or by talking, "+N more" queue. `[Screenshot placeholder: reminder popup]`
- **How:** `TriggerSink` (notify+history unconditional, then best-effort) → `reminder-popup` coordinator (FIFO queue, lifecycle matcher).
- **Files:** `electron/scheduler/trigger-sink.ts`, `electron/main/reminder-popup.ts`, `src/popup/PopupApp.tsx`.

## AI-task reminders (reminder-execution) ✅

- **Purpose:** a reminder that *does* something ("remind me tomorrow to tell me NIT Hamirpur's contact").
- **UX:** at fire time Yogi speaks/delivers the *answer* (a web lookup), not the title.
- **How:** `classify-execution` at creation → `ReminderExecutor` runs the search at fire time (bounded, honest on failure). Read-only auto-runs (consented at creation); writes would need confirmation (none emitted yet).
- **Files:** `core/parsing/classify-execution.ts`, `electron/reminders/reminder-executor.ts`.
- **Docs:** [REMINDER_SYSTEM §9](./REMINDER_SYSTEM.md).

## Chat with persistent sessions ✅

- **Purpose:** resumable, faithful conversation history.
- **UX:** a sessions sidebar (auto-titled, deletable); reopening a chat re-renders exactly what was shown, including settled reminder cards. `[Screenshot placeholder: chat sidebar]`
- **How:** `chat_sessions` + `chat_turns` (the faithful render source; `id == turnId`); `useSessions` + `useConversation`.
- **Files:** `src/features/chat/*`, `electron/database/chat-repository.ts`.
- **Docs:** [FRONTEND §chat](./FRONTEND.md).

## Desktop voice launcher ✅

- **Purpose:** talk to Yogi from anywhere via a hotkey.
- **UX:** `Alt+Shift+Space` → a floating widget slides in bottom-right, listens, answers; a chat switcher; stays in sync with the main window. `[Screenshot placeholder: launcher]`
- **How:** `DesktopVoiceController` state machine + shared active-session pointer + `fanoutExcept` sync.
- **Files:** `electron/main/desktop-voice/controller.ts`, `src/launcher/*`.
- **Docs:** [LAUNCHER](./LAUNCHER.md).

## Web search ✅

- **Purpose:** answer live-fact questions with sources.
- **UX:** "🔎 Searching the web…" then an answer + Sources; honest on failure.
- **How:** `research`/flag/reply-heuristic → `SearchProvider` (OpenAI search model) → citations.
- **Files:** `electron/providers/openai-search-provider.ts`, engine `wantsSearch`.
- **Docs:** [WEB_SEARCH](./WEB_SEARCH.md).

## Voice output (TTS) ✅

- **Purpose:** hear Yogi speak.
- **UX:** 6 voice personalities + speed; Preview; streamed OpenAI audio or offline Windows voices.
- **How:** `speak.ts` coordinator (stream via MSE → bytes → Windows fallback); `audio-host.ts`.
- **Files:** `electron/main/tts/speak.ts`, `core/tts/voice-catalog.ts`, `src/audio-host.ts`.

## Speech recognition (STT) ✅

- **Purpose:** turn speech into text, offline by default.
- **UX:** live partials (sherpa) or a "Transcribing…" spinner (OpenAI batch).
- **How:** local sherpa streaming Zipformer, or opt-in OpenAI transcribe behind `withFallback(sherpa)`.
- **Files:** `electron/speech/sherpa-speech-service.ts`, `electron/providers/*speech-provider.ts`.

## Offline capability router ✅

- **Purpose:** useful with no key at all.
- **UX:** time/date/greeting/help/settings/schedules and reminders all work offline; genuine reasoning gets an honest notice.
- **How:** `classifyLocalIntent` (confidence-scored) → `local-command-router` (no LLM).
- **Files:** `core/routing/local-intent.ts`, `electron/main/chat/local-command-router.ts`.

## Gmail integration ✅/⚠️

- **Purpose:** turn each new email into a conversation.
- **UX:** connect via Google OAuth; new mail → a spoken heads-up + its own chat + grounded Q&A; important mail can auto-research. `[Screenshot placeholder: email chat]`
- **How:** loopback+PKCE OAuth, `historyId` incremental sync, delivery coordinator, gated summaries/research.
- **Status:** all 5 phases built & test-green; phases 1–2 live-verified, 3–5 verified by construction. Semantic mailbox search deferred.
- **Files:** `electron/gmail/*`, `core/gmail/*`.
- **Docs:** [AI_INTEGRATIONS §Gmail](./AI_INTEGRATIONS.md), `docs/lifeos-planning/gmail-integration.md`.

## Conversation history & context ✅

- **Purpose:** Yogi remembers the current conversation.
- **How:** a bounded 12-turn window from `chat_turns` fed to the LLM; delivery turns project assistant-only.
- **Files:** `electron/conversation/context-builder.ts`.
- **Note:** this is *per-conversation* memory. **Cross-conversation long-term memory is ⛔ not built** — see [MEMORY](./MEMORY.md).

## Notifications ✅

- **Purpose:** OS-level reminder alerts.
- **How:** main-process `Notification`; click opens the reminder's chat; fires while in the tray.
- **Files:** `electron/notifications/notifier.ts`.

## Pause / resume conversation (interruption) ✅

- **Purpose:** a reminder firing mid-conversation shouldn't clobber it.
- **How:** `pauseForReminder` → hide launcher + snapshot; `resumeAfterReminder` → re-open, re-read the interrupted reply, resume listening.
- **Files:** `electron/main/desktop-voice/controller.ts`.
- **Docs:** [LAUNCHER §6](./LAUNCHER.md).

## Settings ✅

- **Purpose:** control privacy, cloud, voice, Gmail, theme, startup.
- **How:** 50 keys, consent-gated, DPAPI-encrypted secrets, live-rebind.
- **Docs:** [SETTINGS](./SETTINGS.md).

## Onboarding · History · Schedules · Tray · Theme · Reset ✅

Standard app surfaces, all present and working. See [FRONTEND](./FRONTEND.md) and [USER_FLOWS](./USER_FLOWS.md).

---

## Partial / planned features

| Feature | Status | Note |
| --- | --- | --- |
| Edit-reminder UI | ⚠️ | `update` IPC/repo exist; no form — delete + recreate |
| Long-term memory (recall/personalization) | ⛔ | Table + context slot wired; no extraction/recall/UI — [MEMORY](./MEMORY.md) |
| Streaming LLM replies | ⛔ | `chat:delta` reserved; replies arrive whole |
| Non-OpenAI LLMs (Ollama/Anthropic/Gemini) | ⛔ | In the type union; only OpenAI |
| Action intents beyond reminders (`memory_*`, `settings`, update/delete) | ⛔ | Classified, no executor |
| Monthly recurrence | ⛔ | RRULE stored; needs `FREQ=MONTHLY` |
| "Sing" reminder | ⛔ | Parser + sink branch exist; no bundled MP3 |
| Semantic mailbox search | ⛔ | `email_embeddings` deferred |
| `LegacyChatScreen` | ⚠️ | Retained behind `conversation_ui_enabled` (a fork to retire) |

See [ROADMAP](./ROADMAP.md).
