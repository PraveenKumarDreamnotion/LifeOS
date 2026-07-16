# Product Vision

> **Home:** [docs/README.md](./README.md) · **Related:** [PROJECT_OVERVIEW](./PROJECT_OVERVIEW.md) · [FEATURE_GUIDE](./FEATURE_GUIDE.md)

## The vision

A **personal AI companion that lives on your own machine** — one you can talk to like a person, that remembers your reminders, answers your questions, watches your inbox, and never sends your life to someone else's server unless you tell it to.

Yogi is designed to be the assistant you actually trust with personal context, because the trust is structural: with no cloud key configured, LifeOS is provably offline (a default-deny network filter blocks every outbound request — `electron/main/session.ts:97-107`). When you *do* opt into cloud intelligence, it is your OpenAI key, gated per-capability, with consent recorded in the main process so the UI cannot fake it.

## Purpose & the problems it solves

| Problem | How LifeOS answers it |
| --- | --- |
| **Cloud assistants require trusting a server with everything you say.** | On-device by default: local STT model, local TTS, local SQLite, no account. |
| **Reminders that only notify are easy to miss.** | A fired reminder is *both* a Windows toast *and* a spoken line, *and* an always-on-top popup you can talk to. Notification + history are unconditional and fire first. |
| **Setting reminders in rigid apps is tedious.** | Natural language: "remind me after two minutes to call Biplab," tolerant of word order and speech-to-text errors. |
| **Assistants hallucinate live facts.** | A web-search tool layer fetches real sources for lookups (contacts, weather, prices) and answers with citations — or says honestly when it can't. |
| **Email is a firehose.** | Opt-in Gmail: each new email becomes its own chat with a spoken heads-up and grounded Q&A; important emails can auto-trigger web research. |
| **Voice assistants interrupt each other.** | A single shared audio window with pause/resume: a reminder firing mid-conversation pauses the conversation, speaks, then resumes. |

## Target users

- **Privacy-conscious individuals** who want an AI helper but not a cloud data trail.
- **Windows desktop users** who live in the tray and want reminders + a voice companion always a hotkey away.
- **People who prefer voice** — the whole product is voice-first (press `Alt+Shift+Space`, talk, get a spoken answer).
- **Users who want cloud smarts on their own terms** — bring-your-own OpenAI key, toggle each capability, disconnect anytime.

## How LifeOS differs from ChatGPT desktop

| | ChatGPT Desktop | LifeOS / Yogi |
| --- | --- | --- |
| **Data location** | Every message goes to OpenAI's servers | On-device by default; cloud only when you enable it, with *your* key |
| **Works offline** | No | Yes — reminders, time, schedules, and local commands work with zero network |
| **Reminders / scheduling** | Not a first-class feature | The reliability spine: NL parsing, a wall-clock scheduler, notifications, recurrence |
| **Acts on your machine** | No native scheduler, tray, or OS notifications | Windows tray app, native toasts, global hotkey, login-item, always-on-top popup |
| **Actuation safety** | Model output is the answer | The LLM **never actuates** — a reminder is created only when the local parser recognizes it and you confirm |
| **Account** | Requires an OpenAI account/login | None. The app has no accounts and no server |
| **Cost model** | Subscription | Free app; you pay only your own OpenAI API usage if you opt in |

## How LifeOS differs from other AI assistants (Siri / Alexa / Copilot)

- **No always-on cloud microphone.** The mic is engaged only when you press the hotkey or the mic button; STT runs locally by default.
- **Transparent capability gating.** Every cloud capability (chat, transcription, voice, search) is an independent toggle behind a pure provider seam (`electron/providers/registry.ts`). Turn one on without the others.
- **Bring-your-own-key.** No hidden backend; the app talks only to `api.openai.com`, and only when you've enabled a cloud feature.
- **Reversible & portable by design.** The valuable logic (`core/`) is pure TypeScript with zero Electron/Node imports, so the framework choice is reversible (see [TECHNOLOGY_STACK](./TECHNOLOGY_STACK.md)).

## Design principles (enforced, not aspirational)

1. **Privacy is enforced in code, not policy.** Default-deny network filter + CSP + DPAPI-encrypted keys that never cross IPC.
2. **A missed reminder is a bug; a silent reminder is still a reminder.** In the trigger path, notification + history are unconditional and fire first; TTS/audio/popup/chat-delivery are individually best-effort (`electron/scheduler/trigger-sink.ts`).
3. **The LLM proposes; the user disposes.** Every reminder passes an explicit click-or-voice confirmation, and the write path is byte-identical to the direct path.
4. **Degrade honestly.** When the cloud is off or a search fails, Yogi says so plainly rather than hanging or faking success (there is even a reliability guard that rewrites a fabricated "I set a reminder" into an honest failure — `electron/conversation/conversation-engine.ts`).
5. **Keep the core portable.** `core/` never imports Electron or Node, preserving a future Tauri/mobile port.

See [ROADMAP](./ROADMAP.md) for where the vision goes next (long-term memory, local LLM via Ollama, more tools).
