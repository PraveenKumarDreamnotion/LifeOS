import { contextBridge, ipcRenderer } from 'electron';

/**
 * The reminder popup window's bridge (55). Named functions only; no generic invoke, no
 * ipcRenderer exposed. It can RECEIVE the reminder to show and SEND a lifecycle action
 * (complete/dismiss/snooze) on that reminder. It cannot read the DB or change settings.
 *
 * Channel strings are INLINED (not imported from channels.ts) — like audio.ts. A sandboxed preload
 * cannot require() across files, so if a second preload entry imported channels.ts, Rollup would
 * split it into a shared chunk that every preload require()s → crash → window.lifeos undefined
 * (see [[lifeos-build-gotchas]]). Keeping channels.ts imported by ONLY the main preload avoids that.
 */
const POPUP_SHOW = 'popup:show';
const POPUP_ACTION = 'popup:action';
const POPUP_MESSAGE = 'popup:message';
const CHAT_SEND = 'chat:send';
const CHAT_DONE = 'chat:done';
const CHAT_SESSION_CREATE = 'chat:session:create';
const SPEECH_START = 'speech:start';
const SPEECH_STOP = 'speech:stop';
const SPEECH_AUDIO = 'speech:audio';
const SPEECH_PARTIAL = 'speech:partial';
const SPEECH_ERROR = 'speech:error';
const TTS_STOP = 'tts:stop';
const TTS_SPEAKING = 'tts:speaking';
const CHAT_SEARCHING = 'chat:searching';

function subscribe(channel: string, cb: (...args: unknown[]) => void): () => void {
  const wrapped = (_e: unknown, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

contextBridge.exposeInMainWorld(
  'lifeosPopup',
  Object.freeze({
    onShow: (cb: (data: unknown) => void) => subscribe(POPUP_SHOW, cb as never),
    action: (payload: unknown) => ipcRenderer.invoke(POPUP_ACTION, payload),
    // P2-B: a typed/spoken message → main classifies it as a lifecycle command or a chat turn.
    message: (payload: unknown) => ipcRenderer.invoke(POPUP_MESSAGE, payload),
    // P2: the popup is also a chat client — it can talk in the reminder's session and mint one
    // lazily for a null-session reminder. Same async turn model as the main window (matched by turnId).
    chat: {
      send: (text: string, sessionId: string) => ipcRenderer.invoke(CHAT_SEND, { text, sessionId }),
      onDone: (cb: (payload: unknown) => void) => subscribe(CHAT_DONE, cb as never),
      createSession: () => ipcRenderer.invoke(CHAT_SESSION_CREATE),
    },
    // P2-C: the popup owns the mic while open — same capture path as the main window (speech
    // singleton in main; at most main OR the popup captures at a time).
    speech: {
      start: (sampleRate: number) => ipcRenderer.invoke(SPEECH_START, sampleRate),
      stop: () => ipcRenderer.invoke(SPEECH_STOP),
      pushAudio: (pcm: ArrayBuffer) => ipcRenderer.send(SPEECH_AUDIO, pcm),
      onPartial: (cb: (t: string) => void) => subscribe(SPEECH_PARTIAL, cb as never),
      onError: (cb: (e: unknown) => void) => subscribe(SPEECH_ERROR, cb as never),
    },
    // Voice: stop Yogi speaking, know when it's speaking, and when a web search is in flight.
    tts: {
      stop: () => ipcRenderer.invoke(TTS_STOP),
      onSpeaking: (cb: (p: { active: boolean }) => void) => subscribe(TTS_SPEAKING, cb as never),
    },
    onSearching: (cb: (p: { turnId: string }) => void) => subscribe(CHAT_SEARCHING, cb as never),
  }),
);
