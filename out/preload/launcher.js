"use strict";
const electron = require("electron");
const LAUNCHER_BEGIN_LISTENING = "launcher:beginListening";
const LAUNCHER_STOP_LISTENING = "launcher:stopListening";
const LAUNCHER_STATE_GET = "launcher:stateGet";
const LAUNCHER_STATE_CHANGED = "launcher:stateChanged";
const LAUNCHER_SEND_TRANSCRIPT = "launcher:sendTranscript";
const LAUNCHER_DISCARD_TRANSCRIPT = "launcher:discardTranscript";
const LAUNCHER_REVIEW_READY = "launcher:reviewReady";
const LAUNCHER_HOVER_CHANGED = "launcher:hoverChanged";
const LAUNCHER_INTERACTIVE = "launcher:interactive";
const LAUNCHER_ERROR = "launcher:error";
const LAUNCHER_LIST_SESSIONS = "launcher:listSessions";
const LAUNCHER_OPEN_CONVERSATION = "launcher:openConversation";
const CHAT_DONE = "chat:done";
const CHAT_SEARCHING = "chat:searching";
const CHAT_SESSION_TURNS = "chat:session:turns";
const CHAT_TURN_STARTED = "chat:turn:started";
const CHAT_TURN_APPENDED = "chat:turn:appended";
const SPEECH_START = "speech:start";
const SPEECH_STOP = "speech:stop";
const SPEECH_AUDIO = "speech:audio";
const SPEECH_PARTIAL = "speech:partial";
const SPEECH_ERROR = "speech:error";
const TTS_STOP = "tts:stop";
const TTS_SPEAKING = "tts:speaking";
function subscribe(channel, cb) {
  const wrapped = (_e, ...args) => cb(...args);
  electron.ipcRenderer.on(channel, wrapped);
  return () => {
    electron.ipcRenderer.removeListener(channel, wrapped);
  };
}
electron.contextBridge.exposeInMainWorld(
  "lifeosLauncher",
  Object.freeze({
    getState: () => electron.ipcRenderer.invoke(LAUNCHER_STATE_GET),
    onStateChanged: (cb) => subscribe(LAUNCHER_STATE_CHANGED, cb),
    onBeginListening: (cb) => subscribe(LAUNCHER_BEGIN_LISTENING, cb),
    onStopListening: (cb) => subscribe(LAUNCHER_STOP_LISTENING, cb),
    sendTranscript: (payload) => electron.ipcRenderer.invoke(LAUNCHER_SEND_TRANSCRIPT, payload),
    discardTranscript: (payload) => electron.ipcRenderer.invoke(LAUNCHER_DISCARD_TRANSCRIPT, payload),
    reviewReady: (payload) => electron.ipcRenderer.invoke(LAUNCHER_REVIEW_READY, payload),
    hoverChanged: (active) => electron.ipcRenderer.invoke(LAUNCHER_HOVER_CHANGED, { active }),
    setInteractive: (interactive) => electron.ipcRenderer.invoke(LAUNCHER_INTERACTIVE, { interactive }),
    setError: (message) => electron.ipcRenderer.invoke(LAUNCHER_ERROR, { message }),
    // Chat switcher (Issue 4): list conversations, and jump the launcher to one.
    listSessions: () => electron.ipcRenderer.invoke(LAUNCHER_LIST_SESSIONS),
    openConversation: (sessionId) => electron.ipcRenderer.invoke(LAUNCHER_OPEN_CONVERSATION, { sessionId }),
    speech: {
      start: (sampleRate) => electron.ipcRenderer.invoke(SPEECH_START, sampleRate),
      stop: () => electron.ipcRenderer.invoke(SPEECH_STOP),
      pushAudio: (pcm) => electron.ipcRenderer.send(SPEECH_AUDIO, pcm),
      onPartial: (cb) => subscribe(SPEECH_PARTIAL, cb),
      onError: (cb) => subscribe(SPEECH_ERROR, cb)
    },
    tts: {
      stop: () => electron.ipcRenderer.invoke(TTS_STOP),
      onSpeaking: (cb) => subscribe(TTS_SPEAKING, cb)
    },
    chat: {
      // Load the active conversation's turns so the launcher shows a compact live chat (not just review).
      turns: (sessionId) => electron.ipcRenderer.invoke(CHAT_SESSION_TURNS, sessionId),
      onDone: (cb) => subscribe(CHAT_DONE, cb),
      onSearching: (cb) => subscribe(CHAT_SEARCHING, cb),
      onTurnStarted: (cb) => subscribe(CHAT_TURN_STARTED, cb),
      onTurnAppended: (cb) => subscribe(CHAT_TURN_APPENDED, cb)
    }
  })
);
