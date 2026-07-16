/**
 * Speech IPC (16 §7). Consolidated onto guard() in EP-1 (30 D4/D5). EP-3 (44): the active STT
 * provider is resolved from current settings on EACH session (live rebind — switching
 * `stt_provider` takes effect on the next dictation, no restart), and `speech:start` returns
 * `supportsPartials` so the renderer adapts (live ticks for sherpa, "Transcribing…" for the
 * OpenAI batch provider). The offline sherpa provider is cached here so its model stays loaded
 * across sessions and serves as the withFallback backup.
 *
 * speech:audio stays a fire-and-forget send with its three guards (origin, size, active session).
 */
import { ipcMain, BrowserWindow } from 'electron';
import { CH } from '../../../core/types/channels';
import { guard, isSenderOurWindow, ValidationError } from './guard';
import { SpeechLoadError } from '../../speech/sherpa-speech-service';
import { SherpaSpeechProvider } from '../../providers/sherpa-speech-provider';
import { shouldCleanTranscript } from '../../../core/speech/transcript-cleanup';
import type { SpeechProvider, SpeechSessionId } from '../../../core/speech/speech-provider';

const MAX_FRAME_BYTES = 64 * 1024; // a 200ms PCM16 @16kHz frame is 6.4KB; 64KB is 10x headroom

export interface SpeechDeps {
  /** Given the cached offline provider (reused as offline primary AND withFallback backup),
   *  return the active provider for this session (sherpa, or OpenAI-batch behind fallback). */
  resolve: (sherpa: () => SpeechProvider) => SpeechProvider;
  /** EP-7: offered the FINAL transcript while a voice-eligible proposal is pending. Returns true if
   *  it consumed the transcript as a yes/no/repeat (so it must NOT also land in the composer). */
  onFinalTranscript?: (text: string) => boolean;
  /** Track A: post-STT cleanup pass. Applied ONLY to dictation that lands in the composer (never the
   *  yes/no voice-confirm path, so confirms stay instant). Best-effort — returns raw on any failure. */
  cleanTranscript?: (raw: string) => Promise<string>;
}

let cachedSherpa: SpeechProvider | null = null;
const getSherpa = (): SpeechProvider => (cachedSherpa ??= new SherpaSpeechProvider());

let provider: SpeechProvider | null = null;
let sessionId: SpeechSessionId = '';
let sessionActive = false;
let sessionCounter = 0;

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

export function registerSpeechHandlers(deps: SpeechDeps): void {
  ipcMain.handle(CH.SPEECH_START, (event, rawRate: unknown) =>
    guard(event, async () => {
      const rate = typeof rawRate === 'number' && rawRate >= 8000 && rawRate <= 192000 ? rawRate : 16000;
      provider = deps.resolve(getSherpa);
      provider.on('partial', (r) => broadcast(CH.SPEECH_PARTIAL, r.text));
      provider.on('error', (e) => broadcast(CH.SPEECH_ERROR, { code: e.code, message: e.message }));
      sessionId = `stt-${++sessionCounter}`;
      try {
        await provider.init();
        await provider.start(sessionId, rate);
      } catch (e) {
        const code = e instanceof SpeechLoadError ? 'model_load_failed' : 'engine_error';
        broadcast(CH.SPEECH_ERROR, { code, message: 'Speech is unavailable. You can still type.' });
        throw new ValidationError(code, 'Speech is unavailable. You can still type.');
      }
      sessionActive = true;
      // The renderer reads this to choose live partials vs a "Transcribing…" spinner (33 §2.1).
      return { started: true, supportsPartials: provider.supportsPartials };
    }),
  );

  ipcMain.handle(CH.SPEECH_STOP, (event) =>
    guard(event, async () => {
      // The invoke return value IS the final transcript. For the batch provider, this is where
      // the single POST resolves; for sherpa it flushes the tail. No SPEECH_FINAL broadcast.
      sessionActive = false;
      if (!provider) return { text: '' };
      const result = await provider.stop(sessionId);
      // EP-7: if a proposal is pending, the matcher in main gets first refusal on the transcript
      // ("yes"/"no"/"repeat"). If it consumed it, return empty so it doesn't also fill the composer.
      const consumed = deps.onFinalTranscript?.(result.text) ?? false;
      if (consumed) return { text: '' };
      // Track A cleanup pass — dictation only (the yes/no path already returned above), best-effort.
      let text = result.text;
      if (deps.cleanTranscript && shouldCleanTranscript(text)) {
        try {
          text = await deps.cleanTranscript(text);
        } catch {
          /* keep the raw transcript — cleanup can never cost a dictation */
        }
      }
      return { text };
    }),
  );

  // Fire-and-forget audio frames. Three guards; silently drop on any failure.
  ipcMain.on(CH.SPEECH_AUDIO, (event, pcm: unknown) => {
    if (!isSenderOurWindow(event.senderFrame)) return;
    if (!(pcm instanceof ArrayBuffer)) return;
    if (pcm.byteLength === 0 || pcm.byteLength > MAX_FRAME_BYTES) return;
    if (!sessionActive || !provider) return;
    try {
      provider.pushAudio(sessionId, pcm);
    } catch {
      /* a decode/buffer error must not crash main; the session simply yields no text */
    }
  });
}

export function disposeSpeech(): void {
  void provider?.dispose();
  void cachedSherpa?.dispose();
  provider = null;
  cachedSherpa = null;
  sessionActive = false;
}
