import { contextBridge, ipcRenderer } from 'electron';

/**
 * The hidden audio window's bridge (16 §7).
 *
 * This window is an OUTPUT DEVICE. It can only RECEIVE commands — it cannot read reminders,
 * write settings, or request a parse. `audio:play` carries a filename KEY, never a path — a path
 * from IPC is a file-read primitive, even from our own window.
 *
 * EP-1 (30 D8): the reverse `audio:ready`/`audio:error` sends are removed — main had no handler
 * for them. EP-4 adds a proper `audio:playbackError` reverse channel alongside `audio:playBytes`.
 */

function subscribe(channel: string, cb: (...args: unknown[]) => void): () => void {
  const wrapped = (_e: unknown, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

contextBridge.exposeInMainWorld(
  'lifeosAudio',
  Object.freeze({
    onSpeak: (cb: (p: { text: string; voiceKey?: string; rate?: number }) => void) => subscribe('tts:speak', cb as never),
    onPlayBytes: (cb: (p: { mime: string; bytes: ArrayBuffer }) => void) => subscribe('audio:playBytes', cb as never),
    // Streaming TTS (55 §TTS latency): start → chunk* → end, played incrementally via MediaSource.
    onTtsStart: (cb: (p: { mime: string }) => void) => subscribe('audio:ttsStart', cb as never),
    onTtsChunk: (cb: (bytes: ArrayBuffer) => void) => subscribe('audio:ttsChunk', cb as never),
    onTtsEnd: (cb: () => void) => subscribe('audio:ttsEnd', cb as never),
    onTtsAbort: (cb: () => void) => subscribe('audio:ttsAbort', cb as never),
    onCancel: (cb: () => void) => subscribe('tts:cancel', cb as never),
    onPlay: (cb: (p: { file: string }) => void) => subscribe('audio:play', cb as never),
    onStop: (cb: () => void) => subscribe('audio:stop', cb as never),
    // EP-4: the one reverse channel — report a playback failure so main degrades to Windows
    // (wires the previously-dead audio:error, now audio:playbackError; 30 D8, 33 §3.1).
    report: (e: { code: string; detail?: string }) => ipcRenderer.send('audio:playbackError', e),
    // Report whether audio is currently playing, so main can broadcast tts:speaking (Stop button).
    reportPlaying: (active: boolean) => ipcRenderer.send('audio:playing', active),
  }),
);
