# LifeOS / Yogi — Documentation

> **Yogi** is the assistant; **LifeOS** is the app. A privacy-first, conversation-first AI companion for Windows. Everything runs on-device by default; cloud intelligence (OpenAI) is strictly opt-in, per-capability, and keyed to the user's own API key.

This folder is the **engineering documentation site**. It is written against the actual source tree (verified file-by-file, not assumed) as of **2026-07-15**. Where a feature is incomplete it is marked **Planned**, **Partial**, **MVP**, or **Schema-only** — never presented as if it exists.

For the running engineering changelog and status snapshot, see [`lifeos-planning/current-project-status.md`](./lifeos-planning/current-project-status.md). For the original design/decision records, see the [`lifeos-planning/`](./lifeos-planning) folder (60+ numbered docs).

---

## How to read these docs

**New engineer, start here:** [PROJECT_OVERVIEW](./PROJECT_OVERVIEW.md) → [ARCHITECTURE](./ARCHITECTURE.md) → [PROJECT_STRUCTURE](./PROJECT_STRUCTURE.md) → [DEVELOPMENT_GUIDE](./DEVELOPMENT_GUIDE.md).

**Want the product story:** [PRODUCT_VISION](./PRODUCT_VISION.md) → [FEATURE_GUIDE](./FEATURE_GUIDE.md) → [USER_FLOWS](./USER_FLOWS.md).

**Debugging a subsystem:** jump straight to its page below.

---

## Index

| Doc | What it covers |
| --- | --- |
| [PROJECT_OVERVIEW](./PROJECT_OVERVIEW.md) | What LifeOS is, the two-layer product (reminder spine + conversation), current status at a glance |
| [PRODUCT_VISION](./PRODUCT_VISION.md) | Vision, target users, problems solved, how it differs from ChatGPT desktop & other assistants |
| [ARCHITECTURE](./ARCHITECTURE.md) | High-level architecture, processes/windows, IPC flow, provider seams, reliability principles (Mermaid) |
| [PROJECT_STRUCTURE](./PROJECT_STRUCTURE.md) | Every major folder (`core/`, `electron/`, `src/`), responsibilities, key files |
| [TECHNOLOGY_STACK](./TECHNOLOGY_STACK.md) | Every technology with version, purpose, why chosen, alternative considered |
| [FRONTEND](./FRONTEND.md) | React renderer: screens, components, hooks, state, styling, theming, the 4 windows |
| [BACKEND](./BACKEND.md) | Electron main process: composition root, services, schedulers, engines, repositories |
| [DATABASE](./DATABASE.md) | SQLite schema, all 18 tables, migrations, repositories, the driver abstraction |
| [IPC](./IPC.md) | Preload bridges, the `guard()` contract, the full channel inventory, security boundary |
| [VOICE_PIPELINE](./VOICE_PIPELINE.md) | Mic capture → STT → intent → AI → TTS, providers, interruption, the audio window |
| [AI_INTEGRATIONS](./AI_INTEGRATIONS.md) | OpenAI LLM/STT/TTS/Search, the ConversationEngine, prompts, structured outputs, fallbacks |
| [REMINDER_SYSTEM](./REMINDER_SYSTEM.md) | NL parser, scheduler, trigger fan-out, popup, reminder-execution (AI tasks) |
| [LAUNCHER](./LAUNCHER.md) | The desktop voice launcher: hotkey, lifecycle state machine, continuity, chat switcher |
| [SETTINGS](./SETTINGS.md) | All 50 settings keys, defaults, feature flags, consent gating, the Settings UI |
| [WEB_SEARCH](./WEB_SEARCH.md) | The web-search tool layer, triggering heuristics, the search provider seam |
| [MEMORY](./MEMORY.md) | Long-term memory: schema-only today, what is wired vs. not built (**Planned**) |
| [USER_FLOWS](./USER_FLOWS.md) | End-to-end journeys: launch, conversation, reminder, launcher, email (Mermaid) |
| [FEATURE_GUIDE](./FEATURE_GUIDE.md) | One section per feature: purpose, UX, flow, files, status |
| [LIVE_DEMO](./LIVE_DEMO.md) | Install, configure, API keys, run, example commands, expected results |
| [TESTING](./TESTING.md) | The 523-test suite: unit/integration/renderer, what's covered, what needs a real machine |
| [DEVELOPMENT_GUIDE](./DEVELOPMENT_GUIDE.md) | Install, build, debug, conventions, adding features/IPC/DB/AI, packaging, release |
| [PERFORMANCE](./PERFORMANCE.md) | Latency budgets, offline performance, memory, reliability & privacy properties |
| [ROADMAP](./ROADMAP.md) | Implemented / partial / planned features, recommended order, future vision |
| [TROUBLESHOOTING](./TROUBLESHOOTING.md) | Common problems (dev vs packaged, STT quality, TTS audibility, Gmail 403) and fixes |
| [GLOSSARY](./GLOSSARY.md) | Every term, acronym, and internal name used across the codebase |

---

## Documentation conventions

- **Status legend:** ✅ Done · ⚠️ Partial/MVP · ⛔ Not started / schema-only · 🔒 Privacy-relevant.
- **Source references** use `path:line` (e.g. `electron/main/index.ts:518`) and are clickable in most editors.
- A flow or fact is documented **once** in its home page and cross-linked elsewhere, not restated.
- Concrete figures (schema version, table/test counts, settings keys) were re-verified from source; see the [discrepancies note in the status doc](./lifeos-planning/current-project-status.md#documentation-audit-2026-07-15).
