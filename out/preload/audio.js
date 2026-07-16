"use strict";
const electron = require("electron");
function subscribe(channel, cb) {
  const wrapped = (_e, ...args) => cb(...args);
  electron.ipcRenderer.on(channel, wrapped);
  return () => {
    electron.ipcRenderer.removeListener(channel, wrapped);
  };
}
electron.contextBridge.exposeInMainWorld(
  "lifeosAudio",
  Object.freeze({
    onSpeak: (cb) => subscribe("tts:speak", cb),
    onPlayBytes: (cb) => subscribe("audio:playBytes", cb),
    // Streaming TTS (55 §TTS latency): start → chunk* → end, played incrementally via MediaSource.
    onTtsStart: (cb) => subscribe("audio:ttsStart", cb),
    onTtsChunk: (cb) => subscribe("audio:ttsChunk", cb),
    onTtsEnd: (cb) => subscribe("audio:ttsEnd", cb),
    onTtsAbort: (cb) => subscribe("audio:ttsAbort", cb),
    onCancel: (cb) => subscribe("tts:cancel", cb),
    onPlay: (cb) => subscribe("audio:play", cb),
    onStop: (cb) => subscribe("audio:stop", cb),
    // EP-4: the one reverse channel — report a playback failure so main degrades to Windows
    // (wires the previously-dead audio:error, now audio:playbackError; 30 D8, 33 §3.1).
    report: (e) => electron.ipcRenderer.send("audio:playbackError", e),
    // Report whether audio is currently playing, so main can broadcast tts:speaking (Stop button).
    reportPlaying: (active) => electron.ipcRenderer.send("audio:playing", active)
  })
);
