import { contextBridge, ipcRenderer } from 'electron';
// channels.ts is dependency-free — importing from ipc.ts would pull zod into the
// sandboxed preload bundle, which cannot load npm packages.
import { CH } from '../../core/types/channels';

/**
 * The main-window bridge (16 §4). Named functions only; never expose ipcRenderer or a
 * generic invoke(). Strip the IpcRendererEvent from listener callbacks (event.sender is a
 * privilege-escalation handle). Object.freeze the exposed API.
 *
 * Bundled to a single CommonJS file — a sandboxed preload cannot require() across files.
 */

type Unsubscribe = () => void;

function subscribe(channel: string, cb: (...args: unknown[]) => void): Unsubscribe {
  const wrapped = (_e: unknown, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api = {
  reminders: {
    create: (input: unknown) => ipcRenderer.invoke(CH.REMINDERS_CREATE, input),
    list: () => ipcRenderer.invoke(CH.REMINDERS_LIST),
    get: (id: string) => ipcRenderer.invoke(CH.REMINDERS_GET, id),
    update: (id: string, patch: unknown) => ipcRenderer.invoke(CH.REMINDERS_UPDATE, id, patch),
    delete: (id: string) => ipcRenderer.invoke(CH.REMINDERS_DELETE, id),
    pause: (id: string, paused: boolean) => ipcRenderer.invoke(CH.REMINDERS_PAUSE, id, paused),
    complete: (id: string) => ipcRenderer.invoke(CH.REMINDERS_COMPLETE, id),
    dismiss: (id: string) => ipcRenderer.invoke(CH.REMINDERS_DISMISS, id),
    snooze: (id: string, minutes: number) => ipcRenderer.invoke(CH.REMINDERS_SNOOZE, id, minutes),
    history: (filter: unknown) => ipcRenderer.invoke(CH.REMINDERS_HISTORY, filter),
  },
  settings: {
    get: () => ipcRenderer.invoke(CH.SETTINGS_GET),
    update: (patch: unknown) => ipcRenderer.invoke(CH.SETTINGS_UPDATE, patch),
    resetLocalData: () => ipcRenderer.invoke(CH.SETTINGS_RESET),
    openDataFolder: () => ipcRenderer.invoke(CH.SETTINGS_OPEN_DATA),
    // Write-only from here: the key goes to main once, is encrypted, and never comes back.
    setApiKey: (key: string) => ipcRenderer.invoke(CH.SETTINGS_SET_API_KEY, key),
    clearApiKey: () => ipcRenderer.invoke(CH.SETTINGS_CLEAR_API_KEY),
    validateApiKey: () => ipcRenderer.invoke(CH.SETTINGS_VALIDATE_API_KEY),
  },
  overdue: {
    take: () => ipcRenderer.invoke(CH.OVERDUE_TAKE),
  },
  speech: {
    start: (sampleRate: number) => ipcRenderer.invoke(CH.SPEECH_START, sampleRate),
    stop: () => ipcRenderer.invoke(CH.SPEECH_STOP),
    pushAudio: (pcm: ArrayBuffer) => ipcRenderer.send(CH.SPEECH_AUDIO, pcm),
    onPartial: (cb: (t: string) => void) => subscribe(CH.SPEECH_PARTIAL, cb as never),
    // onFinal removed (30 D8): the final transcript is the return value of speech.stop().
    onError: (cb: (e: unknown) => void) => subscribe(CH.SPEECH_ERROR, cb as never),
  },
  parse: (text: string) => ipcRenderer.invoke(CH.PARSE_REMINDER, text),
  chat: {
    // Starts a turn in a session → { turnId }; the result arrives on chat:done (matched by turnId).
    send: (text: string, sessionId: string) => ipcRenderer.invoke(CH.CHAT_SEND, { text, sessionId }),
    cancel: (turnId: string) => ipcRenderer.invoke(CH.CHAT_CANCEL, turnId),
    // chat:delta is declared for a later token-streaming upgrade; idle this phase (non-streamed).
    onDelta: (cb: (t: string) => void) => subscribe(CH.CHAT_DELTA, cb as never),
    onDone: (cb: (payload: unknown) => void) => subscribe(CH.CHAT_DONE, cb as never),
    onSearching: (cb: (p: { turnId: string }) => void) => subscribe(CH.CHAT_SEARCHING, cb as never),
    // Persistent sessions (CONV): list past chats, start a new one, load a chat's turns, rename.
    listSessions: () => ipcRenderer.invoke(CH.CHAT_SESSIONS_LIST),
    createSession: () => ipcRenderer.invoke(CH.CHAT_SESSION_CREATE),
    turns: (sessionId: string) => ipcRenderer.invoke(CH.CHAT_SESSION_TURNS, sessionId),
    rename: (id: string, title: string) => ipcRenderer.invoke(CH.CHAT_SESSION_RENAME, { id, title }),
    deleteSession: (id: string) => ipcRenderer.invoke(CH.CHAT_SESSION_DELETE, id),
    // Report the open chat so the voice launcher continues this same conversation (continuity).
    setActiveSession: (id: string) => ipcRenderer.invoke(CH.CHAT_ACTIVE_SESSION_SET, id),
    // Real-time sync: a turn STARTED in another window (the launcher) — show it live (reply pending).
    onTurnStarted: (cb: (payload: unknown) => void) => subscribe(CH.CHAT_TURN_STARTED, cb as never),
    // DELIVERY / sync: a fired reminder or a turn from another window landed in a chat.
    onTurnAppended: (cb: (payload: unknown) => void) => subscribe(CH.CHAT_TURN_APPENDED, cb as never),
  },
  action: {
    // Confirm/cancel execute or discard the STORED proposal for a turnId (no action payload).
    confirm: (turnId: string) => ipcRenderer.invoke(CH.ACTION_CONFIRM, turnId),
    cancel: (turnId: string) => ipcRenderer.invoke(CH.ACTION_CANCEL, turnId),
    onExpired: (cb: (payload: unknown) => void) => subscribe(CH.ACTION_EXPIRED, cb as never),
    // EP-7: a proposal resolved by voice in main — settle the card.
    onResolved: (cb: (payload: unknown) => void) => subscribe(CH.ACTION_RESOLVED, cb as never),
  },
  tts: {
    preview: () => ipcRenderer.invoke(CH.TTS_PREVIEW),
    stop: () => ipcRenderer.invoke(CH.TTS_STOP),
    onSpeaking: (cb: (p: { active: boolean }) => void) => subscribe(CH.TTS_SPEAKING, cb as never),
  },
  gmail: {
    // Credentials go in write-only (the secret is encrypted in main, never returned).
    setCredentials: (clientId: string, clientSecret: string) =>
      ipcRenderer.invoke(CH.GMAIL_SET_CREDENTIALS, { clientId, clientSecret }),
    connect: () => ipcRenderer.invoke(CH.GMAIL_CONNECT),
    disconnect: () => ipcRenderer.invoke(CH.GMAIL_DISCONNECT),
    test: () => ipcRenderer.invoke(CH.GMAIL_TEST),
    deleteCache: () => ipcRenderer.invoke(CH.GMAIL_DELETE_CACHE),
    syncNow: () => ipcRenderer.invoke(CH.GMAIL_SYNC_NOW),
    status: () => ipcRenderer.invoke(CH.GMAIL_STATUS_GET),
    onStatusChanged: (cb: (s: unknown) => void) => subscribe(CH.GMAIL_STATUS_CHANGED, cb as never),
    onOpenChat: (cb: (p: { sessionId: string }) => void) => subscribe(CH.GMAIL_OPEN_CHAT, cb as never),
  },
  app: {
    version: () => ipcRenderer.invoke(CH.APP_VERSION),
    onRemindersChanged: (cb: () => void) => subscribe(CH.REMINDERS_CHANGED, cb as never),
    onSettingsChanged: (cb: () => void) => subscribe(CH.SETTINGS_CHANGED, cb as never),
    onSessionsChanged: (cb: () => void) => subscribe(CH.CHAT_SESSIONS_CHANGED, cb as never),
    onReminderTrigger: (cb: (r: unknown) => void) => subscribe(CH.REMINDER_TRIGGER, cb as never),
    onLauncherSessionActivated: (cb: (p: unknown) => void) => subscribe(CH.LAUNCHER_SESSION_ACTIVATED, cb as never),
    // A local "open settings" command asks the main window to switch screens (main → renderer).
    onNavigate: (cb: (screen: string) => void) => subscribe(CH.NAVIGATE, cb as never),
  },
} as const;

contextBridge.exposeInMainWorld('lifeos', Object.freeze(api));
