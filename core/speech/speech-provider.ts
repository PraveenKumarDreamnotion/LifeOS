/**
 * SpeechProvider (STT) interface — the seam that lets the app swap STT engines without the
 * rest of the code knowing which is active (33 §2). Pure: no electron/node imports.
 *
 * EP-1 ships one implementation (SherpaSpeechProvider, offline streaming). Cloud batch/realtime
 * providers (OpenAI, Deepgram) land in later phases behind this same interface. The `transport`
 * + `supportsPartials` fields exist precisely so a batch provider (no live partials) can satisfy
 * the contract without an `onPartial` analog — the UI reads `supportsPartials` and adapts (33 §2.1).
 *
 * Note: the dead `on('final')` event from the old design is deliberately NOT here (30 D8) — the
 * final transcript is the return value of stop().
 */

export type SpeechProviderId =
  | 'sherpa-onnx'
  | 'whisper-cpp'
  | 'openai'
  | 'deepgram'
  | 'assemblyai'
  | 'speechmatics'
  | 'transformers-js';

export type SpeechSessionId = string;

/**
 * Per-session capture/recognition hints (33 §2). Optional so a provider that needs none (Sherpa
 * today) ignores it, while engines with richer knobs — a language hint, custom-vocabulary boosting
 * (Deepgram keywords / AssemblyAI word_boost), diarization — read what they support and drop the
 * rest. This is the typed channel that replaces smuggling config through constructors, so adding a
 * provider that needs language/keywords doesn't change any call site.
 */
export interface SpeechStartOptions {
  /** ISO-639-1 language hint (e.g. 'en'); omit/'' for auto-detect. */
  language?: string;
  /** Domain vocabulary to bias toward (proper nouns, product names) — provider maps to its own
   *  keyword/boost mechanism; ignored by engines without one. */
  keywords?: string[];
}

export interface SpeechPartialResult {
  sessionId: SpeechSessionId;
  text: string;
}

export interface SpeechFinalResult {
  sessionId: SpeechSessionId;
  text: string;
  confidence?: number;
  durationMs: number;
}

export interface SpeechError {
  code: 'no_device' | 'permission_denied' | 'model_load_failed' | 'engine_error';
  message: string;
}

export interface SpeechProvider {
  readonly id: SpeechProviderId;
  /** streaming providers emit `partial` events; batch providers do not (33 §2.1). */
  readonly supportsPartials: boolean;
  /** true = runs on-device, never sends audio off the machine. */
  readonly isOffline: boolean;
  /** 'streaming' = per-frame decode with partials; 'batch' = buffer → one request at stop(). */
  readonly transport: 'streaming' | 'batch';

  init(): Promise<void>;
  /** `options` is optional and additive — existing callers pass just (session, sampleRate). */
  start(session: SpeechSessionId, sampleRate: number, options?: SpeechStartOptions): Promise<void>;
  /** batch providers buffer this internally and emit nothing until stop(). */
  pushAudio(session: SpeechSessionId, pcm16: ArrayBuffer): void;
  /** the final transcript ALWAYS comes from here, for both streaming and batch providers. */
  stop(session: SpeechSessionId): Promise<SpeechFinalResult>;
  dispose(): Promise<void>;

  on(event: 'partial', cb: (r: SpeechPartialResult) => void): void;
  on(event: 'error', cb: (e: SpeechError) => void): void;
}
