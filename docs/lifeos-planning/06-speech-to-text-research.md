# 06 — Speech-to-Text Research

> **Headline:** The brief's stated direction — *"Use Vosk as the default local/offline speech-to-text engine"* — is **falsified**. The `vosk` npm package cannot install on Node ≥ 18.7 or Electron 22+. The brief invited this finding and asked for a fallback architecture. This document supplies it.
>
> **Label key:** `VERIFIED FACT` · `ASSUMPTION` · `RISK` · `RECOMMENDATION` · `MVP DECISION` · `FUTURE OPTION`

---

## 1. Evaluation matrix

Scored against the brief's criteria. **Bold** = the deciding cell.

| | Vosk (`vosk` npm) | **sherpa-onnx** | transformers.js | whisper.cpp bindings | Web Speech API | OpenAI | Deepgram |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Accuracy (short commands) | Good | Good | Good | Good | n/a | Excellent | Excellent |
| Offline | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Privacy | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Cost | ₹0 | ₹0 | ₹0 | ₹0 | ₹0 | $0.003–0.017/min | $0.0077/min |
| Windows support | Broken | ✅ | ✅ | ⚠️ toolchain | ❌ | ✅ | ✅ |
| **Electron compatibility** | **❌ ffi-napi** | **✅ N-API** | ✅ | ⚠️ | **❌ network err** | ✅ | ✅ |
| CPU | Low | Low | Med–High | Med | — | — | — |
| RAM | ~300 MB | ~250 MB | ~600 MB+ | ~400 MB | — | — | — |
| Latency (partials) | ~200 ms | **~150–300 ms** | 1–3 s pseudo | none | — | ~300 ms | **~150 ms** |
| Installer size | +40 MB | +40–80 MB | +150 MB | +75 MB | 0 | 0 | 0 |
| **Ease of packaging** | **❌** | **✅ prebuilt DLLs** | ✅ no native | ❌ node-gyp | — | ✅ | ✅ |
| Ease of integration | ❌ | ⚠️ audio pipe | **✅ no IPC pipe** | ⚠️ | — | ✅ | ✅ |
| Reliability | ❌ | ✅ | ✅ | ⚠️ | ❌ | ✅ | ✅ |
| **True streaming partials** | ✅ | **✅** | ❌ chunked | ❌ | — | ✅ (realtime) | ✅ |

## 2. Vosk — why it is eliminated

`VERIFIED FACT`
- The official `vosk` npm package is **0.3.39, last published roughly four years ago**. (https://www.npmjs.com/package/vosk)
- It depends on **`ffi-napi`** (4.0.3, last published ~5 years ago), which is **unmaintained**, **does not build or run on Node ≥ 18.7**, and **breaks under Electron 22+**.
  - https://github.com/alphacep/vosk-api/issues/1613
  - https://github.com/alphacep/vosk-api/issues/1962
  - https://github.com/node-ffi-napi/node-ffi-napi/issues/238
- A request for native Electron support (alphacep/vosk-api#598) is **unresolved**.
- Windows build failures are widespread — asm preprocessing, node-gyp, VS toolchain: issues #1227, #1249, #1600.

`RISK (critical)` — The developer's Node is **24.11.1**. Electron 43 bundles **Node 24**. Both are far beyond `ffi-napi`'s ceiling. Attempting the brief's stated direction means the first day is spent on a dead dependency, and the likely outcome is that speech never works.

`VERIFIED FACT` — Vosk models themselves remain excellent and are not the problem: `vosk-model-small-en-us-0.15` is **~40 MB, Apache 2.0, ~300 MB runtime RAM**, WER ~9.85 on librispeech test-clean. (https://alphacephei.com/vosk/models) Vosk also supports **runtime grammar/vocabulary restriction** via a JSON word list, which sharply improves accuracy for a fixed command set — a genuine advantage this plan gives up.

`MVP DECISION` — **Do not use the `vosk` npm package.**

### 2.1 If Vosk is wanted anyway — `vosk-koffi`

`VERIFIED FACT` — A community fork replaces `ffi-napi` with **`koffi`** (a maintained C FFI that ships prebuilt binaries and needs no C++ compiler), explicitly to support **Node 18.7+/Node 22 and Electron on Windows**. (https://www.npmjs.com/package/vosk-koffi, https://koffi.dev/, tracked upstream at alphacep/vosk-api#1652)

`RISK (medium)` — Single maintainer; last publish ~1 year ago. You still supply the Vosk shared library and model yourself.

`FUTURE OPTION` — Adopt `vosk-koffi` **only** to gain Vosk's grammar-restricted command mode, and only after the sherpa path is working. It shares the identical audio pipe, so the swap is cheap.

## 3. Web Speech API — eliminated before it costs an hour

`VERIFIED FACT` — `webkitSpeechRecognition` inside Electron **throws a `network` error**. Electron ships no Google Speech API key and cannot supply one via `process.env.GOOGLE_API_KEY`. Confirmed still failing in **March 2025** in both dev and packaged builds.
- https://github.com/electron/electron/issues/46143
- https://github.com/electron/electron/issues/7749
- https://github.com/electron/electron/issues/24278

It is also not offline, which disqualifies it on privacy grounds regardless.

`MVP DECISION` — **Eliminated.** The brief's caution (*"Do not rely on browser speech recognition… unless it is tested and proven reliable"*) is correct; it has been tested by others and it is not reliable. Not a fallback.

## 4. sherpa-onnx — the recommendation

`VERIFIED FACT`
- `sherpa-onnx` npm **1.13.4**, published within days of this research — **actively maintained**. (https://www.npmjs.com/package/sherpa-onnx)
- It is an **N-API node-addon, not `ffi-napi`** — so it is immune to the entire class of FFI/ABI failures that killed Vosk.
- Official documentation: *"you don't need to pre-install anything including a C/C++ compiler, Python, or CMake"*, and *"on Windows … DLLs are located inside `node_modules` and are found automatically."* (https://k2-fsa.github.io/sherpa/onnx/javascript-api/index.html)
- Requires **Node ≥ 16**.
- Ships **online/streaming Zipformer transducer and CTC** models performing *"streaming speech recognition from a microphone"* with incremental results — **true low-latency partial decoding**, equal to or better than Vosk. (https://github.com/k2-fsa/sherpa-onnx/blob/master/nodejs-addon-examples/README.md)
- Models are permissively licensed and may be **bundled in the installer**.

`RISK (low)` — Their microphone examples use `node-cpal`. We will not use it; the mic lives in the renderer (see §6). The recogniser's streaming API is fed from our own PCM frames.

`RISK (low)` — Windows prebuilt binaries are confirmed by the official Windows install docs. If a future Electron ABI outpaces them, the fallback ladder applies.

`MVP DECISION` — **`sherpa-onnx` is the default local STT provider.**

Recommended model: a **streaming Zipformer transducer English** model (`sherpa-onnx-streaming-zipformer-en-*`). Bundle it under `resources/models/stt/` and reference it via `process.resourcesPath` when packaged.

## 5. Fallback ladder (pre-decided; Day 1 must never stall)

| Rank | Option | Native build? | Partials | Why it's here |
| --- | --- | --- | --- | --- |
| **1** | **sherpa-onnx** | Prebuilt N-API, zero toolchain | True streaming | Lowest offline risk, best live feel |
| **2** | **transformers.js** (Whisper-base ONNX, renderer) | **None whatsoever** | Pseudo, 1–3 s | Zero native modules, **zero IPC audio pipe** |
| 3 | vosk-koffi | Prebuilt koffi | True streaming | Only for grammar-restricted mode |
| 4 | Deepgram Nova-3 / OpenAI realtime | None | True streaming | Opt-in online tier |
| — | ~~`vosk`~~, ~~Web Speech~~, ~~whisper.cpp bindings~~ | | | Eliminated (§2, §3, §7) |

### 5.1 Fallback A — transformers.js

`VERIFIED FACT` — `@huggingface/transformers` runs Whisper (`onnx-community/whisper-base`) fully client-side via onnxruntime-web, offline. v3 added a **WebGPU** backend up to ~100× faster than WASM. (https://huggingface.co/blog/transformersjs-v3)

`VERIFIED FACT` — It works in an Electron renderer in a Web Worker with WASM, but is **slower than native** — one report shows ~1400 ms vs ~400 ms per batch. (huggingface/transformers.js#1336) WebGPU in Electron is GPU/driver-dependent on Windows.

`RISK (medium-high)` — **Whisper is chunk-based, not natively streaming.** "Real-time" means re-transcribing a sliding buffer every N seconds. You get pseudo-partials at 1–3 s latency, not word-by-word. (xenova/transformers.js#405) The model is ~150 MB+ to bundle.

**Its one large advantage:** it needs **no main-process native module and no IPC audio pipe at all.** Everything stays in the renderer. If the sherpa audio pipe becomes a swamp, this is the escape hatch — and it changes the architecture *less* than it appears, because `SpeechService` already abstracts it.

`MVP DECISION` — If SPIKE-2 fails, switch to transformers.js and **accept 1–3 s pseudo-partials**. Update the live-transcript UI to show an animated "Listening…" instead of word-by-word text. The UI spec (`12` §5.2) already requires the layout not to depend on partials existing.

### 5.2 Online tiers (opt-in, never default)

`VERIFIED FACT` — Pricing, July 2026:

| Provider | Model | Price | Streaming partials |
| --- | --- | --- | --- |
| OpenAI | `gpt-4o-mini-transcribe` | $0.003/min | via realtime API |
| OpenAI | `gpt-4o-transcribe` | $0.006/min | via realtime API |
| OpenAI | realtime transcription | ~$0.017/min | ✅ true deltas over WebSocket |
| OpenAI | `whisper-1` (legacy) | $0.006/min | ❌ |
| Deepgram | Nova-3 streaming | $0.0077/min PAYG ($0.0065 Growth) | ✅ **best-in-class interim results** |

Deepgram bills per second and offers **$200 free credit ≈ 433 hours**. `RECOMMENDATION` — if an online tier is ever added, Deepgram Nova-3 is the better live-transcription experience; OpenAI is the better choice if the user already holds an OpenAI key for AI Assist (one key, one account).

`MVP DECISION` — Neither is implemented in the MVP. Both get stub classes so the interface is exercised.

## 6. The audio pipeline — the actual work

This, not model quality, is what consumes the day. It is identical for sherpa-onnx and Vosk.

### 6.1 The mismatch

| | Source | Required |
| --- | --- | --- |
| Location | Renderer (`getUserMedia`) | Main process (native recogniser) |
| Sample rate | 48 kHz (device default) | **16 kHz** |
| Format | Float32 `[-1, 1]` | **Int16 PCM** |
| Channels | Often 2 | **1 (mono)** |

`VERIFIED FACT` — Vosk and sherpa streaming models expect **16 kHz, mono, 16-bit signed linear PCM**. Feeding 44.1/48 kHz without declaring the rate produces garbage. (https://alphacephei.com/vosk/, alphacep/vosk-api#18)

`RISK (medium)` — You may request `getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 }})`, but **the browser is permitted to ignore it**. Always resample defensively and never trust the constraint.

### 6.2 The pipe

```text
┌─ RENDERER ────────────────────────────────────────────────┐
│  getUserMedia({audio:{echoCancellation:true,              │
│                       noiseSuppression:true}})            │
│        │                                                  │
│        ▼                                                  │
│  AudioContext → MediaStreamSource                         │
│        │                                                  │
│        ▼   (ScriptProcessorNode is DEPRECATED — do not)   │
│  AudioWorkletNode "pcm16-downsampler"                     │
│    · accumulate Float32 @48k                              │
│    · linear-interpolate → 16 kHz                          │
│    · clamp & scale → Int16                                │
│    · post 3200-sample (200 ms) frames via port.postMessage│
│        │                                                  │
│        ▼                                                  │
│  window.lifeos.speech.pushAudio(Int16Array.buffer)        │
└────────│──────────────────────────────────────────────────┘
         │  IPC (transferable ArrayBuffer, ~6.4 KB/frame)
┌────────▼─ MAIN ───────────────────────────────────────────┐
│  SherpaOnnxSpeechService                                  │
│    stream.acceptWaveform(16000, float32From(int16))       │
│    while (recognizer.isReady(stream)) recognizer.decode() │
│    partial = recognizer.getResult(stream).text            │
│        │                                                  │
│        ▼  if partial !== lastPartial                      │
│  win.webContents.send('speech:partial', partial)          │
│        │                                                  │
│        ▼  on stop / endpoint detected                     │
│  win.webContents.send('speech:final', text)               │
└───────────────────────────────────────────────────────────┘
```

### 6.3 The AudioWorklet (the one piece worth writing carefully)

```js
// public/worklets/pcm16-downsampler.js  — runs on the audio thread
class Pcm16Downsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.buffer = [];
    this.frameSize = 3200;           // 200 ms @ 16 kHz
  }

  process(inputs) {
    const input = inputs[0]?.[0];    // mono, first channel
    if (!input) return true;

    const ratio = sampleRate / this.targetRate;   // `sampleRate` is a worklet global
    for (let i = 0; i < input.length / ratio; i++) {
      const idx = i * ratio;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, input.length - 1);
      const frac = idx - lo;
      const s = input[lo] * (1 - frac) + input[hi] * frac;   // linear interpolation
      const clamped = Math.max(-1, Math.min(1, s));
      this.buffer.push(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    }

    while (this.buffer.length >= this.frameSize) {
      const frame = Int16Array.from(this.buffer.splice(0, this.frameSize));
      this.port.postMessage(frame.buffer, [frame.buffer]);   // transfer, don't copy
    }
    return true;
  }
}
registerProcessor('pcm16-downsampler', Pcm16Downsampler);
```

`RISK (medium)` — Linear interpolation without a low-pass filter causes aliasing. For 48 k → 16 k (an exact 3:1 ratio) with speech content, this is acceptable and is what most production examples do. If accuracy is poor, **test the resampler against a known-good 16 kHz WAV before blaming the model** (validation V6).

`ASSUMPTION` — 200 ms frames balance IPC overhead against partial-transcript responsiveness. Tune between 100–300 ms in SPIKE-2.

### 6.4 The provider interface (unchanged from the brief)

```ts
// core/speech/speech-service.ts — no Electron imports
export interface SpeechService {
  readonly id: 'sherpa-onnx' | 'transformers-js' | 'vosk-koffi' | 'openai' | 'deepgram';
  readonly supportsPartials: boolean;
  readonly isOffline: boolean;

  init(): Promise<void>;
  start(session: SpeechSessionId): Promise<void>;
  pushAudio(session: SpeechSessionId, pcm16: ArrayBuffer): void;
  stop(session: SpeechSessionId): Promise<SpeechFinalResult>;
  dispose(): Promise<void>;

  on(e: 'partial', cb: (r: SpeechPartialResult) => void): void;
  on(e: 'final',   cb: (r: SpeechFinalResult) => void): void;
  on(e: 'error',   cb: (e: SpeechError) => void): void;
}

export interface SpeechPartialResult { sessionId: string; text: string; }
export interface SpeechFinalResult   { sessionId: string; text: string; confidence?: number; durationMs: number; }
export interface SpeechError         { code: 'no_device'|'permission_denied'|'model_load_failed'|'engine_error'; message: string; }
```

```text
SpeechService
├── SherpaOnnxSpeechService      ← MVP (main process)
├── TransformersJsSpeechService  ← fallback A (renderer; pushAudio is a no-op)
├── VoskKoffiSpeechService       ← fallback B, stub
├── OpenAISpeechService          ← future, stub
└── DeepgramSpeechService        ← future, stub
```

`ASSUMPTION` — `TransformersJsSpeechService` runs in the renderer, so its `pushAudio` is a no-op and the main process merely proxies `start`/`stop`. The interface accommodates both topologies; only the *factory* knows where the implementation lives.

## 7. whisper.cpp Node bindings — considered and rejected

`VERIFIED FACT` — `nodejs-whisper`, `smart-whisper` and `whisper-node` are all **native builds via node-gyp / whisper.cpp compilation**, reintroducing exactly the Windows toolchain risk we are escaping. Output is segment/batch with timestamps; `smart-whisper` emits progress events but **not word-level live streaming**.

`RISK (medium-high)` — Compile-on-Windows friction *and* no true partials. sherpa-onnx is also ONNX/native but **prebuilt**, so it dominates on both axes.

`MVP DECISION` — **Skip.**

## 8. Privacy posture

- `MVP DECISION` — Audio **never leaves the device**. Even when AI Assist is enabled, only the **text transcript** is sent, and only when local parsing confidence is low. This is stated in `22-privacy-policy-and-disclosures.md` and shown in the AI Assist consent modal.
- `MVP DECISION` — Audio frames are **never written to disk**. They exist only in memory, in flight from worklet to recogniser, and are dropped after `stop()`.
- `MVP DECISION` — There is **no wake word and no background listening**. The microphone opens on an explicit button press and closes on stop, on 2 s of silence, or at a 30 s hard cap.
- `MVP DECISION` — Permission is requested **lazily**, on first mic press, not during onboarding, so the OS prompt has an obvious cause.
- `RECOMMENDATION` — Render a visible recording indicator whenever the mic is open. The pulsing `--listening` state in `12` §5.1 serves this purpose and must never be disabled by `prefers-reduced-motion` (swap the pulse for a static dot instead).

## 9. SPIKE-2 — acceptance criteria (Day 1)

**Timebox: 180 minutes.** If the box expires, drop to fallback rank 2 without further debate.

```text
□ `npm i sherpa-onnx-node` completes on a clean Windows machine with NO Visual Studio
  Build Tools, NO Python and NO CMake installed.
□ A streaming Zipformer English model loads in the Electron main process.
□ A hardcoded 16 kHz mono PCM16 WAV of "remind me in five minutes to call my mother",
  fed frame-by-frame, transcribes correctly.        ← proves the ENGINE
□ Live microphone → AudioWorklet → IPC → recogniser produces the same transcript.
                                                     ← proves the PIPE
□ First partial appears < 500 ms after speech onset.
□ Partials update at least twice during a 3-second utterance.
□ Idle RAM with the model loaded < 350 MB.
□ The recogniser is disposed on `stop()` and RAM returns to baseline (no leak
  across 10 start/stop cycles).
```

> Note the third and fourth criteria are separate on purpose. Testing the engine with a **known-good WAV** before touching the microphone isolates resampler bugs from model bugs. Skipping this is the most common way to lose a day here.

**On failure:** switch to `TransformersJsSpeechService`, retitle the live-transcript strip to a "Listening…" animation, and record the decision in `25-risk-register.md`. Do not extend the timebox.
