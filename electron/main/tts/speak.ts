/**
 * The TTS speaking coordinator (EP-4, 45 §Main / 33 §3). One place that turns "speak this text"
 * into the right playback path based on the active provider's `kind`, so both a reminder fire
 * (trigger-sink) and Preview (tts:preview) go through identical logic:
 *
 *   - `in-window` (Windows) → send `tts:speak {text, voiceKey, rate}` to the audio window, which
 *      resolves the friendly voice against its OS voices.
 *   - `audio-bytes` (OpenAI) → `await provider.speak()` in MAIN (network, key stays), then send
 *      `audio:playBytes {mime, bytes}`; on any failure, degrade to the Windows path (`33` §3.2).
 *
 * The friendly voice key is resolved to the OpenAI voice id here; the Windows resolution happens
 * in the audio window (it has the OS voice list). Audio-window channels are string literals to
 * match the existing receive-mostly bridge (`16` §7).
 */
import type { BrowserWindow } from 'electron';
import type { TextToSpeechProvider } from '../../../core/tts/tts-provider';
import { openAiVoiceFor } from '../../../core/tts/voice-catalog';

export interface SpeakRequest {
  aw: BrowserWindow;
  provider: TextToSpeechProvider;
  text: string;
  voiceKey: string;
  rate: number;
  /** Called when a cloud attempt failed and we fell back to Windows (sets tts_degraded). */
  onDegrade?: () => void;
}

export async function speakThroughAudioWindow(req: SpeakRequest): Promise<void> {
  const { aw, provider, text, voiceKey, rate } = req;
  if (aw.isDestroyed() || !text.trim()) return;

  if (provider.kind === 'audio-bytes') {
    const opts = { voiceId: openAiVoiceFor(voiceKey), rate };
    // Preferred: STREAM the audio so playback starts on the first bytes (55 §TTS latency). Only a
    // pre-audio failure (bad key/network before any chunk) falls back to Windows — a mid-stream
    // failure has already played audio, so we don't double-speak.
    if (provider.speakStream) {
      const outcome = await streamToWindow(aw, provider, text, opts);
      if (outcome === 'played') return;
      if (outcome === 'failed-early') req.onDegrade?.(); // → Windows fallback below
      if (outcome === 'failed-mid') return; // partial audio played; don't also speak via Windows
    } else {
      try {
        const result = await provider.speak(text, opts);
        if (result.kind === 'audio-bytes' && !aw.isDestroyed()) {
          aw.webContents.send('audio:playBytes', { mime: result.mime, bytes: result.bytes });
          return;
        }
      } catch {
        req.onDegrade?.(); // cloud failed → fall through to the offline Windows voice
      }
    }
  }

  // in-window (Windows), or the audio-bytes fallback path.
  if (!aw.isDestroyed()) {
    aw.webContents.send('tts:speak', { text, voiceKey, rate });
  }
}

type StreamOutcome = 'played' | 'failed-early' | 'failed-mid';

/** Fetch the streamed audio and forward chunks to the audio window (MediaSource plays as they arrive). */
async function streamToWindow(
  aw: BrowserWindow,
  provider: TextToSpeechProvider,
  text: string,
  opts: { voiceId?: string; rate: number },
): Promise<StreamOutcome> {
  const controller = new AbortController();
  let started = false;
  try {
    const { mime, body } = await provider.speakStream!(text, opts, controller.signal);
    if (aw.isDestroyed()) {
      controller.abort();
      return 'played';
    }
    aw.webContents.send('audio:ttsStart', { mime });
    started = true;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (aw.isDestroyed()) {
        controller.abort();
        return 'played';
      }
      if (value && value.byteLength) aw.webContents.send('audio:ttsChunk', value.slice().buffer);
    }
    if (!aw.isDestroyed()) aw.webContents.send('audio:ttsEnd');
    return 'played';
  } catch {
    controller.abort();
    if (started && !aw.isDestroyed()) aw.webContents.send('audio:ttsAbort');
    return started ? 'failed-mid' : 'failed-early';
  }
}
