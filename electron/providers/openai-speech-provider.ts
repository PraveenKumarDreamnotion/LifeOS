/**
 * OpenAiSpeechProvider (EP-3, 44) — a BATCH SpeechProvider (33 §2.1): it buffers PCM16 frames in
 * main memory and emits NOTHING during capture (no partials), then at stop() concatenates the
 * buffer into one WAV blob, POSTs it once to /v1/audio/transcriptions, returns the final text, and
 * drops the buffer immediately. This is the streaming-vs-batch resolution from 30 §11.1 made real.
 *
 * Security (32 §3.3, 44 §Security): the key is read from main at call time (getKey), passed to the
 * Authorization header, never logged, never crosses IPC. The audio lives ONLY in this in-memory
 * buffer, bounded by the renderer's 30 s cap / 2 s silence, and is freed on stop() — no disk, ever.
 * Sherpa is the mandatory withFallback backup (33 §5), so any failure degrades to offline.
 */
import type {
  SpeechProvider,
  SpeechSessionId,
  SpeechFinalResult,
  SpeechPartialResult,
  SpeechError,
  SpeechStartOptions,
} from '../../core/speech/speech-provider';

const TRANSCRIBE_TIMEOUT_MS = 15_000;
/** Full gpt-4o-transcribe (not the -mini): lower WER / better language-id than whisper-1 and the
 *  mini tier, for a small cost bump. Overridable via the `stt_model` setting. (Model ids evolve —
 *  this is the current best general transcription model at time of writing.) */
const DEFAULT_MODEL = 'gpt-4o-transcribe';
/** The rate we resample to before upload: Whisper-family models are trained on 16 kHz mono, and
 *  sending native 48 kHz just inflates the upload with no accuracy gain. */
const TARGET_SAMPLE_RATE = 16000;
/** A short domain hint biases the model toward this app's vocabulary (names, "reminder", dates).
 *  Whisper-family `prompt` is a soft steer, capped ~224 tokens — keep it tiny. */
const DEFAULT_PROMPT = 'Yogi assistant. Reminders, contacts, phone numbers, dates, and times.';

export interface OpenAiSpeechOptions {
  /** ISO-639-1 hint (e.g. 'en'). Improves accuracy + latency when the language is known; the app
   *  is English-first. Pass '' / undefined to let the model auto-detect. */
  language?: string;
  /** Vocabulary steer. Defaults to a tiny app-domain hint; a caller may override per session. */
  prompt?: string;
}

/**
 * Resample interleaved-free mono Int16 PCM to 16 kHz. Pure/testable. For downsampling (inputRate ≥
 * 16k, the normal case) it box-filters each output sample over its input window — cheap
 * anti-aliasing that avoids the raw-decimation aliasing 06 §6.3 warned about. For the rare
 * inputRate < 16k it linear-interpolates (no upsample benefit, but keeps the contract total).
 */
export function resampleTo16kMono(pcm: Int16Array, inputRate: number): Int16Array {
  if (inputRate <= 0 || inputRate === TARGET_SAMPLE_RATE || pcm.length === 0) return pcm;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  if (ratio > 1) {
    // Downsample: average the input window under each output sample (box-filter low-pass).
    const outLen = Math.max(1, Math.floor(pcm.length / ratio));
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(pcm.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let n = 0;
      for (let j = start; j < end; j++) {
        sum += pcm[j]!;
        n++;
      }
      out[i] = n ? Math.round(sum / n) : pcm[start] ?? 0;
    }
    return out;
  }
  // Upsample (inputRate < 16k): linear interpolation.
  const outLen = Math.max(1, Math.round(pcm.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(pcm.length - 1, lo + 1);
    const frac = pos - lo;
    out[i] = Math.round(pcm[lo]! * (1 - frac) + pcm[hi]! * frac);
  }
  return out;
}

/** Wrap raw little-endian Int16 PCM (mono) in a minimal 44-byte WAV container. Pure/testable. */
export function pcm16ToWav(pcm: Int16Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bytesPerSample = 2;
  const dataSize = pcm.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // audioFormat = PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // byteRate
  buf.writeUInt16LE(numChannels * bytesPerSample, 32); // blockAlign
  buf.writeUInt16LE(16, 34); // bitsPerSample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i]!, 44 + i * 2);
  return buf;
}

export class OpenAiSpeechProvider implements SpeechProvider {
  readonly id = 'openai' as const;
  readonly supportsPartials = false;
  readonly isOffline = false;
  readonly transport = 'batch' as const;

  private chunks: Int16Array[] = [];
  private sampleRate = 16000;
  private startedAt = 0;
  private errorCb: ((e: SpeechError) => void) | null = null;

  private readonly defaultLanguage: string;
  private readonly defaultPrompt: string;
  /** Per-session overrides from SpeechStartOptions; fall back to the constructor defaults. */
  private language: string;
  private prompt: string;

  constructor(
    private readonly getKey: () => string | null,
    private readonly model: string = DEFAULT_MODEL,
    opts: OpenAiSpeechOptions = {},
  ) {
    this.defaultLanguage = opts.language ?? 'en';
    this.defaultPrompt = opts.prompt ?? DEFAULT_PROMPT;
    this.language = this.defaultLanguage;
    this.prompt = this.defaultPrompt;
  }

  init(): Promise<void> {
    return Promise.resolve();
  }

  start(_session: SpeechSessionId, sampleRate: number, options?: SpeechStartOptions): Promise<void> {
    this.chunks = [];
    this.sampleRate = sampleRate > 0 ? sampleRate : 16000;
    this.startedAt = Date.now();
    // Per-session overrides (33 §2): an explicit language hint wins over the default; extra keywords
    // are appended to the domain prompt as a lightweight vocabulary boost.
    this.language = options?.language ?? this.defaultLanguage;
    this.prompt = options?.keywords?.length
      ? `${this.defaultPrompt} ${options.keywords.join(', ')}`.slice(0, 800)
      : this.defaultPrompt;
    return Promise.resolve();
  }

  /** Batch: just buffer. No per-frame decode, no partial emission (33 §2.1). Copy the frame so a
   *  transferred/neutered ArrayBuffer can't be mutated under us. */
  pushAudio(_session: SpeechSessionId, pcm16: ArrayBuffer): void {
    this.chunks.push(new Int16Array(pcm16.slice(0)));
  }

  async stop(session: SpeechSessionId): Promise<SpeechFinalResult> {
    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    if (total === 0) {
      this.chunks = [];
      return { sessionId: session, text: '', durationMs }; // empty utterance → no wasted call
    }
    const pcm = new Int16Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    this.chunks = []; // drop the audio buffer immediately (44 §Security)

    const key = this.getKey();
    if (!key) {
      this.errorCb?.({ code: 'engine_error', message: 'missing key' });
      throw new Error('no_key'); // withFallback → sherpa (which will yield empty; user repeats)
    }
    // Resample to 16 kHz before upload — smaller payload, Whisper's native rate, no accuracy cost.
    const pcm16k = resampleTo16kMono(pcm, this.sampleRate);
    const text = await this.transcribe(pcm16ToWav(pcm16k, TARGET_SAMPLE_RATE), key);
    return { sessionId: session, text, durationMs };
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

  private async transcribe(wav: Buffer, key: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', this.model);
    form.append('response_format', 'text');
    // Quality steers (44 §quality): a language hint and a tiny domain prompt both cut errors on
    // proper nouns / numbers and reduce silence-hallucination. Sent only when non-empty so
    // auto-detect still works if language is cleared. These params are accepted by whisper-1 and
    // the gpt-4o-transcribe family alike.
    if (this.language) form.append('language', this.language);
    if (this.prompt) form.append('prompt', this.prompt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
    try {
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`openai_transcribe_${res.status}`);
      return (await res.text()).trim();
    } finally {
      clearTimeout(timer);
    }
  }
}
