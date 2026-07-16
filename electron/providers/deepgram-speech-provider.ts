/**
 * DeepgramSpeechProvider (Track A) — a STREAMING cloud STT provider over Deepgram's realtime
 * WebSocket, proving the realtime-cloud path through the same SpeechProvider seam that Sherpa
 * (in-process streaming) and OpenAI (HTTP batch) satisfy. Interim results become `partial` events;
 * committed (is_final) results accumulate into the transcript returned by stop().
 *
 * The socket is INJECTED (DeepgramSocketFactory) so the connect/stream/close lifecycle is fully
 * unit-testable with a fake, and the runtime default can use `ws` (or a global WebSocket) without
 * this file importing a specific transport. Any connect/stream failure throws so withFallback
 * degrades to offline Sherpa — the same always-present backup every cloud provider gets (33 §5).
 *
 * Runtime prerequisites (documented, validated on a real machine): a Deepgram API key and a
 * WebSocket transport. Audio is sent as raw linear16 PCM at the capture rate Deepgram is told about.
 */
import type {
  SpeechProvider,
  SpeechSessionId,
  SpeechPartialResult,
  SpeechFinalResult,
  SpeechError,
  SpeechStartOptions,
} from '../../core/speech/speech-provider';

/** The minimal socket surface the provider drives — a fake satisfies it in tests; a real adapter
 *  over `ws`/WebSocket satisfies it at runtime. */
export interface DeepgramSocket {
  send(data: ArrayBuffer | string): void;
  close(): void;
}

export interface DeepgramSocketHandlers {
  onOpen: () => void;
  onMessage: (data: string) => void;
  onError: (e: unknown) => void;
  onClose: () => void;
}

export type DeepgramSocketFactory = (url: string, apiKey: string, handlers: DeepgramSocketHandlers) => DeepgramSocket;

const DEFAULT_MODEL = 'nova-3';
const FINALIZE_TIMEOUT_MS = 4000; // wait this long after CloseStream for the last is_final result

/** Build the realtime URL. linear16 mono at the capture rate; interim results + punctuation on. */
export function buildDeepgramUrl(sampleRate: number, model: string, language?: string): string {
  const params = new URLSearchParams({
    model,
    encoding: 'linear16',
    sample_rate: String(sampleRate),
    channels: '1',
    punctuate: 'true',
    interim_results: 'true',
    smart_format: 'true',
  });
  if (language) params.set('language', language);
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

/** Parse one Deepgram message → the transcript + whether it's a committed (final) result.
 *  Tolerant of non-Results frames (Metadata/UtteranceEnd) → returns null. Exported for testing. */
export function parseDeepgramMessage(data: string): { transcript: string; isFinal: boolean } | null {
  try {
    const msg = JSON.parse(data) as {
      type?: string;
      is_final?: boolean;
      channel?: { alternatives?: { transcript?: string }[] };
    };
    if (msg.type && msg.type !== 'Results') return null;
    const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';
    return { transcript, isFinal: !!msg.is_final };
  } catch {
    return null;
  }
}

export class DeepgramSpeechProvider implements SpeechProvider {
  readonly id = 'deepgram' as const;
  readonly supportsPartials = true;
  readonly isOffline = false;
  readonly transport = 'streaming' as const;

  private socket: DeepgramSocket | null = null;
  private open = false;
  private readonly pending: ArrayBuffer[] = []; // frames captured before the socket opened
  private finals: string[] = [];
  private interim = '';
  private startedAt = 0;
  private currentSession: SpeechSessionId = '';
  private partialCb: ((r: SpeechPartialResult) => void) | null = null;
  private errorCb: ((e: SpeechError) => void) | null = null;
  private finalizeResolve: (() => void) | null = null;

  constructor(
    private readonly getKey: () => string | null,
    private readonly socketFactory: DeepgramSocketFactory,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  init(): Promise<void> {
    return Promise.resolve();
  }

  start(session: SpeechSessionId, sampleRate: number, options?: SpeechStartOptions): Promise<void> {
    const key = this.getKey();
    if (!key) return Promise.reject(new Error('no_key')); // → withFallback to sherpa
    this.currentSession = session;
    this.startedAt = Date.now();
    this.finals = [];
    this.interim = '';
    this.open = false;
    this.pending.length = 0;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const url = buildDeepgramUrl(sampleRate > 0 ? sampleRate : 16000, this.model, options?.language);
      try {
        this.socket = this.socketFactory(url, key, {
          onOpen: () => {
            this.open = true;
            for (const f of this.pending) this.socket?.send(f);
            this.pending.length = 0;
            if (!settled) {
              settled = true;
              resolve();
            }
          },
          onMessage: (data) => this.handleMessage(data),
          onError: (e) => {
            this.errorCb?.({ code: 'engine_error', message: String(e) });
            if (!settled) {
              settled = true;
              reject(e instanceof Error ? e : new Error('deepgram_socket_error'));
            }
          },
          onClose: () => {
            this.open = false;
            this.finalizeResolve?.();
          },
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error('deepgram_connect_failed'));
      }
    });
  }

  pushAudio(_session: SpeechSessionId, pcm16: ArrayBuffer): void {
    // Copy so a transferred/neutered buffer can't be mutated under the socket.
    const frame = pcm16.slice(0);
    if (this.open && this.socket) this.socket.send(frame);
    else this.pending.push(frame);
  }

  async stop(session: SpeechSessionId): Promise<SpeechFinalResult> {
    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;
    if (this.socket && this.open) {
      // Ask Deepgram to flush any buffered audio and emit the final result, then wait briefly.
      try {
        this.socket.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        /* ignore — we still resolve with whatever finals we have */
      }
      await this.waitForFinalize();
    }
    this.teardown();
    const text = this.finals.join(' ').replace(/\s+/g, ' ').trim();
    return { sessionId: session, text, durationMs };
  }

  dispose(): Promise<void> {
    this.teardown();
    return Promise.resolve();
  }

  on(event: 'partial', cb: (r: SpeechPartialResult) => void): void;
  on(event: 'error', cb: (e: SpeechError) => void): void;
  on(event: 'partial' | 'error', cb: (arg: never) => void): void {
    if (event === 'partial') this.partialCb = cb as unknown as (r: SpeechPartialResult) => void;
    else this.errorCb = cb as unknown as (e: SpeechError) => void;
  }

  private handleMessage(data: string): void {
    const parsed = parseDeepgramMessage(data);
    if (!parsed) return;
    if (parsed.isFinal) {
      if (parsed.transcript.trim()) this.finals.push(parsed.transcript.trim());
      this.interim = '';
    } else {
      this.interim = parsed.transcript;
    }
    const combined = (this.finals.join(' ') + ' ' + this.interim).replace(/\s+/g, ' ').trim();
    this.partialCb?.({ sessionId: this.currentSession, text: combined });
  }

  private waitForFinalize(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.finalizeResolve = null;
        resolve();
      }, FINALIZE_TIMEOUT_MS);
      (timer as { unref?: () => void }).unref?.();
      this.finalizeResolve = () => {
        clearTimeout(timer);
        this.finalizeResolve = null;
        resolve();
      };
    });
  }

  private teardown(): void {
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
    this.socket = null;
    this.open = false;
    this.pending.length = 0;
  }
}
