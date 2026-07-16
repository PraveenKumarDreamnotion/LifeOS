/**
 * OpenAiTtsProvider (EP-4, 45) — a `kind:'audio-bytes'` TextToSpeechProvider (33 §3). `speak()`
 * POSTs to /v1/audio/speech in MAIN with the key, and returns the MP3 bytes; the caller
 * (trigger-sink / preview) hands them to the audio window via the new audio:playBytes path — the
 * bytes never touch disk and the key never crosses IPC (32 §3.3, 33 §3.1). 10 s timeout; the
 * response is size-capped ≤ 2 MB before it can be sent. An unknown voice id degrades to 'alloy'.
 */
import type {
  TextToSpeechProvider,
  TtsOptions,
  TtsSpeakResult,
  TtsVoice,
} from '../../core/tts/tts-provider';
import type { OpenAiVoiceId } from '../../core/tts/voice-catalog';

const SPEAK_TIMEOUT_MS = 10_000;
export const MAX_TTS_BYTES = 2 * 1024 * 1024; // 2 MB per utterance (33 §3.1)
const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const KNOWN_VOICES: OpenAiVoiceId[] = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

function normalizeVoice(voiceId: string | undefined): OpenAiVoiceId {
  return (KNOWN_VOICES as string[]).includes(voiceId ?? '') ? (voiceId as OpenAiVoiceId) : 'alloy';
}
function clampSpeed(rate: number | undefined): number {
  const r = rate ?? 1.0;
  return Math.max(0.25, Math.min(4.0, r));
}

export class OpenAiTtsProvider implements TextToSpeechProvider {
  readonly id = 'openai' as const;
  readonly isOffline = false;
  readonly kind = 'audio-bytes' as const;

  constructor(
    private readonly getKey: () => string | null,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  init(): Promise<void> {
    return Promise.resolve();
  }

  listVoices(): Promise<TtsVoice[]> {
    // The Voice picker uses the friendly catalog (35) directly; nothing consumes this in EP-4.
    return Promise.resolve([]);
  }

  async speak(text: string, opts?: TtsOptions): Promise<TtsSpeakResult> {
    const key = this.getKey();
    if (!key) throw new Error('no_key');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SPEAK_TIMEOUT_MS);
    try {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: text,
          voice: normalizeVoice(opts?.voiceId),
          response_format: 'mp3',
          speed: clampSpeed(opts?.rate),
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`openai_tts_${res.status}`);
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength > MAX_TTS_BYTES) throw new Error('tts_oversize'); // reject before it can play
      return { kind: 'audio-bytes', mime: 'audio/mpeg', bytes };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Streaming variant (55 §TTS latency). /v1/audio/speech returns a chunked audio response; we hand
   * the body stream up so the coordinator can play chunks as they arrive (time-to-first-audio drops
   * from "whole clip generated" to "first bytes"). Same request as speak(); no full-download await.
   */
  async speakStream(text: string, opts: TtsOptions, signal: AbortSignal): Promise<{ mime: string; body: ReadableStream<Uint8Array> }> {
    const key = this.getKey();
    if (!key) throw new Error('no_key');
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: text,
        voice: normalizeVoice(opts.voiceId),
        response_format: 'mp3',
        speed: clampSpeed(opts.rate),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`openai_tts_${res.status}`);
    if (!res.body) throw new Error('tts_no_body');
    return { mime: 'audio/mpeg', body: res.body as ReadableStream<Uint8Array> };
  }

  cancel(): void {
    // Cancellation of an in-flight POST is handled by the caller replacing the utterance; no state.
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
