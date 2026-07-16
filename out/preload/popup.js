"use strict";
const electron = require("electron");
const POPUP_SHOW = "popup:show";
const POPUP_ACTION = "popup:action";
const POPUP_MESSAGE = "popup:message";
const CHAT_SEND = "chat:send";
const CHAT_DONE = "chat:done";
const CHAT_SESSION_CREATE = "chat:session:create";
const SPEECH_START = "speech:start";
const SPEECH_STOP = "speech:stop";
const SPEECH_AUDIO = "speech:audio";
const SPEECH_PARTIAL = "speech:partial";
const SPEECH_ERROR = "speech:error";
const TTS_STOP = "tts:stop";
const TTS_SPEAKING = "tts:speaking";
const CHAT_SEARCHING = "chat:searching";
function subscribe(channel, cb) {
  const wrapped = (_e, ...args) => cb(...args);
  electron.ipcRenderer.on(channel, wrapped);
  return () => {
    electron.ipcRenderer.removeListener(channel, wrapped);
  };
}
electron.contextBridge.exposeInMainWorld(
  "lifeosPopup",
  Object.freeze({
    onShow: (cb) => subscribe(POPUP_SHOW, cb),
    action: (payload) => electron.ipcRenderer.invoke(POPUP_ACTION, payload),
    // P2-B: a typed/spoken message → main classifies it as a lifecycle command or a chat turn.
    message: (payload) => electron.ipcRenderer.invoke(POPUP_MESSAGE, payload),
    // P2: the popup is also a chat client — it can talk in the reminder's session and mint one
    // lazily for a null-session reminder. Same async turn model as the main window (matched by turnId).
    chat: {
      send: (text, sessionId) => electron.ipcRenderer.invoke(CHAT_SEND, { text, sessionId }),
      onDone: (cb) => subscribe(CHAT_DONE, cb),
      createSession: () => electron.ipcRenderer.invoke(CHAT_SESSION_CREATE)
    },
    // P2-C: the popup owns the mic while open — same capture path as the main window (speech
    // singleton in main; at most main OR the popup captures at a time).
    speech: {
      start: (sampleRate) => electron.ipcRenderer.invoke(SPEECH_START, sampleRate),
      stop: () => electron.ipcRenderer.invoke(SPEECH_STOP),
      pushAudio: (pcm) => electron.ipcRenderer.send(SPEECH_AUDIO, pcm),
      onPartial: (cb) => subscribe(SPEECH_PARTIAL, cb),
      onError: (cb) => subscribe(SPEECH_ERROR, cb)
    },
    // Voice: stop Yogi speaking, know when it's speaking, and when a web search is in flight.
    tts: {
      stop: () => electron.ipcRenderer.invoke(TTS_STOP),
      onSpeaking: (cb) => subscribe(TTS_SPEAKING, cb)
    },
    onSearching: (cb) => subscribe(CHAT_SEARCHING, cb)
  })
);
