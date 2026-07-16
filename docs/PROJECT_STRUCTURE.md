# Project Structure

> **Home:** [docs/README.md](./README.md) · **Related:** [ARCHITECTURE](./ARCHITECTURE.md) · [BACKEND](./BACKEND.md) · [FRONTEND](./FRONTEND.md)

The repository has three code layers (`core/`, `electron/`, `src/`) plus tests, docs, resources, and build scripts. The golden rule: **`core/` imports nothing from `electron/` or `src/` or Node** (ESLint-enforced), which keeps it portable and unit-testable without an Electron harness.

## Top-level tree

```text
lifeos/
├── core/               Pure TypeScript — no Electron, no Node imports (ESLint-walled)
├── electron/           Main process + preload (Node, privileged)
├── src/                React renderers (4 windows) + hidden audio host
├── tests/              Vitest: unit/ · integration/ · renderer/ · fixtures/
├── docs/               This documentation site + lifeos-planning/ (design records)
├── scripts/            fetch-stt-model.mjs · gen-icons.mjs
├── public/worklets/    pcm16-downsampler.js (AudioWorklet, must stay a fetchable file)
├── resources/models/   STT model + tokens + LICENSE (bundled as extraResources)
├── package.json        Deps, scripts
├── electron.vite.config.ts   3 build targets (main/preload/renderer)
├── vitest.config.ts    Test runner config (node + jsdom for renderer)
├── eslint.config.js    Flat config incl. core/ purity + reset fs allowlist
├── electron-builder.yml NSIS + portable Windows packaging
└── tsconfig*.json      Solution file → tsconfig.node.json + tsconfig.web.json
```

## `core/` — pure logic (portable)

```text
core/
├── parsing/        detect-intent · extract-recurrence · extract-title · detect-ambiguity ·
│                   score-confidence · clarification · normalize-reminder · parse-reminder ·
│                   classify-execution · daypart · types
├── scheduling/     rrule (build RRULE strings) · next-occurrence (Luxon, DST-correct)
├── time/           format (absolute/relative time formatting)
├── conversation/   system-prompt · turn-schema (AssistantTurn + JSON schema) · intent (taxonomy)
├── routing/        local-intent (offline capability classifier, confidence-scored)
├── llm/            llm-provider (LlmProvider seam)
├── speech/         speech-provider · transcript-cleanup · vad
├── tts/            tts-provider · voice-catalog (6 voices) · reminder-speech
├── search/         search-provider (SearchProvider seam)
├── actions/        action (ActionEnvelope, Proposal, DispatchResult)
├── settings/       typed-settings (coercion helpers + toSettingsDto)
├── gmail/          oauth (PKCE) · types · mail-provider (seam) · summary
└── types/          channels (CH map) · ipc (Zod schemas + DTOs) · reminder · chat ·
                    reminder-execution · popup · desktop-voice
```

**Why it matters:** every function here is a deterministic, DOM-free unit. `parseReminder` (`core/parsing/parse-reminder.ts`) is the single most-tested component (56 fixtures). See [REMINDER_SYSTEM](./REMINDER_SYSTEM.md), [AI_INTEGRATIONS](./AI_INTEGRATIONS.md).

## `electron/` — main process (privileged)

```text
electron/
├── main/
│   ├── index.ts            THE COMPOSITION ROOT — wires every service together
│   ├── windows.ts          Create/position the 4 BrowserWindows
│   ├── session.ts          CSP · default-deny network filter · navigation locks
│   ├── lifecycle.ts        Tray-notice-once
│   ├── paths.ts            Path helpers
│   ├── ipc/                guard · index · chat · actions · speech · launcher · gmail
│   ├── chat/               chat-turn-service (local fallback) · local-command-router
│   ├── tts/                speak (the TTS coordinator: stream vs bytes vs Windows)
│   ├── reminder-popup.ts   Popup queue/lifecycle state machine (electron-free, unit-tested)
│   └── desktop-voice/      controller.ts (launcher lifecycle state machine)
├── conversation/           conversation-engine · context-builder
├── actions/                dispatcher · confirmation-store · execute (sole mutator) ·
│                           voice-confirm-matcher · popup-lifecycle-matcher
├── providers/              registry (factory) + OpenAI llm/tts/speech/search/transcript-cleaner
│                           + offline sherpa-speech-provider · web-speech-tts-provider
│                           + deepgram-speech-provider · whisper-cpp-speech-provider
├── database/               driver · drivers/node-sqlite-driver · open · migrate · migrations ·
│                           rows · reminder/history/settings/chat/conversation/gmail repositories
├── gmail/                  gmail-auth · gmail-provider · sync-engine · gmail-sync-scheduler ·
│                           gmail-notifier · email-context-service · email-research-service ·
│                           email-delivery
├── scheduler/              scheduler (wall-clock reconcile) · trigger-sink (fan-out)
├── reminders/              reminder-executor (AI-task reminders)
├── notifications/          notifier (Windows toast)
├── speech/                 sherpa-speech-service (native STT)
├── services/               api-key-store · gmail-token-store · logger · validate-openai-key ·
│                           reset-service · reset-guard
├── tray/                   tray
└── preload/                index (window.lifeos) · popup · launcher · audio
```

Entry point: `electron/main/index.ts`. Read [BACKEND](./BACKEND.md) for what each service does.

## `src/` — React renderers

```text
src/
├── app/                main.tsx (mount) · App.tsx (rail nav, 4 screens, modals)
├── features/
│   ├── onboarding/     OnboardingFlow (3-pane first-run)
│   ├── chat/           ChatScreen · MessageList · MessageBubble · MicButton ·
│   │                   useConversation · useSessions · conversation-types · LegacyChatScreen
│   ├── schedules/      SchedulesScreen (active reminders, live-ticking)
│   ├── history/        HistoryScreen (past events, filter chips)
│   ├── settings/       SettingsScreen · OpenAiKeySection · VoiceSection · GmailSection
│   └── reminders/      TriggerModal (in-app fired reminder) · OverdueModal (missed-while-closed)
├── popup/              PopupApp · main (reminder popup window renderer)
├── launcher/           LauncherApp · main · useLauncherMessages (voice launcher renderer)
├── audio-host.ts       Hidden audio window renderer (TTS playback host)
├── hooks/              useReminders · useSettings · useNow · useSpeech (mic capture)
├── lib/                ipc.ts (the sole toucher of window.lifeos; unwraps Result)
├── components/         Modal (focus-trap)
├── styles/             global.css (design system + light/dark tokens)
└── types/              window.d.ts (bridge typings for the 3 window.lifeos* objects)
```

Each window has its own HTML entry (`src/index.html`, `src/audio-host.html`, `src/popup.html`, `src/launcher.html`) built by electron-vite. See [FRONTEND](./FRONTEND.md).

## `tests/`

```text
tests/
├── unit/           40 files (pure logic, providers, matchers, state machines)
├── integration/    14 files (real SQLite, engine, scheduler, Gmail flows)
├── renderer/       1 file (useConversation, jsdom)
└── fixtures/       commands.json (56 parser fixtures) · audio/ (wav + transcript)
```

**523 tests / 55 files** total. See [TESTING](./TESTING.md).

## `docs/`

- This documentation site (the 26 `*.md` files at `docs/` root).
- `docs/lifeos-planning/` — 60+ numbered design/decision records + `current-project-status.md` (the running changelog) + `gmail-integration.md`.

## Build & config files

| File | Purpose |
| --- | --- |
| `electron.vite.config.ts` | 3 targets: main (`out/main`), preload (4 entries, cjs), renderer (4 HTML entries) |
| `vitest.config.ts` | node default, jsdom for `tests/renderer/**`, `@core` alias |
| `eslint.config.js` | flat config; `core/` import purity; only `reset-service.ts` may import `fs` |
| `electron-builder.yml` | NSIS + portable; `productName: LifeOS`; bundles STT model as `extraResources` |
| `tsconfig.node.json` / `tsconfig.web.json` | node (no DOM) vs web (DOM + jsx) projects |

See [DEVELOPMENT_GUIDE](./DEVELOPMENT_GUIDE.md) for build/debug workflows.
