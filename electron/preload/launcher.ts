import { contextBridge, ipcRenderer } from 'electron';

/**
 * Desktop launcher bridge. Channel strings are inlined like popup/audio preloads so Rollup does
 * not create a shared preload chunk that sandboxed renderers cannot require.
 */
const LAUNCHER_BEGIN_LISTENING = 'launcher:beginListening';
const LAUNCHER_STOP_LISTENING = 'launcher:stopListening';
const LAUNCHER_STATE_GET = 'launcher:stateGet';
const LAUNCHER_STATE_CHANGED = 'launcher:stateChanged';
const LAUNCHER_SEND_TRANSCRIPT = 'launcher:sendTranscript';
const LAUNCHER_DISCARD_TRANSCRIPT = 'launcher:discardTranscript';
const LAUNCHER_REVIEW_READY = 'launcher:reviewReady';
const LAUNCHER_HOVER_CHANGED = 'launcher:hoverChanged';
const LAUNCHER_INTERACTIVE = 'launcher:interactive';
const LAUNCHER_ERROR = 'launcher:error';
const LAUNCHER_LIST_SESSIONS = 'launcher:listSessions';
const LAUNCHER_OPEN_CONVERSATION = 'launcher:openConversation';
const CHAT_DONE = 'chat:done';
const CHAT_SEARCHING = 'chat:searching';
const CHAT_SESSION_TURNS = 'chat:session:turns';
const CHAT_TURN_STARTED = 'chat:turn:started';
const CHAT_TURN_APPENDED = 'chat:turn:appended';
const SPEECH_START = 'speech:start';
const SPEECH_STOP = 'speech:stop';
const SPEECH_AUDIO = 'speech:audio';
const SPEECH_PARTIAL = 'speech:partial';
const SPEECH_ERROR = 'speech:error';
const TTS_STOP = 'tts:stop';
const TTS_SPEAKING = 'tts:speaking';

function subscribe(channel: string, cb: (...args: unknown[]) => void): () => void {
  const wrapped = (_e: unknown, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

contextBridge.exposeInMainWorld(
  'lifeosLauncher',
  Object.freeze({
    getState: () => ipcRenderer.invoke(LAUNCHER_STATE_GET),
    onStateChanged: (cb: (p: unknown) => void) => subscribe(LAUNCHER_STATE_CHANGED, cb as never),
    onBeginListening: (cb: (p: { sessionId: string }) => void) => subscribe(LAUNCHER_BEGIN_LISTENING, cb as never),
    onStopListening: (cb: () => void) => subscribe(LAUNCHER_STOP_LISTENING, cb as never),
    sendTranscript: (payload: { sessionId: string; text: string }) => ipcRenderer.invoke(LAUNCHER_SEND_TRANSCRIPT, payload),
    discardTranscript: (payload: { sessionId: string }) => ipcRenderer.invoke(LAUNCHER_DISCARD_TRANSCRIPT, payload),
    reviewReady: (payload: { sessionId: string }) => ipcRenderer.invoke(LAUNCHER_REVIEW_READY, payload),
    hoverChanged: (active: boolean) => ipcRenderer.invoke(LAUNCHER_HOVER_CHANGED, { active }),
    setInteractive: (interactive: boolean) => ipcRenderer.invoke(LAUNCHER_INTERACTIVE, { interactive }),
    setError: (message: string) => ipcRenderer.invoke(LAUNCHER_ERROR, { message }),
    // Chat switcher (Issue 4): list conversations, and jump the launcher to one.
    listSessions: () => ipcRenderer.invoke(LAUNCHER_LIST_SESSIONS),
    openConversation: (sessionId: string) => ipcRenderer.invoke(LAUNCHER_OPEN_CONVERSATION, { sessionId }),
    speech: {
      start: (sampleRate: number) => ipcRenderer.invoke(SPEECH_START, sampleRate),
      stop: () => ipcRenderer.invoke(SPEECH_STOP),
      pushAudio: (pcm: ArrayBuffer) => ipcRenderer.send(SPEECH_AUDIO, pcm),
      onPartial: (cb: (t: string) => void) => subscribe(SPEECH_PARTIAL, cb as never),
      onError: (cb: (e: unknown) => void) => subscribe(SPEECH_ERROR, cb as never),
    },
    tts: {
      stop: () => ipcRenderer.invoke(TTS_STOP),
      onSpeaking: (cb: (p: { active: boolean }) => void) => subscribe(TTS_SPEAKING, cb as never),
    },
    chat: {
      // Load the active conversation's turns so the launcher shows a compact live chat (not just review).
      turns: (sessionId: string) => ipcRenderer.invoke(CHAT_SESSION_TURNS, sessionId),
      onDone: (cb: (payload: unknown) => void) => subscribe(CHAT_DONE, cb as never),
      onSearching: (cb: (payload: unknown) => void) => subscribe(CHAT_SEARCHING, cb as never),
      onTurnStarted: (cb: (payload: unknown) => void) => subscribe(CHAT_TURN_STARTED, cb as never),
      onTurnAppended: (cb: (payload: unknown) => void) => subscribe(CHAT_TURN_APPENDED, cb as never),
    },
  }),
);
