# 13 — System Architecture

---

## 1. The whole system on one page

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LifeOS — Electron Application                       │
│                                                                             │
│  ┌───────────────────── RENDERER (sandbox:true, no Node) ────────────────┐  │
│  │  React 19 + TypeScript                                               │  │
│  │  ┌──────────┬──────────┬───────────┬──────────┬────────────────────┐ │  │
│  │  │ Chat     │ Live     │ Reminder  │ Active   │ History │ Settings │ │  │
│  │  │ interface│ transcript│ confirm.  │ Schedules│         │          │ │  │
│  │  └──────────┴──────────┴───────────┴──────────┴────────────────────┘ │  │
│  │  AudioWorklet: mic → PCM16 @16kHz → IPC                              │  │
│  └────────────────────────────┬─────────────────────────────────────────┘  │
│                               │                                            │
│  ┌────────────────────────────┴─ PRELOAD (sandboxed, bundled) ──────────┐  │
│  │  contextBridge → window.lifeos.{reminders,speech,settings,parse}     │  │
│  │  ~14 named functions. No raw ipcRenderer. Frozen.                    │  │
│  └────────────────────────────┬─────────────────────────────────────────┘  │
│                               │  validated IPC (Zod at every handler)       │
│  ┌────────────────────────────┴─ MAIN PROCESS (Node, never throttled) ───┐  │
│  │                                                                       │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  ┌───────────────┐  │  │
│  │  │  Database   │  │  Scheduler   │  │   Tray    │  │ Notifications │  │  │
│  │  │  SqliteDriver│ │ 30s reconcile│  │ (module-  │  │  (main-proc   │  │  │
│  │  │  Repositories│ │ powerMonitor │  │  scope ref)│ │   Notification)│ │  │
│  │  └─────────────┘  └──────┬───────┘  └───────────┘  └───────────────┘  │  │
│  │                          │                                            │  │
│  │  ┌───────────────────────┴─ SPEECH LAYER ──────────────────────────┐  │  │
│  │  │  SpeechService  ← SherpaOnnxSpeechService (native, streaming)   │  │  │
│  │  │  TTSService     ← WebSpeechTTSService | SapiTTSService          │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  │                          │                                            │  │
│  └──────────────────────────┼────────────────────────────────────────────┘  │
│                             │ IPC (one-way commands)                        │
│  ┌──────────────────────────┴─ HIDDEN AUDIO WINDOW ─────────────────────┐  │
│  │  show:false · backgroundThrottling:false · never destroyed           │  │
│  │  speechSynthesis  ·  <audio src="yogi-song.mp3">                     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────── core/ — PURE TYPESCRIPT, ZERO IMPORTS ────────────────┐  │
│  │  INTELLIGENCE            SAFETY                                       │  │
│  │  · detectIntent()        · Zod schemas                                │  │
│  │  · extractRecurrence()   · allowed-action validator                   │  │
│  │  · chrono wrapper        · unsafe-content scanner                     │  │
│  │  · detectAmbiguity()     · confirmation gate (a type, not a function) │  │
│  │  · scoreConfidence()                                                  │  │
│  │  · nextOccurrenceAfter() (Luxon)                                      │  │
│  │  · rruleToHuman()                                                     │  │
│  │  Used identically by main and renderer. Portable off Electron.        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                          ┌───────────┴───────────┐
                          │  %APPDATA%\LifeOS\    │
                          │    lifeos.db (SQLite) │
                          │    logs/              │
                          └───────────────────────┘
```

Mapped against the brief's §22 structure: everything requested is present. Two things were **added**, and both are load-bearing:

1. **`core/`** — the pure layer. The brief's "Intelligence Layer" and "Safety Layer" live here, with an enforced rule that they import nothing from Electron or Node. This is what makes the parser unit-testable in milliseconds and the framework choice reversible (`05` §6.2).
2. **The hidden audio window** — because `speechSynthesis` and `<audio>` are renderer APIs and the reminder must speak while the main window is gone (`07` §2.2).

## 2. Layers and their laws

| Layer | May import | May **not** import | Why |
| --- | --- | --- | --- |
| `core/` | `luxon`, `chrono-node`, `zod` | `electron`, `node:*`, `fs`, `path` | Portability, test speed. Enforced by ESLint. |
| `electron/` | anything Node | React, anything in `src/` | Main is not a UI. |
| `src/` (renderer) | React, `core/` | `electron`, `node:*` | Sandbox forbids it anyway; the lint rule catches it earlier. |
| `electron/preload/` | `electron` (6 named exports only) | everything else | `VERIFIED FACT` — the sandbox permits nothing else. |

`MVP DECISION` — `core/` is imported by **both** main and renderer. `rruleToHuman()` renders in React; `nextOccurrenceAfter()` runs in the scheduler; both come from the same file, tested once.

## 3. The two flows that define the product

### 3.1 Create — user speaks a reminder

```text
 renderer                preload           main                     core
    │                       │                │                        │
 [mic press]                │                │                        │
    ├─ getUserMedia         │                │                        │
    ├─ AudioWorklet ────────┤                │                        │
    │   PCM16 16kHz frames  ├─ speech:audio ─►                        │
    │   every 200ms         │                ├─ sherpa.acceptWaveform │
    │                       │                ├─ decode()              │
    │  ◄─ speech:partial ───┤◄───────────────┤                        │
    ├─ render interim text  │                │                        │
 [mic press = stop]         │                │                        │
    ├────── speech:stop ────►                ├─ finalize()            │
    │  ◄─ speech:final ─────┤◄───────────────┤                        │
    │                       │                │                        │
    ├────── parse:reminder ─►                ├─ parseReminder() ──────►
    │                       │                │  ◄─ ParseResult ───────┤
    │  ◄─ ParseResult ──────┤◄───────────────┤                        │
    │                       │                │                        │
 ┌──┴─────────────────────┐ │                │                        │
 │ ok:true → Confirmation │ │                ├─ tts:speak ──► audioWin│
 │ ok:false → Clarification│ │               │   "Okay. I will…"      │
 └──┬─────────────────────┘ │                │                        │
    │                       │                │                        │
 [user presses CONFIRM] ◄────── THE GATE. Nothing above this line wrote anything.
    │                       │                │                        │
    ├─ reminders:create ────►                ├─ Zod.parse(raw)        │
    │                       │                ├─ assertSender()        │
    │                       │                ├─ repo.create()  ──► SQLite
    │  ◄─ Reminder DTO ─────┤◄───────────────┤                        │
    └─ optimistic → confirmed                │                        │
```

`MVP DECISION` — Note where `parseReminder` runs: **in main**, invoked over IPC, even though `core/` is importable from the renderer. Reason: the AI Assist fallback lives behind it and needs the API key, which never crosses IPC. The renderer imports `core/` only for **formatting** (`rruleToHuman`, countdown maths).

### 3.2 Fire — the reminder comes due

```text
  main (Node timer, unthrottled)
    │
 setInterval(30s) ──► reconcile('tick')
    │
    ├─ repo.findDue(Date.now())          [idx_reminders_due, LIMIT 20]
    │
    └─ for each due reminder:
         │
         ├─► new Notification({...}).show()          ◄── UNCONDITIONAL. Always works.
         │      └─ on 'click' → mainWindow.show()+focus()
         │
         ├─► history.record(id, now, 'triggered')    ◄── UNCONDITIONAL.
         │
         ├─► audioWindow.send('tts:speak', {text})   ◄── best effort. May be throttled.
         │
         ├─► audioWindow.send('audio:play', {file})  ◄── best effort. Only if action=sing.
         │
         ├─► mainWindow?.send('reminder:trigger', dto) ◄── only if a window exists.
         │
         └─ if recurring: repo.setNextFireAt(id, nextOccurrenceAfter(r, now))
            else:         repo.markTriggered(id, now)
```

**Read the annotations top to bottom.** Reliability decreases as you descend, and nothing lower can break anything higher. The notification and the history row are guaranteed. Speech, sound, and the modal are enhancements. A silent reminder is still a reminder; a missed reminder is a bug.

## 4. The hidden audio window

`RISK (high)` — `speechSynthesis` and `<audio>` are renderer APIs. Chromium throttles hidden renderers, and `backgroundThrottling: false` is documented as buggy for the `hide()` case on Windows (electron#31016, #20974, #9567). The reminder must speak precisely when the window is hidden.

```ts
// Created at app.whenReady(). Destroyed only in before-quit.
audioWindow = new BrowserWindow({
  show: false,
  webPreferences: { ...secureDefaults, preload: audioPreload, backgroundThrottling: false },
});
audioWindow.loadFile('audio-host.html');

// Self-healing: if it dies, bring it back. A reminder must not depend on its health.
audioWindow.webContents.on('render-process-gone', () => {
  log.error('audio', 'audio window died; recreating');
  createAudioWindow();
});
```

- One window owns **both** speech and MP3 playback. One lifecycle, one throttling question, and SPIKE-3 answers it for both.
- It is created before the main window and outlives it.
- It sends nothing back except acknowledgements. It makes no decisions.
- `app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')` is called **before any window exists**, or `<audio>.play()` rejects (electron#14323).

`FUTURE OPTION` — If SPIKE-3 fails, this window is deleted entirely: speech moves to `SapiTTSService` in main, and MP3 to a native N-API player. Both sit behind interfaces the rest of the app already talks to. **Nothing above the service layer changes.** That is the point of the layering.

## 5. Scheduler placement — the one architectural non-negotiable

`VERIFIED FACT` — The Electron main process is a plain Node event loop and is **never** subject to Chromium's renderer throttling.

`MVP DECISION` — The scheduler lives in main. The renderer never schedules anything. Its only scheduling-adjacent job is drawing a countdown, which it derives from `next_fire_at` using a single shared 1-second ticker.

`MVP DECISION` — Timers are an optimisation; **the persisted `next_fire_at` column is the contract.** Three triggers drive the same idempotent `reconcile()`:

```ts
app.whenReady().then(() => reconcile('startup'));   // catch-up while app was closed
setInterval(() => reconcile('tick'), 30_000);       // self-healing backstop
powerMonitor.on('resume',        () => reconcile('resume'));
powerMonitor.on('unlock-screen', () => reconcile('unlock'));
```

`reconcile()` is safe to call at any time, concurrently, twice in a row. It is a query, not a state machine.

## 6. Service interfaces

The brief's provider architecture, preserved exactly, with the concrete defaults changed by research (`02` A1, A2).

```ts
// core/speech/speech-service.ts
export interface SpeechService {
  readonly id: string;
  readonly supportsPartials: boolean;
  readonly isOffline: boolean;
  init(): Promise<void>;
  start(session: string): Promise<void>;
  pushAudio(session: string, pcm16: ArrayBuffer): void;
  stop(session: string): Promise<SpeechFinalResult>;
  dispose(): Promise<void>;
  on(e: 'partial' | 'final' | 'error', cb: (p: any) => void): void;
}

// core/tts/tts-service.ts
export interface TTSService {
  readonly id: string;
  readonly isOffline: boolean;
  init(): Promise<void>;
  listVoices(): Promise<TTSVoice[]>;
  speak(text: string, opts?: TTSOptions): Promise<void>;
  cancel(): void;
  dispose(): Promise<void>;
}

// core/ai/ai-assist-provider.ts
export interface AiAssistProvider {
  readonly id: string;
  readonly isLocal: boolean;
  parse(input: AiParseInput, signal: AbortSignal): Promise<unknown>;  // ← unknown, deliberately
}

// core/research/research-provider.ts   (future; defined, never implemented in MVP)
export interface ResearchProvider {
  answer(query: string): Promise<ResearchResult>;
}
```

```text
SpeechService                TTSService                 AiAssistProvider
├── SherpaOnnxSpeechService  ├── WebSpeechTTSService    ├── OpenAiAssistProvider
├── TransformersJsSpeech…    ├── SapiTTSService         ├── OllamaAssistProvider   (future)
├── VoskKoffiSpeechService   ├── PiperTTSService (fut.) └── AnthropicAssistProvider (future)
├── OpenAISpeechService      ├── ElevenLabsTTSService
└── DeepgramSpeechService    └── OpenAITTSService
    └ implemented in MVP: 1      └ implemented in MVP: 1–2   └ implemented in MVP: 0–1
```

`MVP DECISION` — A `SpeechService` or `TTSService` failure is **never fatal**. `SpeechCoordinator` catches, degrades, sets a flag, and shows one toast. The reminder still fires.

`MVP DECISION` — `AiAssistProvider.parse()` returns **`unknown`**, forcing every caller through Zod. A provider typed to return `Promise<LlmReminder>` would be a provider claiming to have validated something it has not.

## 7. Module dependency graph

Arrows point from importer to imported. There are no cycles, and none of them cross the `core/` boundary in the wrong direction.

```text
                          ┌──────────┐
                          │  core/   │   pure. imports nothing local.
                          └────┬─────┘
              ┌────────────────┼────────────────┐
              │                │                │
        ┌─────┴──────┐   ┌─────┴──────┐  ┌──────┴─────┐
        │  electron/ │   │    src/    │  │   tests/   │
        │   main     │   │  renderer  │  │            │
        └─────┬──────┘   └─────┬──────┘  └────────────┘
              │                │
         ┌────┴────┐      ┌────┴─────┐
         │database │      │ features │
         │scheduler│      │components│
         │speech   │      │  hooks   │
         │tts      │      └──────────┘
         │tray     │
         │notif.   │
         └─────────┘
```

`MVP DECISION` — `electron/` never imports `src/`. `src/` never imports `electron/`. They communicate exclusively through the preload's 14 functions and the typed event channels. The only shared code is `core/`.

## 8. State ownership

The most common Electron bug is two processes each believing they own the truth.

| State | Owner | Renderer's copy |
| --- | --- | --- |
| Reminders | **SQLite (main)** | Read-only cache, invalidated on every mutation event |
| `next_fire_at` | **Scheduler (main)** | Never written; only rendered as a countdown |
| Settings | **SQLite (main)** | Read-only cache |
| API key | **main, encrypted** | Never. `hasApiKey: boolean` only. |
| Paused flag | **SQLite (main)** | Mirrored for the banner |
| Live transcript | **Renderer** | Owner. Ephemeral, never persisted. |
| Chat message list | **Renderer** | Owner. Ephemeral in MVP. |
| Pending confirmation card | **Renderer** | Owner. **Not persisted** — that is the gate. |
| Mic permission state | **Renderer** | Owner. |

`MVP DECISION` — Main broadcasts `reminders:changed` after every mutation. The renderer refetches. No optimistic-then-diverged state, no client-side scheduler, no dual source of truth. A reminders app with a stale list is a reminders app that lies.

## 9. Startup sequence

Order matters; three of these steps have to happen before a window exists.

```text
 1. app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')   ← before windows
 2. app.setAppUserModelId('com.dreamnotion.lifeos')                              ← or toasts fail unpackaged
 3. app.requestSingleInstanceLock() → if false, focus existing window and exit
 4. app.whenReady()
 5.   session: CSP header, permission handlers, default-deny network filter
 6.   openDatabase()  →  migrate()  →  seedDefaultSettings()
 7.   createAudioWindow()          (hidden, first, outlives everything)
 8.   createTray()                 (module-scope ref — the GC bug)
 9.   registerIpcHandlers()
10.   startScheduler()             →  reconcile('startup')  ← surfaces overdue reminders
11.   createMainWindow()           (show:false → 'ready-to-show' → show)
12.   retentionSweep()             (background microtask, after first paint)
```

`VERIFIED FACT` — Step 2 is required. Unpackaged, without `setAppUserModelId`, Windows toasts silently do not appear. Packaged NSIS installs set it automatically, which is exactly why this must be tested **packaged** (`02` A9).

`VERIFIED FACT` — Step 8: a `Tray` held in function scope is garbage-collected and the icon **vanishes after ~10 s in packaged builds** while working fine in dev. Keep the reference at module scope. (electron-react-boilerplate#2705)

Shutdown:

```text
 before-quit  → isQuitting = true
              → scheduler.stop()
              → speechService.dispose()   (release the STT model, ~250MB)
              → tray.destroy()
              → db.close()                (checkpoint the WAL)
 window 'close' → if (!isQuitting) { e.preventDefault(); win.hide(); }
 window-all-closed → do NOT quit on Windows (we live in the tray)
```

## 10. Failure isolation

| Component dies | Consequence | Recovery |
| --- | --- | --- |
| STT model fails to load | Mic button disabled with a reason | Typed input works. App is fully usable. |
| Audio window crashes | No speech, no MP3 | `render-process-gone` → recreate. Notification still fired. |
| TTS has no voices | Silent reminders | One toast, `tts_degraded=true`, notification still fires. |
| Main window closed | — | Scheduler is in main. Reminders fire normally. |
| Notification API fails | No toast | Audio + in-app modal remain. Logged. |
| DB write fails | Reminder not saved | Error surfaced with Retry. **Never a silent success.** |
| DB is from a newer version | App refuses to open it | Clear message + Reset option. Never a downgrade migration. |
| Scheduler throws mid-reconcile | One tick lost | Next tick (30 s) recovers. `reconcile` is idempotent. |
| AI Assist fails, any reason | — | Local clarification question. Feature is never load-bearing. |
| Clock jumps forward | Storm of due reminders | `LIMIT 20` + a warning banner. |

`MVP DECISION` — Read the table as a single claim: **the notification path has no dependency on speech, audio, the renderer, the network, or the LLM.** Every optional subsystem is downstream of the thing that must not fail.

## 11. Performance budget

| Metric | Target | Where it's spent |
| --- | --- | --- |
| Cold start → interactive | < 3 s | Electron ~800 ms; DB open + migrate < 50 ms; React mount ~200 ms; STT model loads **lazily on first mic press**, not at boot |
| Parse latency (typed) | < 50 ms | chrono + regex, pure functions |
| First STT partial | < 500 ms | 200 ms frame + decode |
| Reconcile tick | < 5 ms | one indexed query over tens of rows |
| Idle RAM, tray, no STT | < 250 MB | Electron baseline ~180 MB |
| RAM with STT loaded | < 500 MB | sherpa model ~250 MB |
| Installer | < 200 MB | Electron ~90 MB + model ~40 MB + app ~15 MB |

`MVP DECISION` — **The STT model loads lazily**, on first mic press, and is disposed after 5 minutes of mic inactivity. A user who only types never pays the 250 MB. This single decision is what keeps NFR-4 achievable while the app sits in the tray all day.
