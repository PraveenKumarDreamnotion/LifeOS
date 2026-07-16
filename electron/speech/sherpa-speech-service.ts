/**
 * SherpaOnnxSpeechService (06 §4) — offline streaming speech-to-text in the MAIN process.
 *
 * The model loads LAZILY on the first session and is disposed after idle, so a user who
 * only types never pays the ~250 MB (13 §11). Audio arrives as Int16 PCM16 @16kHz frames
 * from the renderer's AudioWorklet; here they become a V8-owned Float32Array (never an
 * external buffer — Electron's memory cage forbids those) and feed the recogniser.
 *
 * The package is `sherpa-onnx-node` (the native N-API addon), NOT `sherpa-onnx` (WASM).
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { sttModelDir } from '../main/paths';

/** Encoder threads: use spare cores but cap at 4 and always leave ≥1 for the main thread, so STT
 *  decode (which runs on the main process) can't starve IPC/tray/scheduler on a small machine. */
const SHERPA_THREADS = Math.max(1, Math.min(4, (availableParallelism?.() ?? 4) - 1));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sherpa = any;

export interface SpeechCallbacks {
  onPartial: (text: string) => void;
  // onFinal removed (30 D8): the service never fired it; the final transcript is stop()'s return.
  onError: (code: string, message: string) => void;
}

const IDLE_DISPOSE_MS = 5 * 60_000;
const MODEL_SAMPLE_RATE = 16000;

export class SherpaSpeechService {
  private sherpa: Sherpa | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private recognizer: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stream: any = null;
  private sessionActive = false;
  private segments = '';
  private lastPartial = '';
  private inputSampleRate = 16000; // set per-session from the renderer's AudioContext
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly cb: SpeechCallbacks) {}

  /** Lazily load the addon + model. Throws a coded error the caller surfaces gracefully. */
  private ensureLoaded(): void {
    if (this.recognizer) return;

    const dir = sttModelDir();
    const files = ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt'];
    for (const f of files) {
      if (!existsSync(join(dir, f))) {
        throw new SpeechLoadError(`model file missing: ${f}`);
      }
    }

    try {
      // Required lazily so the addon isn't loaded for type-only or no-voice sessions.
      // (no-require-imports is disabled for this file in eslint.config.js — the native addon
      //  has no ESM entry point.)
      this.sherpa = require('sherpa-onnx-node');
    } catch (e) {
      throw new SpeechLoadError(`failed to load sherpa-onnx-node: ${e}`);
    }

    this.recognizer = new this.sherpa.OnlineRecognizer({
      featConfig: { sampleRate: MODEL_SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(dir, 'encoder.onnx'),
          decoder: join(dir, 'decoder.onnx'),
          joiner: join(dir, 'joiner.onnx'),
        },
        tokens: join(dir, 'tokens.txt'),
        // Parallelise the encoder across cores (was 1 — the lowest-accuracy/most-serial setting).
        // Bounded to keep headroom for the main thread's IPC/scheduler on low-core machines.
        numThreads: SHERPA_THREADS,
        provider: 'cpu',
        debug: 0,
      },
      // modified_beam_search (was greedy_search): materially better WER on this transducer for a
      // small latency cost that stays well under real-time (RTF ~0.07). This is the single biggest
      // offline-quality lever available without swapping the model (06 §decode).
      decodingMethod: 'modified_beam_search',
      maxActivePaths: 4,
      enableEndpoint: 1,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20,
    });
  }

  isSessionActive(): boolean {
    return this.sessionActive;
  }

  /**
   * Begin a session. Returns synchronously; the model loads here (may take ~1 s first time).
   * `inputSampleRate` is the renderer's AudioContext rate (e.g. 48000); sherpa resamples it
   * to the model's 16kHz internally.
   */
  start(inputSampleRate: number): void {
    this.cancelIdleTimer();
    this.ensureLoaded();
    this.stream = this.recognizer.createStream();
    this.segments = '';
    this.lastPartial = '';
    this.inputSampleRate = inputSampleRate > 0 ? inputSampleRate : MODEL_SAMPLE_RATE;
    this.sessionActive = true;
  }

  /** Feed one Int16 PCM frame (at the input sample rate) from the renderer. */
  pushAudio(pcm16: ArrayBuffer): void {
    if (!this.sessionActive || !this.stream) return;

    const int16 = new Int16Array(pcm16);
    const float = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float[i] = int16[i]! / 32768;
    }

    this.stream.acceptWaveform({ samples: float, sampleRate: this.inputSampleRate });
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream);

    const text = this.recognizer.getResult(this.stream).text as string;
    const combined = this.combine(text);
    if (combined !== this.lastPartial) {
      this.lastPartial = combined;
      this.cb.onPartial(combined);
    }

    // Endpoint = a natural pause; segment and continue so a long command isn't lost.
    if (this.recognizer.isEndpoint(this.stream)) {
      if (text.trim()) this.segments += (this.segments ? ' ' : '') + text.trim();
      this.recognizer.reset(this.stream);
    }
  }

  /** End the session, flush, and return the full transcript. */
  stop(): string {
    if (!this.stream) return '';
    // Tail padding flushes the final segment. Keep the same input rate to avoid disturbing
    // the resampler state mid-stream.
    const tail = new Float32Array(Math.round(this.inputSampleRate * 0.4));
    this.stream.acceptWaveform({ samples: tail, sampleRate: this.inputSampleRate });
    while (this.recognizer.isReady(this.stream)) this.recognizer.decode(this.stream);

    const final = this.combine(this.recognizer.getResult(this.stream).text as string).trim();
    this.sessionActive = false;
    this.stream = null;
    this.scheduleIdleDispose();
    return final;
  }

  private combine(current: string): string {
    const c = current.trim();
    return (this.segments + (c ? ' ' + c : '')).trim();
  }

  private scheduleIdleDispose(): void {
    this.cancelIdleTimer();
    this.idleTimer = setTimeout(() => this.dispose(), IDLE_DISPOSE_MS);
    this.idleTimer.unref?.();
  }
  private cancelIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** Release the model (~250 MB). Reloaded lazily on the next start(). */
  dispose(): void {
    this.cancelIdleTimer();
    this.stream = null;
    this.recognizer = null;
    this.sherpa = null;
    this.sessionActive = false;
  }
}

export class SpeechLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechLoadError';
  }
}
