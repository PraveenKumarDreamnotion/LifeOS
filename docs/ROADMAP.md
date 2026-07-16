# Roadmap & Status

> **Home:** [docs/README.md](./README.md) · **Related:** [FEATURE_GUIDE](./FEATURE_GUIDE.md) · [MEMORY](./MEMORY.md)

The single source of the running changelog is [`lifeos-planning/current-project-status.md`](./lifeos-planning/current-project-status.md). This page is the distilled status + forward plan.

## 1. Fully implemented ✅

- **Reminder MVP loop** — NL parser (56 fixtures), ambiguity/clarification, click-or-voice confirmation, wall-clock scheduler, notifications, offline STT/TTS, recurrence (daily/weekly), overdue catch-up, history, pause/resume, tray, onboarding, theming, guarded reset. *Human-verified.*
- **Conversation-first pivot** — persistent chat sessions, `ConversationEngine` (strict-JSON turns, one-`chat:done`-per-turn, LLM-never-actuates), OpenAI providers (LLM/STT/TTS/Search) behind pure seams, Action Dispatcher (byte-identical write path), voice confirmation, reminder popup as a chat client, streamed TTS, the web-search tool layer.
- **Reminder-execution** — AI-task reminders that run a web search and speak/deliver the answer at fire time.
- **Offline capability router** — time/date/greeting/help/settings/schedules + multi-turn reminders work with no key; honest notice for genuine reasoning.
- **Desktop voice launcher** — global hotkey, lifecycle state machine, conversation continuity, real-time cross-window sync, chat switcher, reminder pause/resume.
- **Gmail integration (5 phases)** — OAuth (loopback+PKCE, `gmail.readonly`), `historyId` incremental sync + notifications, conversational email delivery, opt-in web research, hardening. Phases 1–2 live-verified; 3–5 test-green (verified by construction).

## 2. Partial ⚠️

| Item | State |
| --- | --- |
| **Edit-reminder UI** | `update` IPC + repo exist; no edit form (delete + recreate) |
| **`LegacyChatScreen`** | The pre-conversation single-shot screen, retained behind `conversation_ui_enabled` — a maintenance fork to retire |
| **Packaging** | v1 (0.1.0) was packaged (NSIS + portable); the **v2 surface has not been re-packaged or fresh-VM QA'd** |
| **Gmail live-drive** | Phases 3–5 verified by construction; a real inbound email + display is the remaining check |

## 3. Planned / not built ⛔

| Item | Note |
| --- | --- |
| **Long-term memory (recall/personalization)** | Table + context slot wired; **no extraction/recall/UI** — the biggest gap between "chatbot" and "companion". See [MEMORY](./MEMORY.md) |
| **Streaming LLM replies** | `chat:delta` channel + `LlmProvider.stream?` reserved; replies arrive whole |
| **Non-OpenAI LLMs** | Ollama/Anthropic/Gemini in the `LlmProviderId` union; only OpenAI implemented |
| **Executors for other action intents** | `research` executes (search); `memory_*`, `settings`, `reminder_update/delete` are classified but have no executor |
| **Monthly recurrence** | RRULE stored; needs `FREQ=MONTHLY` |
| **"Sing" reminder** | Parser + sink branch exist; no bundled MP3 (deferred) |
| **Semantic mailbox search** | `email_embeddings` deferred to a separate effort |
| **Auto-update** | `electron-updater` not wired (`latest.yml` produced) |
| **Import/export local data (JSON)** | Backup + prerequisite for any future sync |
| **`conversations` telemetry table** | Created (M002), unwritten |

## 4. Architecture observations

- **Clean seams pay off**: the provider registry + `core/` purity mean a local LLM, a second search tool, or a new STT backend is a registry entry, not a rewrite. Two STT seams (`whisper-cpp`, `deepgram`) already exist as optional entries.
- **The actuation gate is the safety spine**: LLM proposes → local parser produces fields → dispatcher stores → single execution layer writes + verifies. Worth preserving for every new action.
- **Cross-window sync is one mechanism** (`fanout`/`fanoutExcept` + self-filter). The reminder popup is *not yet* a subscriber to the live turn stream — the same pattern would extend it.
- **State-based navigation** (no router) is fine for 4 screens.

## 5. Technical debt

- **No shared `.btn` primitive** — button styles duplicated across selector groups (main + popup).
- **`LegacyChatScreen` fork** duplicates card logic.
- **Popup snooze menu** lacks arrow-key nav / click-outside-to-close.
- **STT decode on the main thread** (a worker would isolate it).
- **No log-retention job** and no in-app log viewer.
- **The "no preload chunks" invariant has no automated gate** — it's a manual `out/preload/chunks`-absent check + the Rollup output config. Add a build assertion.
- **No Prettier config** — formatting is ESLint-only.
- Some **status-doc summary tables had drifted** from source (schema version, key count, test count) — corrected in this doc set; keep the changelog authoritative.

## 6. Recommended development order

Optimizing **stability → intelligence → UX → maintainability**, privacy held constant:

1. **Long-term memory spine** — extraction + recall on the wired `memories` table and `ContextBuilder` slot. Highest leverage toward "companion." ([MEMORY](./MEMORY.md))
2. **Prove the packaged v2** — re-package (NSIS + portable), fresh-VM QA (no-admin, no-network-with-cloud-off, model-from-resources, 10-min idle TTS).
3. **Close intelligence UX gaps** — streaming LLM replies, inline cloud-error recovery, an edit-reminder form.
4. **Extend the capability layer** — a second tool (weather via Open-Meteo, or calendar) behind the seam, with a heuristic backstop + logging.
5. **Repay debt** — shared button primitive, retire `LegacyChatScreen`, a log-retention job, a preload-chunk build assertion, more renderer/E2E tests.
6. **Breadth** — monthly recurrence, sing MP3, auto-update, import/export, deeper accessibility.

## 7. Future vision

- **Local LLM (Ollama)** behind the `LlmProvider` seam — intelligence with zero network/cost, collapsing the consent apparatus.
- **Personal knowledge graph** on the memory system (SQLite FTS first, embeddings only if needed).
- **More tools** — weather, maps, opt-in Calendar, each disclosed behind the capability layer.
- **Optional E2EE cloud sync + multi-device** — the decision that ends "no server."
- **macOS / Linux ports** — `core/` is already pure TS; only `electron/` would be rewritten.

## 8. Biggest residual risks

1. **Packaged-v2 behavior** — the large v2 surface has never been exercised from a clean install.
2. **Small-model inconsistency** — `gpt-4o-mini` can misclassify (mitigated by heuristic backstops + honest failure copy; apply the same pattern to any new tool).
3. **Cloud dependency for the richest experience** — a local LLM would remove it.
4. **Unsigned installer → SmartScreen** — availability, not security.
