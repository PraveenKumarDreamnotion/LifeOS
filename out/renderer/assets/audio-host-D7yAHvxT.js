import { w as windowsMatchFor } from "./voice-catalog-L4w017MW.js";
function voicesReady(timeoutMs = 5e3) {
  const immediate = speechSynthesis.getVoices();
  if (immediate.length) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, timeoutMs);
  });
}
function setPlaying(active) {
  window.lifeosAudio.reportPlaying(active);
}
function trackPlayback(el) {
  el.addEventListener("playing", () => setPlaying(true));
  el.addEventListener("ended", () => setPlaying(false));
  el.addEventListener("pause", () => setPlaying(false));
  el.addEventListener("error", () => setPlaying(false));
}
async function speak(text, opts) {
  const voices = await voicesReady().catch(() => []);
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voices.length > 0) {
    const match = opts.voiceKey ? windowsMatchFor(opts.voiceKey) : null;
    u.voice = (match ? voices.find((v) => match(v.name, v.lang)) : void 0) ?? voices.find((v) => v.lang.startsWith("en")) ?? voices[0];
  } else {
    window.lifeosAudio.report({ code: "no_voices" });
  }
  u.rate = opts.rate ?? 1;
  u.onstart = () => setPlaying(true);
  u.onend = () => setPlaying(false);
  u.onerror = () => {
    setPlaying(false);
    window.lifeosAudio.report({ code: "tts_error" });
  };
  speechSynthesis.speak(u);
}
let audioEl = null;
function play(file) {
  audioEl?.pause();
  audioEl = new Audio(`./audio/${file}.mp3`);
  trackPlayback(audioEl);
  void audioEl.play().catch(() => {
  });
}
function playBytes(mime, bytes) {
  try {
    audioEl?.pause();
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    audioEl = new Audio(url);
    trackPlayback(audioEl);
    const cleanup = () => URL.revokeObjectURL(url);
    audioEl.addEventListener("ended", cleanup, { once: true });
    audioEl.addEventListener(
      "error",
      () => {
        cleanup();
        window.lifeosAudio.report({ code: "playback_error" });
      },
      { once: true }
    );
    void audioEl.play().catch(() => {
      cleanup();
      window.lifeosAudio.report({ code: "playback_error" });
    });
  } catch (e) {
    window.lifeosAudio.report({ code: "playback_error", detail: String(e) });
  }
}
let mediaSource = null;
let sourceBuffer = null;
const chunkQueue = [];
const accumulated = [];
let streamMime = "audio/mpeg";
let streamEnded = false;
let usingMse = false;
function resetStream() {
  chunkQueue.length = 0;
  accumulated.length = 0;
  streamEnded = false;
  sourceBuffer = null;
  if (mediaSource && mediaSource.readyState === "open") {
    try {
      mediaSource.endOfStream();
    } catch {
    }
  }
  mediaSource = null;
}
function pump() {
  if (usingMse && sourceBuffer && !sourceBuffer.updating && chunkQueue.length) {
    try {
      sourceBuffer.appendBuffer(chunkQueue.shift());
    } catch {
    }
  }
  tryEndStream();
}
function tryEndStream() {
  if (usingMse && streamEnded && !chunkQueue.length && sourceBuffer && !sourceBuffer.updating && mediaSource && mediaSource.readyState === "open") {
    try {
      mediaSource.endOfStream();
    } catch {
    }
  }
}
function ttsStart(mime) {
  audioEl?.pause();
  resetStream();
  streamMime = mime;
  usingMse = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(mime);
  if (!usingMse) {
    audioEl = new Audio();
    return;
  }
  mediaSource = new MediaSource();
  audioEl = new Audio();
  trackPlayback(audioEl);
  const url = URL.createObjectURL(mediaSource);
  audioEl.src = url;
  audioEl.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  audioEl.addEventListener("error", () => window.lifeosAudio.report({ code: "playback_error" }), { once: true });
  mediaSource.addEventListener(
    "sourceopen",
    () => {
      try {
        sourceBuffer = mediaSource.addSourceBuffer(streamMime);
        sourceBuffer.addEventListener("updateend", pump);
        pump();
      } catch {
        usingMse = false;
      }
    },
    { once: true }
  );
  void audioEl.play().catch(() => {
  });
}
function ttsChunk(bytes) {
  if (usingMse) {
    chunkQueue.push(bytes);
    pump();
  } else {
    accumulated.push(bytes);
  }
}
function ttsEnd() {
  streamEnded = true;
  if (usingMse) {
    tryEndStream();
    return;
  }
  const blob = new Blob(accumulated, { type: streamMime });
  const url = URL.createObjectURL(blob);
  audioEl = new Audio(url);
  trackPlayback(audioEl);
  audioEl.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  void audioEl.play().catch(() => {
    URL.revokeObjectURL(url);
    window.lifeosAudio.report({ code: "playback_error" });
  });
}
function ttsAbort() {
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
void voicesReady();
