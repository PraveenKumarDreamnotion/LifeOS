/**
 * WhisperCppSpeechProvider (Track A) — an OFFLINE, on-device BATCH provider backed by whisper.cpp
 * through a Node N-API binding (e.g. `smart-whisper`). It gives best-in-class offline WER for users
 * who want higher accuracy than the streaming Zipformer, at the cost of live partials (batch, like
 * the OpenAI provider). Chosen over Python faster-whisper deliberately: this project ships
 * all-N-API / no-admin (sherpa-onnx-node, node:sqlite) and a bundled Python runtime would break that
 * install story.
 *
 * Same lazy-load + fail-safe contract as Sherpa: the native module + GGML model load LAZILY on the
 * first decode, and ANY load/decode failure throws so withFallback degrades to the streaming Sherpa
 * provider (33 §5). The transcribe function is INJECTABLE so the buffering/lifecycle is unit-testable
 * without the native module (which is validated on a real machine with the model present).
 */
import type {
  SpeechProvider,
  SpeechSessionId,
  SpeechFinalResult,
  SpeechPartialResult,
  SpeechError,
  SpeechStartOptions,
} from '../../core/speech/speech-provider';
import { resampleTo16kMono } from './openai-speech-provider';

const MODEL_SAMPLE_RATE = 16000;

/** Transcribe 16 kHz mono float32 [-1,1] audio → text. The default implementation lazy-loads the
 *  native whisper.cpp binding; tests inject a fake. */
export type WhisperTranscribeFn = (pcm16k: Float32Array, language: string) => Promise<string>;

export class WhisperCppSpeechProvider implements SpeechProvider {
  readonly id = 'whisper-cpp' as const;
  readonly supportsPartials = false;
  readonly isOffline = true;
  readonly transport = 'batch' as const;

  private chunks: Int16Array[] = [];
  private sampleRate = 16000;
  private startedAt = 0;
  private language = 'en';
  private errorCb: ((e: SpeechError) => void) | null = null;
  private readonly transcribeFn: WhisperTranscribeFn;

  constructor(modelPath: string, transcribeFn?: WhisperTranscribeFn) {
    this.transcribeFn = transcribeFn ?? makeNativeTranscriber(modelPath);
  }

  init(): Promise<void> {
    return Promise.resolve();
  }

  start(_session: SpeechSessionId, sampleRate: number, options?: SpeechStartOptions): Promise<void> {
    this.chunks = [];
    this.sampleRate = sampleRate > 0 ? sampleRate : MODEL_SAMPLE_RATE;
    this.startedAt = Date.now();
    this.language = options?.language || 'en';
    return Promise.resolve();
  }

  pushAudio(_session: SpeechSessionId, pcm16: ArrayBuffer): void {
    this.chunks.push(new Int16Array(pcm16.slice(0)));
  }

  async stop(session: SpeechSessionId): Promise<SpeechFinalResult> {
    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    if (total === 0) {
      this.chunks = [];
      return { sessionId: session, text: '', durationMs }; // empty utterance → no wasted decode
    }
    const pcm = new Int16Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    this.chunks = [];

    // whisper.cpp wants 16 kHz mono float32 in [-1, 1].
    const pcm16k = resampleTo16kMono(pcm, this.sampleRate);
    const float = new Float32Array(pcm16k.length);
    for (let i = 0; i < pcm16k.length; i++) float[i] = pcm16k[i]! / 32768;

    try {
      const text = (await this.transcribeFn(float, this.language)).trim();
      return { sessionId: session, text, durationMs };
    } catch (e) {
      this.errorCb?.({ code: 'engine_error', message: String(e) });
      throw e instanceof Error ? e : new Error('whisper_cpp_failed'); // → withFallback to sherpa
    }
  }

  dispose(): Promise<void> {
    this.chunks = [];
    return Promise.resolve();
  }

  on(event: 'partial', cb: (r: SpeechPartialResult) => void): void;
  on(event: 'error', cb: (e: SpeechError) => void): void;
  on(event: 'partial' | 'error', cb: (arg: never) => void): void {
    // Batch emits no partials; only the error hook is retained.
    if (event === 'error') this.errorCb = cb as unknown as (e: SpeechError) => void;
  }
}

/**
 * The default native transcriber: lazily loads the whisper.cpp N-API binding and the GGML model on
 * first use. Kept in a factory so a load failure surfaces as a rejected decode (→ withFallback),
 * exactly like Sherpa's SpeechLoadError path. Validated on a real machine with the model present.
 */
function makeNativeTranscriber(modelPath: string): WhisperTranscribeFn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let whisper: any = null;
  return async (pcm16k: Float32Array, language: string): Promise<string> => {
    if (!whisper) {
      // Lazy require — the native addon has no ESM entry and must not load for type-only sessions.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const { Whisper } = require('smart-whisper');
      whisper = new Whisper(modelPath);
    }
    const task = await whisper.transcribe(pcm16k, { language });
    const segments: { text: string }[] = await task.result;
    return segments.map((s) => s.text).join(' ');
  };
}
