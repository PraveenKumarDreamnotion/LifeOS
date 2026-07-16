/**
 * The hidden audio window's renderer (07 §2.2, 13 §4). Hosts speechSynthesis (Windows voices)
 * and an <audio> element. Commanded by main over the receive-mostly `lifeosAudio` bridge.
 *
 * EP-4 (45, 33 §3.1): adds the `audio:playBytes` path — main hands it OpenAI's MP3 bytes, which
 * become a same-origin `blob:` object URL and play via <audio> (never a path or remote URL). It
 * now honours the chosen voice (`voiceKey` resolved against the OS voices) and reports playback
 * failures back to main via `audio:playbackError` so the coordinator can degrade to Windows.
 */
import { windowsMatchFor } from '../core/tts/voice-catalog';

declare global {
  interface Window {
    lifeosAudio: {
      onSpeak(cb: (p: { text: string; voiceKey?: string; rate?: number }) => void): () => void;
      onPlayBytes(cb: (p: { mime: string; bytes: ArrayBuffer }) => void): () => void;
      onCancel(cb: () => void): () => void;
      onPlay(cb: (p: { file: string }) => void): () => void;
      onStop(cb: () => void): () => void;
      onTtsStart(cb: (p: { mime: string }) => void): () => void;
      onTtsChunk(cb: (bytes: ArrayBuffer) => void): () => void;
      onTtsEnd(cb: () => void): () => void;
      onTtsAbort(cb: () => void): () => void;
      report(e: { code: string; detail?: string }): void;
      reportPlaying(active: boolean): void;
    };
  }
}

/**
 * getVoices() is asynchronously populated and routinely returns [] on the first synchronous
 * call. Waiting for `voiceschanged` is the ONLY reliable pattern. (electron#22844, #11585)
 */
function voicesReady(timeoutMs = 5_000): Promise<SpeechSynthesisVoice[]> {
  const immediate = speechSynthesis.getVoices();
  if (immediate.length) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, timeoutMs);
  });
}

/** Report play/stop so main can broadcast tts:speaking (drives the Stop Speaking button). */
function setPlaying(active: boolean): void {
  window.lifeosAudio.reportPlaying(active);
}
/** Attach play/stop reporting to an <audio> element (both bytes and streaming paths). */
function trackPlayback(el: HTMLAudioElement): void {
  el.addEventListener('playing', () => setPlaying(true));
  el.addEventListener('ended', () => setPlaying(false));
  el.addEventListener('pause', () => setPlaying(false));
  el.addEventListener('error', () => setPlaying(false));
}

async function speak(text: string, opts: { voiceKey?: string; rate?: number }): Promise<void> {
  const voices = await voicesReady().catch(() => []);
  speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(text);
  if (voices.length > 0) {
    const match = opts.voiceKey ? windowsMatchFor(opts.voiceKey) : null;
    u.voice =
      (match ? voices.find((v) => match(v.name, v.lang)) : undefined) ??
      voices.find((v) => v.lang.startsWith('en')) ??
      voices[0]!;
  } else {
    window.lifeosAudio.report({ code: 'no_voices' });
  }

  u.rate = opts.rate ?? 1.0;
  u.onstart = () => setPlaying(true);
  u.onend = () => setPlaying(false);
  u.onerror = () => {
    setPlaying(false);
    window.lifeosAudio.report({ code: 'tts_error' });
  };
  speechSynthesis.speak(u);
}

let audioEl: HTMLAudioElement | null = null;

/** Play a bundled MP3 by filename KEY (never a path — a path from IPC is a file-read primitive). */
function play(file: string): void {
  audioEl?.pause();
  audioEl = new Audio(`./audio/${file}.mp3`);
  trackPlayback(audioEl);
  void audioEl.play().catch(() => {});
}

/** EP-4: play OpenAI's audio bytes as a same-origin blob: URL (33 §3.1). Bytes, never a path. */
function playBytes(mime: string, bytes: ArrayBuffer): void {
  try {
    audioEl?.pause();
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    audioEl = new Audio(url);
    trackPlayback(audioEl);
    const cleanup = () => URL.revokeObjectURL(url); // don't accumulate blobs
    audioEl.addEventListener('ended', cleanup, { once: true });
    audioEl.addEventListener(
      'error',
      () => {
        cleanup();
        window.lifeosAudio.report({ code: 'playback_error' });
      },
      { once: true },
    );
    void audioEl.play().catch(() => {
      cleanup();
      window.lifeosAudio.report({ code: 'playback_error' });
    });
  } catch (e) {
    window.lifeosAudio.report({ code: 'playback_error', detail: String(e) });
  }
}

/**
 * Streaming TTS (55 §TTS latency): main forwards audio chunks as they arrive; we play them
 * incrementally via MediaSource so speech starts on the FIRST bytes, not after the whole clip. If
 * MediaSource can't take this mime, we accumulate and blob-play on end — same result as before,
 * never worse.
 */
let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
const chunkQueue: ArrayBuffer[] = [];
const accumulated: ArrayBuffer[] = []; // fallback buffer (when MSE unsupported)
let streamMime = 'audio/mpeg';
let streamEnded = false;
let usingMse = false;

function resetStream(): void {
  chunkQueue.length = 0;
  accumulated.length = 0;
  streamEnded = false;
  sourceBuffer = null;
  if (mediaSource && mediaSource.readyState === 'open') {
    try {
      mediaSource.endOfStream();
    } catch {
      /* already ended */
    }
  }
  mediaSource = null;
}

function pump(): void {
  if (usingMse && sourceBuffer && !sourceBuffer.updating && chunkQueue.length) {
    try {
      sourceBuffer.appendBuffer(chunkQueue.shift()!);
    } catch {
      /* buffer full / bad frame — drop; the stream still ends cleanly */
    }
  }
  tryEndStream();
}

function tryEndStream(): void {
  if (
    usingMse &&
    streamEnded &&
    !chunkQueue.length &&
    sourceBuffer &&
    !sourceBuffer.updating &&
    mediaSource &&
    mediaSource.readyState === 'open'
  ) {
    try {
      mediaSource.endOfStream();
    } catch {
      /* ignore */
    }
  }
}

function ttsStart(mime: string): void {
  audioEl?.pause();
  resetStream();
  streamMime = mime;
  usingMse = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime);
  if (!usingMse) {
    audioEl = new Audio(); // accumulate; play the blob on ttsEnd (no worse than pre-streaming)
    return;
  }
  mediaSource = new MediaSource();
  audioEl = new Audio();
  trackPlayback(audioEl);
  const url = URL.createObjectURL(mediaSource);
  audioEl.src = url;
  audioEl.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
  audioEl.addEventListener('error', () => window.lifeosAudio.report({ code: 'playback_error' }), { once: true });
  mediaSource.addEventListener(
    'sourceopen',
    () => {
      try {
        sourceBuffer = mediaSource!.addSourceBuffer(streamMime);
        sourceBuffer.addEventListener('updateend', pump);
        pump();
      } catch {
        usingMse = false; // this build can't stream this mime → fall back to blob-on-end
      }
    },
    { once: true },
  );
  void audioEl.play().catch(() => {});
}

function ttsChunk(bytes: ArrayBuffer): void {
  if (usingMse) {
    chunkQueue.push(bytes);
    pump();
  } else {
    accumulated.push(bytes);
  }
}

function ttsEnd(): void {
  streamEnded = true;
  if (usingMse) {
    tryEndStream();
    return;
  }
  // Fallback: play everything as one blob (current behaviour).
  const blob = new Blob(accumulated as BlobPart[], { type: streamMime });
  const url = URL.createObjectURL(blob);
  audioEl = new Audio(url);
  trackPlayback(audioEl);
  audioEl.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
  void audioEl.play().catch(() => {
    URL.revokeObjectURL(url);
    window.lifeosAudio.report({ code: 'playback_error' });
  });
}

function ttsAbort(): void {
  audioEl?.pause();
  resetStream();
  setPlaying(false);
}

window.lifeosAudio.onSpeak(({ text, voiceKey, rate }) => void speak(text, { voiceKey, rate }));
window.lifeosAudio.onPlayBytes(({ mime, bytes }) => playBytes(mime, bytes));
window.lifeosAudio.onCancel(() => {
  speechSynthesis.cancel();
  setPlaying(false);
});
window.lifeosAudio.onPlay(({ file }) => play(file));
window.lifeosAudio.onStop(() => {
  audioEl?.pause();
  setPlaying(false);
});
window.lifeosAudio.onTtsStart(({ mime }) => ttsStart(mime));
window.lifeosAudio.onTtsChunk((bytes) => ttsChunk(bytes));
window.lifeosAudio.onTtsEnd(() => ttsEnd());
window.lifeosAudio.onTtsAbort(() => ttsAbort());

// Warm the voice list so the first reminder isn't the one that discovers an empty getVoices().
void voicesReady();

export {};
