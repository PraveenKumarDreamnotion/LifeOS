# Project Overview

> **Home:** [docs/README.md](./README.md) · **Next:** [PRODUCT_VISION](./PRODUCT_VISION.md) · [ARCHITECTURE](./ARCHITECTURE.md)

## What is LifeOS?

**LifeOS** is a privacy-first desktop companion for Windows. Its assistant persona is named **Yogi**. You talk or type to Yogi in plain language; Yogi holds a real, persistent conversation — answering questions, searching the web for live facts, and creating/confirming reminders inside that same chat. Reminders fire as a Windows notification **and** a spoken line, and can be delivered into an always-on-top **reminder popup** that is itself a chat client. Yogi can also connect to Gmail and turn each new email into its own conversation with a spoken heads-up.

The defining constraint is **privacy by architecture**:

- **Everything runs on-device by default** — a local SQLite database, a local speech-to-text model (`sherpa-onnx-node`), and offline OS text-to-speech.
- **No server, no account, no sync, no telemetry.** Nothing leaves the machine unless the user explicitly enables a cloud feature.
- **Cloud intelligence (OpenAI) is opt-in, per-capability, consent-gated, and keyed to the user's own API key** — which is encrypted at rest with Windows DPAPI and never crosses the IPC boundary in readable form.
- The privacy claim is **enforced in code**: with no API key configured, a default-deny network filter blocks every outbound request (`electron/main/session.ts`).

## The product in two layers

LifeOS began as a natural-language reminder app (v1) and **pivoted to a conversation-first companion** (v2). The v1 reminder loop remains the reliability spine; v2 wraps a conversation around it.

**The reliability spine (v1 — complete, human-verified):**

```text
Voice / Text → Understanding → Confirmation → Local Scheduling → Reminder (notify + speak)
```

**The conversation built on that spine (v2 — core built & working):**

```text
Persistent chat  →  Yogi understands & replies (local rules OR OpenAI)
                 →  needs live info?  → web search → answer with sources
                 →  wants a reminder? → Action Dispatcher proposes → confirm (click OR voice) → schedule
                 →  reminder fires    → notify + speak + (optional) popup you can converse with
```

## Feature status at a glance

Legend: ✅ Done · ⚠️ Partial/MVP · ⛔ Schema-only / not built.

| Capability | Status | Notes |
| --- | --- | --- |
| Reminder MVP loop (parse → confirm → schedule → notify + speak) | ✅ | Human-verified; the reliability spine |
| Persistent conversation (ConversationEngine, chat sessions) | ✅ | Strict-JSON turns, per-session history |
| OpenAI providers (LLM / STT / TTS / Search) | ✅ | Behind pure `core/` seams, consent-gated |
| Action Dispatcher (click-or-voice confirmation) | ✅ | The only mutator; byte-identical write path |
| Reminder popup as chat client | ✅ | Always-on-top, FIFO queue, voice + text |
| Desktop voice launcher (Alt+Shift+Space) | ✅ | Floating widget, conversation continuity |
| Web search tool layer | ✅ | Reliability-hardened; honest on failure |
| Reminder-execution (AI-task reminders) | ✅ | A fired reminder can run a web search and speak the answer |
| Offline capability router (time / greeting / reminders offline) | ✅ | Works with no key at all |
| Gmail integration (5 phases: OAuth → sync → email chats → research → hardening) | ✅ / ⚠️ | Built & test-green; phases 1–2 live-verified, 3–5 verified by construction |
| Long-term memory (recall/personalization) | ⛔ | `memories` table + context slot wired, but **no extraction/recall/UI** |
| Streaming LLM replies | ⛔ | `chat:delta` channel reserved; replies arrive whole |
| Non-OpenAI LLMs (Ollama / Anthropic / Gemini) | ⛔ | In the type union; only OpenAI implemented |
| Edit-reminder UI | ⚠️ | `update` IPC/repo exist; no edit form (delete + recreate) |
| Monthly recurrence | ⛔ | Only `FREQ=DAILY` / `FREQ=WEEKLY` |

See [ROADMAP](./ROADMAP.md) and [FEATURE_GUIDE](./FEATURE_GUIDE.md) for the full breakdown.

## Build & scale facts (verified from source)

| Fact | Value | Source |
| --- | --- | --- |
| Version | `0.1.0` | `package.json:3` |
| Electron | `43.1.0` (Chromium 150, Node 24) | `package.json:32` |
| UI | React 19 + TypeScript, built with electron-vite (Vite 6) | `package.json` |
| Database | `node:sqlite` (built into Electron), WAL, **schema `user_version` 8** | `electron/database/migrations.ts` |
| Tables | **18** across migrations M001–M008 | `electron/database/migrations.ts` |
| Settings keys | **50** | `electron/database/settings-repository.ts:6-86` |
| IPC channels | **62** in `CH` + ~11 inlined audio channels | `core/types/channels.ts` |
| Automated tests | **523 tests across 55 files** (40 unit + 14 integration + 1 renderer) | `tests/` |
| Runtime deps | `chrono-node`, `luxon`, `sherpa-onnx-node`, `zod` (only 4) | `package.json:44-49` |

> **Note on the status doc:** The dated changelog in [`current-project-status.md`](./lifeos-planning/current-project-status.md) is authoritative and current; some of its *summary tables* had drifted (e.g. "schema version 4", "34 settings keys", "252 tests"). This documentation set uses the source-verified figures above. See the [documentation-audit note](./lifeos-planning/current-project-status.md#documentation-audit-2026-07-15).

## Where things live (one-liner)

- **`core/`** — pure TypeScript: parser, recurrence math, provider seams, turn schema, system prompt, types. No Electron/Node imports (ESLint-enforced). This is the portable, most-tested layer.
- **`electron/`** — the Node main process: SQLite, scheduler, tray, notifications, STT service, ConversationEngine, Action Dispatcher, provider registry, Gmail, preload bridges.
- **`src/`** — the React renderer(s): main window, reminder popup, voice launcher, and the hidden audio host.

See [PROJECT_STRUCTURE](./PROJECT_STRUCTURE.md) for the full tree.
