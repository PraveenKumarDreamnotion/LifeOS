# 14 — Folder Structure

> Production-quality, MVP-appropriate. Every directory below has a reason; nothing is there because a boilerplate put it there.

---

## 1. The tree

```text
lifeos/
├── .github/
│   └── workflows/
│       └── release.yml               # tag → build → draft GitHub Release
├── .vscode/
│   └── launch.json                   # attach to main + renderer
├── assets/                           # SOURCE assets (checked in)
│   ├── audio/
│   │   ├── yogi-song.mp3             # ≤15s, ≤500KB, royalty-free
│   │   └── LICENSE.md                # ← mandatory. Provenance of the track.
│   ├── icons/
│   │   ├── icon.ico                  # multi-res: 16,24,32,48,256
│   │   ├── tray.ico                  # multi-res: 16@72dpi, 20, 32@144dpi
│   │   ├── tray-paused.ico
│   │   └── icon.png                  # 512×512, source of truth
│   └── images/
│       └── onboarding/
├── build/                            # electron-builder inputs
│   ├── icon.ico
│   └── installer.nsh                 # NSIS customisation, if any
├── core/                             # ◄── PURE TYPESCRIPT. THE VALUABLE PART.
│   ├── ai/
│   │   ├── ai-assist-provider.ts     # interface; parse() returns `unknown`
│   │   ├── openai-provider.ts        # builds the request; does NOT validate
│   │   └── llm-response-schema.ts    # Zod + the four validation gates
│   ├── parsing/
│   │   ├── parse-reminder.ts         # the entry point; a total function
│   │   ├── detect-intent.ts
│   │   ├── extract-recurrence.ts     # the layer chrono cannot provide
│   │   ├── extract-title.ts
│   │   ├── detect-ambiguity.ts       # isCertain() lives here
│   │   ├── score-confidence.ts
│   │   └── clarification.ts          # Ambiguity → question + suggestions
│   ├── scheduling/
│   │   ├── rrule.ts                  # parseRule / buildRule. Two shapes only.
│   │   ├── next-occurrence.ts        # Luxon. DST-correct.
│   │   └── rrule-to-human.ts         # "Every Monday at 7:00 AM"
│   ├── safety/
│   │   ├── unsafe-content.ts         # the scanner from 09 §5 Gate 3
│   │   └── allowed-actions.ts        # the closed intent/action allow-lists
│   ├── speech/
│   │   └── speech-service.ts         # interface + result types
│   ├── tts/
│   │   └── tts-service.ts            # interface + voice types
│   ├── time/
│   │   └── format.ts                 # absolute + relative rendering
│   └── types/
│       ├── reminder.ts               # domain model, shared main↔renderer
│       ├── settings.ts
│       └── ipc.ts                    # channel names + payload types
├── electron/
│   ├── main/
│   │   ├── index.ts                  # the startup sequence from 13 §9
│   │   ├── windows.ts                # secureDefaults, main + audio windows
│   │   ├── session.ts                # CSP, permissions, default-deny network
│   │   ├── lifecycle.ts              # single-instance, before-quit, close-to-tray
│   │   └── ipc/
│   │       ├── index.ts              # registerIpcHandlers()
│   │       ├── reminders.ts
│   │       ├── settings.ts
│   │       ├── speech.ts
│   │       └── parse.ts
│   ├── preload/
│   │   ├── index.ts                  # main window bridge (bundled to ONE file)
│   │   └── audio.ts                  # audio window bridge (tiny)
│   ├── database/
│   │   ├── driver.ts                 # SqliteDriver interface — the swap point
│   │   ├── drivers/
│   │   │   ├── node-sqlite-driver.ts     # primary
│   │   │   └── better-sqlite3-driver.ts  # fallback, same interface
│   │   ├── open.ts                   # path resolution + pragmas
│   │   ├── migrate.ts                # PRAGMA user_version runner
│   │   ├── migrations/
│   │   │   ├── 001_initial.sql
│   │   │   └── 002_memory.sql
│   │   ├── reminder-repository.ts
│   │   ├── history-repository.ts
│   │   ├── settings-repository.ts
│   │   └── log-repository.ts
│   ├── scheduler/
│   │   ├── scheduler.ts              # reconcile(); takes now() as a dependency
│   │   ├── trigger-sink.ts           # the fan-out from 13 §3.2
│   │   └── overdue.ts                # the missed-while-closed policy
│   ├── speech/
│   │   ├── speech-coordinator.ts     # owns lifecycle, lazy model load, disposal
│   │   ├── sherpa-onnx-service.ts    # ◄── the only implemented provider
│   │   ├── transformers-js-service.ts# fallback A (stub until needed)
│   │   └── stubs/
│   │       ├── vosk-koffi-service.ts
│   │       ├── openai-service.ts
│   │       └── deepgram-service.ts
│   ├── tts/
│   │   ├── tts-coordinator.ts        # degrade-never-throw
│   │   ├── web-speech-service.ts     # commands the audio window
│   │   └── sapi-tts-service.ts       # ◄── THE ONLY FILE THAT MAY IMPORT child_process
│   ├── audio/
│   │   └── audio-player.ts           # commands the audio window
│   ├── notifications/
│   │   └── notifier.ts               # main-process Notification + click→focus
│   ├── tray/
│   │   └── tray.ts                   # module-scope ref (the GC bug)
│   └── services/
│       ├── reset-service.ts          # ◄── THE ONLY FILE THAT MAY IMPORT fs.rm
│       ├── secrets.ts                # safeStorage; key never crosses IPC
│       └── logger.ts                 # → app_logs, redacted
├── src/                              # renderer
│   ├── app/
│   │   ├── App.tsx
│   │   ├── router.tsx                # 4 routes; hash router (file:// safe)
│   │   ├── providers.tsx             # theme, toast, countdown ticker
│   │   └── main.tsx
│   ├── components/                   # the inventory from 12 §12
│   │   ├── Button.tsx  Card.tsx  Chip.tsx  Banner.tsx  Modal.tsx
│   │   ├── ConfirmDestructive.tsx  Toast.tsx  EmptyState.tsx
│   │   ├── Spinner.tsx  Toggle.tsx  Select.tsx
│   │   ├── TimeField.tsx  DateField.tsx  WeekdayPicker.tsx
│   │   └── Countdown.tsx             # one shared 1s ticker via context
│   ├── features/
│   │   ├── onboarding/
│   │   ├── chat/
│   │   │   ├── ChatScreen.tsx  MessageList.tsx  Composer.tsx
│   │   │   ├── MicButton.tsx   LiveTranscript.tsx  QuickCommands.tsx
│   │   │   ├── ConfirmationCard.tsx      # ◄── the gate, in one component
│   │   │   ├── ClarificationCard.tsx     # ◄── has NO confirm button, by design
│   │   │   └── EditReminderForm.tsx
│   │   ├── reminders/
│   │   │   ├── TriggerModal.tsx
│   │   │   └── OverdueCatchupModal.tsx
│   │   ├── schedules/
│   │   ├── history/
│   │   └── settings/
│   ├── hooks/
│   │   ├── useReminders.ts           # subscribes to reminders:changed
│   │   ├── useSpeech.ts              # mic + AudioWorklet + partials
│   │   ├── useSettings.ts
│   │   ├── useCountdown.ts
│   │   └── useTheme.ts
│   ├── lib/
│   │   ├── ipc.ts                    # typed wrapper over window.lifeos
│   │   └── format.ts                 # re-exports core/time/format
│   ├── styles/
│   │   ├── tokens.css                # the design tokens from 12 §2.1
│   │   └── global.css
│   └── types/
│       └── window.d.ts               # declares window.lifeos
├── public/
│   ├── index.html                    # CSP meta (belt; the header is braces)
│   ├── audio-host.html               # the hidden audio window's document
│   └── worklets/
│       └── pcm16-downsampler.js      # ◄── must be a real file; worklets can't be bundled
├── resources/                        # SHIPPED, unpacked, at runtime
│   ├── models/
│   │   └── stt/                      # sherpa streaming zipformer (~40MB)
│   └── audio/
│       └── yogi-song.mp3             # copied from assets/ at build time
├── docs/
│   └── lifeos-planning/              # ◄── you are here
├── tests/
│   ├── unit/
│   │   ├── parse-reminder.test.ts    # the fixture corpus
│   │   ├── detect-ambiguity.test.ts
│   │   ├── next-occurrence.test.ts   # DST, 24.8-day trap
│   │   ├── rrule.test.ts
│   │   ├── llm-response-schema.test.ts
│   │   ├── unsafe-content.test.ts
│   │   └── scheduler.test.ts         # injected clock
│   ├── integration/
│   │   ├── reminder-repository.test.ts   # real SQLite, temp file
│   │   ├── migrations.test.ts
│   │   └── ipc-contracts.test.ts
│   ├── e2e/
│   │   └── smoke.spec.ts             # Playwright + Electron, packaged
│   ├── manual/
│   │   └── CHECKLIST.md              # the packaged-build checks a robot can't do
│   └── fixtures/
│       ├── commands.json             # 120 utterances → expected parse
│       └── audio/
│           └── remind-me-5-min.wav   # 16kHz mono PCM16 — isolates resampler bugs
├── .eslintrc.json                    # the import bans from 11 §7
├── .npmrc                            # ignore-scripts=true
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
├── package-lock.json                 # committed. npm ci only.
├── tsconfig.json                     # moduleResolution: "node16" (chrono needs it)
├── vitest.config.ts
├── LICENSE                           # MIT
├── PRIVACY.md
└── README.md
```

## 2. Deviations from the brief's suggested structure, and why

The brief proposes `electron/` + `src/` + `assets/` + `tests/`. Four changes:

| Change | Rationale |
| --- | --- |
| **Added `core/`** | The brief's "Intelligence Layer" and "Safety Layer" have no home in `electron/` or `src/` — they are used by **both**. Putting them in `electron/` makes them untestable without an Electron harness and unusable from React. Putting them in `src/` puts the parser inside the sandbox. `core/` is the only correct answer, and it is what makes the framework decision reversible (`05` §6.2). |
| **Added `resources/`** | `assets/` holds *source* assets checked into git. `resources/` holds what electron-builder ships **unpacked** (`extraResources`). The 40 MB STT model must not go inside the asar. Conflating them is how the model ends up unreadable at runtime. |
| **Added `public/worklets/`** | `VERIFIED FACT` — `AudioWorklet.addModule()` fetches a URL. The worklet cannot be bundled by Vite into the main chunk; it must exist as a real file at a stable path. Discovering this on Day 4 costs an afternoon. |
| **Added `tests/fixtures/audio/`** | A known-good 16 kHz WAV lets SPIKE-2 test the *engine* separately from the *resampler*. Skipping this is the most common way to lose a day debugging STT (`06` §9). |

## 3. Files with special rules

These four files carry codified exceptions. Each is enforced by an ESLint override (`11` §7) and each is called out in code review.

| File | Exception | Guard |
| --- | --- | --- |
| `electron/tts/sapi-tts-service.ts` | May import `child_process` | Command is a module constant; unit test asserts `!SCRIPT.includes('${')`. Only exists if SPIKE-3 fails. |
| `electron/services/reset-service.ts` | May import `fs.rm` | Path from `app.getPath('userData')` only; two path guards; IPC handler takes **no arguments**. |
| `electron/database/migrate.ts` | May interpolate into SQL | Only `PRAGMA user_version = ${v}`, where `v` is a loop index over a hardcoded array. SQLite forbids bound params in PRAGMA. |
| `electron/preload/index.ts` | Must be a single bundled file | `VERIFIED FACT` — a sandboxed preload cannot `require` across files. electron-vite handles it. |

## 4. The `core/` boundary, enforced

```jsonc
// .eslintrc.json — the rule that keeps core/ portable
{
  "overrides": [{
    "files": ["core/**/*.ts"],
    "rules": {
      "no-restricted-imports": ["error", {
        "patterns": ["electron", "electron/*", "node:*", "fs", "path", "os", "child_process", "../electron/*", "../src/*"],
        "message": "core/ must stay pure. See 14-folder-structure.md §4."
      }]
    }
  }]
}
```

`MVP DECISION` — `core/` may import exactly three runtime dependencies: `luxon`, `chrono-node`, `zod`. Nothing else. This is checked in CI by a script that reads `core/**/*.ts` imports and diffs them against an allowlist.

The payoff, concretely:

```bash
$ npx vitest run tests/unit/parse-reminder.test.ts
  ✓ 120 fixtures parsed  (41ms)
```

41 milliseconds, no Electron, no window, no database. That is what makes 120 parser fixtures a thing you actually run on every save, and it is why the parser will be the most correct component in the app.

## 5. Build configuration

```ts
// electron.vite.config.ts
export default defineConfig({
  main:     { build: { rollupOptions: { external: ['sherpa-onnx', 'better-sqlite3'] } } },
  preload:  { build: { rollupOptions: { output: { format: 'es' } } } },   // ONE file, ESM
  renderer: { plugins: [react()], resolve: { alias: { '@core': resolve('core'), '@': resolve('src') } } },
});
```

`MVP DECISION` — Native modules are marked `external` so Rollup does not try to bundle a `.node` binary.

```yaml
# electron-builder.yml
appId: com.dreamnotion.lifeos
productName: LifeOS              # ← determines %APPDATA%\LifeOS\. Keep filesystem-legal.
directories: { output: release, buildResources: build }

files:
  - out/**/*
  - package.json

extraResources:                  # shipped UNPACKED, next to the asar
  - from: resources/models/stt
    to: models/stt
  - from: resources/audio
    to: audio

asarUnpack:
  - "**/node_modules/sherpa-onnx-node/**"        # + sherpa-onnx-win-x64. native .node/.dll cannot load from inside asar
  # - "**/node_modules/sherpa-onnx-win-x64/**"        # native .node cannot load from inside asar
  # - "**/node_modules/better-sqlite3/**"   # uncomment only if the fallback is taken

win:
  target: [nsis, portable]
  icon: build/icon.ico

nsis:
  oneClick: false
  perMachine: false              # ◄── per-user install. No UAC. No admin. Ever.
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true  # required for toast AppUserModelID

portable:
  artifactName: ${productName}-${version}-portable.exe

publish:
  - { provider: github, owner: <user>, repo: lifeos }
```

`VERIFIED FACT` — `asarUnpack` is mandatory for native `.node` binaries; they cannot be loaded from a compressed asar.

`VERIFIED FACT` — `createStartMenuShortcut: true` is not cosmetic. Windows toasts require a Start Menu shortcut carrying the AppUserModelID. Without it, notifications silently fail.

`MVP DECISION` — `perMachine: false` is the line that implements the brief's very first safety requirement. It produces a per-user install under `%LOCALAPPDATA%\Programs\`, needs no elevation, and triggers no UAC prompt.

## 6. Resolving resource paths at runtime

The single most common packaging bug: a path that works in dev and 404s in the installer.

```ts
// electron/main/paths.ts
import { app } from 'electron';
import path from 'node:path';

export const resourcePath = (...segments: string[]) =>
  app.isPackaged
    ? path.join(process.resourcesPath, ...segments)      // → resources/models/stt
    : path.join(app.getAppPath(), 'resources', ...segments);

export const sttModelDir = () => resourcePath('models', 'stt');
export const yogiSongPath = () => resourcePath('audio', 'yogi-song.mp3');
```

`MVP DECISION` — **Never use `__dirname` to find a resource.** It points inside the asar when packaged. Every resource path goes through `resourcePath()`, and an integration test asserts both branches return an existing file.

## 7. What is deliberately absent

| Not present | Why |
| --- | --- |
| `src/store/` (Redux/Zustand) | Main owns the state (`13` §8). The renderer holds a cache invalidated by one event. A store would create a second source of truth. |
| `src/api/` | There is no API. There is no server. |
| An ORM | Four tables, twelve queries. An ORM would be more code than the queries. |
| `.env` files | No secrets at build time. The user's API key lives encrypted in SQLite. |
| A Storybook | Twelve components, one developer, seven days. |
| `src/utils/` | A junk drawer with a name. Functions live next to what uses them, or in `core/`. |
| Barrel `index.ts` re-export files | They defeat tree-shaking and create import cycles. Import from the file. |
| `electron/ipc-channels.ts` in `electron/` | Channel names are shared with the renderer, so they live in `core/types/ipc.ts`. |
