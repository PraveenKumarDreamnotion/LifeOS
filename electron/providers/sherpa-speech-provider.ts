/**
 * SherpaSpeechProvider — wraps the existing SherpaSpeechService (main-process, offline
 * streaming STT) to satisfy the SpeechProvider seam (33 §2). This is the only concrete
 * STT provider EP-1 ships; the cloud batch provider (OpenAI) lands in EP-3 behind the same
 * interface. Behaviour is unchanged from v0.1 — this is a faithful adapter, not a rewrite.
 */
import { SherpaSpeechService } from '../speech/sherpa-speech-service';
import type {
  SpeechProvider,
  SpeechSessionId,
  SpeechPartialResult,
  SpeechFinalResult,
  SpeechError,
  SpeechStartOptions,
} from '../../core/speech/speech-provider';

const KNOWN_CODES = ['no_device', 'permission_denied', 'model_load_failed', 'engine_error'] as const;
function mapCode(code: string): SpeechError['code'] {
  return (KNOWN_CODES as readonly string[]).includes(code) ? (code as SpeechError['code']) : 'engine_error';
}

export class SherpaSpeechProvider implements SpeechProvider {
  readonly id = 'sherpa-onnx' as const;
  readonly supportsPartials = true;
  readonly isOffline = true;
  readonly transport = 'streaming' as const;

  private readonly service: SherpaSpeechService;
  private partialCb: ((r: SpeechPartialResult) => void) | null = null;
  private errorCb: ((e: SpeechError) => void) | null = null;
  private currentSession: SpeechSessionId = '';
  private startedAt = 0;

  constructor() {
    this.service = new SherpaSpeechService({
      onPartial: (text) => this.partialCb?.({ sessionId: this.currentSession, text }),
      onError: (code, message) => this.errorCb?.({ code: mapCode(code), message }),
    });
  }

  init(): Promise<void> {
    return Promise.resolve();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  start(session: SpeechSessionId, sampleRate: number, _options?: SpeechStartOptions): Promise<void> {
    // Sherpa's streaming transducer takes no per-session language/keyword hints — options ignored.
    this.currentSession = session;
    this.startedAt = Date.now();
    this.service.start(sampleRate);
    return Promise.resolve();
  }

  pushAudio(_session: SpeechSessionId, pcm16: ArrayBuffer): void {
    this.service.pushAudio(pcm16);
  }

  stop(session: SpeechSessionId): Promise<SpeechFinalResult> {
    const text = this.service.stop();
    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;
    this.currentSession = '';
    return Promise.resolve({ sessionId: session, text, durationMs });
  }

  dispose(): Promise<void> {
    this.service.dispose();
    return Promise.resolve();
  }

  /** True only while a session is live — used by the speech IPC guard (memory-exhaustion wall). */
  isSessionActive(): boolean {
    return this.service.isSessionActive();
  }

  on(event: 'partial', cb: (r: SpeechPartialResult) => void): void;
  on(event: 'error', cb: (e: SpeechError) => void): void;
  on(event: 'partial' | 'error', cb: (arg: never) => void): void {
    if (event === 'partial') this.partialCb = cb as unknown as (r: SpeechPartialResult) => void;
    else this.errorCb = cb as unknown as (e: SpeechError) => void;
  }
}
