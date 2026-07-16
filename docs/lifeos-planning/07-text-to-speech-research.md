# 07 — Text-to-Speech Research

> **Headline:** The brief's recommendation ("Windows native TTS or Windows SAPI") reaches the right *destination* by the wrong *road*. The best Windows-native TTS in Electron is `window.speechSynthesis`, not a PowerShell/SAPI spawn — and it carries one serious caveat that must be spiked against a **packaged** build.
>
> **Label key:** `VERIFIED FACT` · `ASSUMPTION` · `RISK` · `RECOMMENDATION` · `MVP DECISION` · `FUTURE OPTION`

---

## 1. Evaluation matrix

The brief's hard constraints: **free, offline, fast, no additional model download, Windows, good enough for reminder confirmation.**

| | **speechSynthesis** | **PowerShell SAPI** | Piper | edge-tts | ElevenLabs | OpenAI TTS | Coqui |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Voice quality | Good (WinRT voices) | Fair (SAPI5 desktop) | **Very good** | Very good | Excellent | Excellent | Good |
| **Offline** | **✅** | **✅** | ✅ | **❌ cloud** | ❌ | ❌ | ✅ |
| Cost | ₹0 | ₹0 | ₹0 | ₹0 | $0.10/1k chars | $15/1M chars | ₹0 |
| Windows support | ✅ | ✅ 5.1 only | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Electron integration | ✅ native | ⚠️ `child_process` | ⚠️ spawn binary | ✅ | ✅ | ✅ | ❌ |
| Latency | **Instant** | ~1–2 s cold spawn | ~200 ms | Network | Network | Network | ~500 ms |
| CPU | Negligible | Low (spike) | Low–Med | — | — | — | High |
| Privacy | ✅ | ✅ | ✅ | **❌** | ❌ | ❌ | ✅ |
| **No model download** | **✅** | **✅** | **❌ tens of MB/voice** | ✅ | ✅ | ✅ | ❌ |
| Packaging complexity | **None** | None | High | Low | Low | Low | High |
| **Works while in tray** | **⚠️ must be proven** | **✅ immune** | ✅ | ✅ | ✅ | ✅ | ✅ |

Only two options satisfy *every* hard constraint: the two OS paths. Everything else fails on `offline`, `no model download`, or `cost`.

## 2. speechSynthesis — the recommendation

`VERIFIED FACT` — `window.speechSynthesis` in an Electron renderer on Windows works and is **fully offline**. Chromium's Web Speech synthesis on Windows is backed by the OS TTS engine (`tts_win.cc`), i.e. local Windows voices. No network. (electron#22844, electron#11585, and PR#14070 *"speechSynthesis now returns voices on Windows"*)

`VERIFIED FACT` — **No Electron flag is required.** The autoplay policy gates `<audio>`, not `speechSynthesis`.

`VERIFIED FACT` — **`getVoices()` is asynchronously populated and frequently returns `[]` on the first synchronous call.** The only reliable pattern is to wait for the `voiceschanged` event before reading voices or speaking. This is the single most common bug report against Web Speech in Electron.

`ASSUMPTION (well supported)` — Chromium exposes the modern **WinRT/OneCore** voices in addition to legacy SAPI5 desktop voices. This is the opposite of the PowerShell path (§3), which sees *only* the older desktop voices (David/Zira/Hazel). speechSynthesis therefore sounds noticeably better on Windows 11.

### 2.1 The caveat that decides the architecture

`RISK (high)` — **Chromium throttles background renderers.** `speechSynthesis` runs in the renderer. When a window is minimised, occluded or hidden, timers and the speech pipeline may be throttled and the utterance queue may stall.

`VERIFIED FACT` — `backgroundThrottling: false` disables timer/animation throttling for backgrounded pages and pins `document.visibilityState` to `visible`. (https://www.electronjs.org/docs/latest/api/browser-window)

`RISK (high)` — **It is buggy specifically for the `hide()` case on Windows.** Open and long-standing issues:
- electron#31016 — *"Disabling backgroundThrottling not working with hide() on Windows"*
- electron#20974 — `setTimeout` still throttled while minimised
- electron#9567, #50250, #42378 — visibility desync, blank/paint bugs

A reminder is the one thing that must fire when the app is hidden. **This cannot be assumed. It must be measured, against a packaged build.**

### 2.2 The architecture that survives the caveat

`MVP DECISION` — Introduce a dedicated, **always-alive hidden `BrowserWindow`** whose only job is audio output.

```ts
// electron/main/audio-window.ts
audioWindow = new BrowserWindow({
  show: false,                       // never shown, never minimised, never destroyed
  webPreferences: {
    preload: audioPreloadPath,
    contextIsolation: true,
    sandbox: true,
    backgroundThrottling: false,     // necessary; NOT sufficient — see SPIKE-3
  },
});
```

- It hosts `speechSynthesis` **and** the `<audio>` element for MP3 playback (§6). One output device, one lifecycle.
- The **main-process scheduler** commands it over IPC. The renderer never decides when to speak.
- It is created at `app.whenReady()` and destroyed only in `before-quit`.
- The *visible* window may be hidden, shown or destroyed freely without affecting speech.

`ASSUMPTION` — A never-shown window may still be treated as "hidden" by Chromium and throttled. `backgroundThrottling: false` is intended to prevent this. **SPIKE-3 exists precisely because the issue tracker says this promise is not always kept.**

### 2.3 Correct usage

```ts
// In the hidden audio window's renderer
function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  const v = speechSynthesis.getVoices();
  if (v.length) return Promise.resolve(v);
  return new Promise(resolve => {
    speechSynthesis.addEventListener('voiceschanged',
      () => resolve(speechSynthesis.getVoices()), { once: true });
  });
}

export async function speak(text: string, opts: { rate: number; voiceUri?: string }) {
  const voices = await voicesReady();                 // NEVER skip this
  speechSynthesis.cancel();                           // drop any stale queue
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voices.find(v => v.voiceURI === opts.voiceUri)
         ?? voices.find(v => v.lang.startsWith('en'))
         ?? voices[0];
  u.rate = opts.rate;
  u.onerror = e => reportTtsFailure(e.error);         // degrade, don't throw
  speechSynthesis.speak(u);
}
```

`RISK (low)` — If `getVoices()` returns `[]` even after `voiceschanged` (a machine with no installed voices), `speak()` must **fail silently and report**, never block the reminder. The notification and the modal still fire. TTS is an enhancement, not the reminder.

## 3. PowerShell SAPI — the fallback

`VERIFIED FACT` — `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak($t)` is a thin wrapper over the SAPI5 COM engine. Fully offline, uses installed desktop voices.

`VERIFIED FACT` — **`System.Speech` exists in Windows PowerShell 5.1 only.** It is *not* present in PowerShell 6/7. You must spawn **`powershell.exe`**, never `pwsh`.

**Pros:** runs in the main process; **completely immune to renderer background-throttling**; speaks reliably from the tray; rate (`-10..10`) and volume (`0..100`) controllable; no hidden window needed.

**Cons:**
- `ASSUMPTION` — Cold-spawning `powershell.exe` plus JIT-ing `System.Speech` costs **several hundred ms to ~1–2 s** before first audio. Acceptable for a reminder; poor for interactive speech.
- `RISK (low)` — Narrower voice set. The modern natural Windows 11 voices may not appear.
- `RISK (medium)` — **Command injection surface** if reminder text is interpolated into the command line.

### 3.1 Reconciling with the brief's safety rules

The brief forbids:
> *"Run arbitrary shell commands" · "Run PowerShell commands based on user voice input" · "Execute commands returned by an LLM" · "Run scripts from AI responses"*

Read precisely, every one of those prohibits **user- or model-controlled command construction**. They are about *who authors the command*.

`RECOMMENDATION` — A hardcoded, app-authored, constant script, invoked with a **fixed argv array**, where the reminder text is passed as **data over stdin** and never appears in the command, is a categorically different operation. It is defensible and should be documented as an allowlisted exception (`11-electron-security-architecture.md` §7).

`RECOMMENDATION` — **Prefer `speechSynthesis` anyway, so the argument never has to be had.** Use SAPI only if SPIKE-3 fails.

### 3.2 The safe implementation, if it is needed

```ts
// electron/tts/sapi-tts-service.ts
import { spawn } from 'node:child_process';

// CONSTANT. Contains no interpolation. Reads its input from stdin.
const SCRIPT = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = $env:LIFEOS_TTS_RATE -as [int]
$text = [Console]::In.ReadToEnd()
$s.Speak($text)
`.trim();

export function speakViaSapi(text: string, rate = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],   // fixed argv
      { env: { ...process.env, LIFEOS_TTS_RATE: String(clampRate(rate)) },
        windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });

    child.stdin.end(sanitize(text), 'utf8');   // text is DATA, never code
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`sapi exit ${code}`)));
  });
}

const clampRate = (r: number) => Math.max(-10, Math.min(10, Math.round(r)));
const sanitize  = (t: string) => t.replace(/[ -]/g, ' ').slice(0, 500);
```

Invariants, each individually sufficient to defeat injection:
1. The command string is a **module constant**. No template interpolation, ever.
2. Arguments are passed as an **array**, so no shell parses them. No `shell: true`.
3. Reminder text arrives on **stdin**, where PowerShell treats it as a string, not source.
4. Text is **length-capped and stripped of control characters**.
5. `windowsHide: true` — no console flash.
6. `-NoProfile -NonInteractive` — no user profile scripts, no prompts.

`RISK (accepted)` — This spawns a process. It is the only `child_process` call permitted anywhere in LifeOS, it is guarded by an ESLint rule allowing `child_process` in exactly this file, and it is exercised by a unit test asserting the command string contains no `${`.

## 4. Options eliminated

### edge-tts — **disqualified**

`VERIFIED FACT` — Every `edge-tts` npm package and fork connects to **Microsoft Edge's online TTS WebSocket endpoint**. It is **not offline**. (andresayac/edge-tts, travisvn/edge-tts)

`RISK (critical, reputational)` — Shipping it as the default would mean every spoken reminder silently transmits its text to Microsoft, directly contradicting the product's central promise. **Never use as a default.** `FUTURE OPTION` only as an explicitly-consented online voice, and honestly, ElevenLabs is better if the user is opting into cloud anyway.

### Piper — the near-miss

`VERIFIED FACT` — Local neural VITS→ONNX. Faster than real-time on CPU, no GPU. Genuinely offline and the best-sounding offline option. (https://github.com/rhasspy/piper)

`RISK` — Each voice is a **tens-of-MB ONNX file** plus a JSON config plus the espeak-ng phonemizer. There is **no first-class Node wrapper** — you spawn the `piper` binary. This violates the brief's own criterion *"No additional model download"* and adds ~30–60 MB to an installer that already carries an STT model.

`FUTURE OPTION` — v0.3, as an opt-in "Better voice" download. It is the right answer once the app has earned the right to ask for 50 MB.

### Coqui, ElevenLabs, OpenAI TTS

- Coqui: high CPU, heavy packaging, no clean Node story. Rejected.
- `VERIFIED FACT` — ElevenLabs API: **$0.10 / 1k characters** (Multilingual v2/v3), **$0.05 / 1k** (Flash/Turbo).
- `VERIFIED FACT` — OpenAI: `tts-1` **$15 / 1M chars** ($0.015/1k), `tts-1-hd` **$30 / 1M**, `gpt-4o-mini-tts` token-based.
- Both are cloud and paid. `FUTURE OPTION` — user-supplied key, off by default, same consent flow as AI Assist.

## 5. The provider interface (unchanged from the brief)

```ts
// core/tts/tts-service.ts — no Electron imports
export interface TTSService {
  readonly id: 'web-speech' | 'sapi' | 'piper' | 'elevenlabs' | 'openai';
  readonly isOffline: boolean;

  init(): Promise<void>;
  listVoices(): Promise<TTSVoice[]>;
  speak(text: string, opts?: TTSOptions): Promise<void>;
  cancel(): void;
  dispose(): Promise<void>;
}

export interface TTSVoice   { id: string; name: string; lang: string; isDefault: boolean; }
export interface TTSOptions { voiceId?: string; rate?: number; volume?: number; }
```

```text
TTSService
├── WebSpeechTTSService    ← MVP primary (hidden audio window)
├── SapiTTSService         ← MVP fallback (main process)
├── PiperTTSService        ← future, stub
├── ElevenLabsTTSService   ← future, stub
└── OpenAITTSService       ← future, stub
```

`MVP DECISION` — A `TTSService` failure is **never fatal**. `SpeechCoordinator` catches it, emits one toast ("Yogi couldn't speak — check your Windows voices"), sets `settings.tts_degraded = true`, and the reminder still notifies visibly. A silent reminder is a working reminder.

## 6. MP3 playback (the "sing" action)

Related, and it shares the audio window.

`VERIFIED FACT` — Chromium's autoplay policy makes `audio.play()` reject with `DOMException: play() failed because the user didn't interact with the document first`. The fix, called **before any window is created**:

```ts
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
```
(electron#14323, electron#13525)

`RISK (medium)` — A hidden renderer playing `<audio>` is subject to the same throttling risk as §2.1.

`RISK (low)` — `sound-play` is reported to shell out to PowerShell's MediaPlayer on Windows, which would re-raise both the spawn latency and the shell-policy question. `ASSUMPTION` — the npm page returned HTTP 403 during research, so **this is unverified**. Do not depend on it without checking.

`MVP DECISION` — Play the MP3 from the **same hidden audio window** as speech, via a plain `<audio>` element, with the autoplay switch set. One window, one lifecycle, one throttling question — and SPIKE-3 answers it for both at once.

`FUTURE OPTION` — If SPIKE-3 shows the hidden window is unreliable, move **both** speech and audio to the main process: SAPI for speech, and a native N-API player (e.g. `@thesusheer/node-miniaudio`, which uses MiniAudio with prebuilt binaries and no FFmpeg) for MP3. This is the belt-and-braces configuration: shell-free, throttle-immune, and it deletes the hidden window entirely.

## 7. Where the scheduler must live

`VERIFIED FACT` — The **main process is a plain Node event loop and is never subject to Chromium renderer throttling.**

`MVP DECISION` — Everything time-critical is orchestrated from main. The hidden audio window is an **output device the main process commands**, never a decision-maker. If it dies, the main process recreates it; if it cannot, reminders still notify.

```text
Scheduler tick (main, Node timer — never throttled)
   │
   ├─► new Notification({...}).show()        ← main process. Always works.
   ├─► audioWindow.webContents.send('tts:speak',  {text})   ← best effort
   ├─► audioWindow.webContents.send('audio:play', {file})   ← best effort, if sing
   └─► mainWindow?.webContents.send('reminder:trigger', {…}) ← if window exists
```

Read the arrows: the notification is unconditional; speech and audio are best-effort. That ordering is the whole safety argument.

## 8. SPIKE-3 — acceptance criteria (Day 1, **packaged build**)

**Timebox: 60 minutes.** This spike must run against an installed NSIS build, not `npm run dev` — throttling and toast behaviour differ.

```text
□ Build and install the app via the NSIS installer.
□ Hidden audio window is created with backgroundThrottling:false.
□ `voiceschanged` fires; getVoices() returns ≥ 1 English voice. Log their names.
□ Trigger a reminder 30 seconds out, with the main window VISIBLE.
    → Yogi speaks.
□ Trigger a reminder 30 seconds out, with the window CLOSED TO TRAY.
    → Yogi speaks.                                       ← the actual test
□ Trigger a reminder 10 MINUTES out, close to tray, do not touch the machine.
    → Yogi speaks, on time.                              ← the real test
□ Same 10-minute test, but sleep the laptop for 5 minutes in between.
    → On resume, powerMonitor fires reconcile and Yogi speaks (late but present).
□ MP3 plays from the same hidden window while in tray.
□ Kill the audio window from Task Manager mid-test.
    → Main process recreates it OR the notification still fires. No crash.
```

**On failure of the 10-minute tray test:** switch `TTSService` to `SapiTTSService`, move MP3 playback to a main-process native player, delete the hidden window, and record the decision in `25-risk-register.md`. Budget 90 extra minutes for that switch. Both implementations are behind the same interface, so nothing above the service layer changes.

## 9. Runtime verification to build in

`RECOMMENDATION` — Do not trust either path blindly on a user's machine. On first run, enumerate available voices on the active provider and store the result. Surface it in Settings → Speech:

```text
Text-to-speech voice   [ Microsoft Zira (offline) ▾ ]  [ Preview ]
                       3 offline voices detected
```

If zero voices are found, disable the "Speak reminders aloud" toggle, explain why, and link to *Windows Settings → Time & language → Speech*. The reminder still works. The app never pretends.
