"use strict";
const electron = require("electron");
const CH = {
  REMINDERS_CREATE: "reminders:create",
  REMINDERS_LIST: "reminders:list",
  REMINDERS_GET: "reminders:get",
  REMINDERS_UPDATE: "reminders:update",
  REMINDERS_DELETE: "reminders:delete",
  REMINDERS_PAUSE: "reminders:pause",
  REMINDERS_HISTORY: "reminders:history",
  REMINDERS_COMPLETE: "reminders:complete",
  REMINDERS_DISMISS: "reminders:dismiss",
  REMINDERS_SNOOZE: "reminders:snooze",
  REMINDERS_CHANGED: "reminders:changed",
  // broadcast, main → renderer
  SETTINGS_CHANGED: "settings:changed",
  // broadcast, main → renderer
  REMINDER_TRIGGER: "reminder:trigger",
  // broadcast, main → renderer
  NAVIGATE: "app:navigate",
  // broadcast, main → main-window renderer (local "open settings" command)
  OVERDUE_TAKE: "overdue:take",
  // pull: renderer fetches + clears the startup overdue list
  PARSE_REMINDER: "parse:reminder",
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",
  SETTINGS_RESET: "settings:resetLocalData",
  SETTINGS_OPEN_DATA: "settings:openDataFolder",
  // API key (EP-1): write-only from the renderer's view — no getter exists. The key never
  // crosses IPC in readable form; the store encrypts/decrypts only in main (30 §13.6).
  SETTINGS_SET_API_KEY: "settings:setApiKey",
  SETTINGS_CLEAR_API_KEY: "settings:clearApiKey",
  SETTINGS_VALIDATE_API_KEY: "settings:validateApiKey",
  APP_VERSION: "app:version",
  // Gmail integration (docs/lifeos-planning/gmail-integration.md). Credentials/tokens are handled
  // ONLY in main; the renderer sends the Client ID/Secret once (write-only) and receives back a
  // safe status (connected + email + counts), never a token.
  GMAIL_SET_CREDENTIALS: "gmail:setCredentials",
  // { clientId, clientSecret }
  GMAIL_CONNECT: "gmail:connect",
  // starts the loopback OAuth flow; returns { emailAddress }
  GMAIL_DISCONNECT: "gmail:disconnect",
  // server-side revoke + local wipe
  GMAIL_TEST: "gmail:test",
  // Test Connection
  GMAIL_DELETE_CACHE: "gmail:deleteCache",
  // Delete Local Email Cache
  GMAIL_SYNC_NOW: "gmail:syncNow",
  // manual sync trigger
  GMAIL_STATUS_GET: "gmail:status:get",
  // safe status snapshot for the Settings section
  GMAIL_STATUS_CHANGED: "gmail:status",
  // broadcast, main → renderer (connect/disconnect/sync)
  GMAIL_OPEN_CHAT: "gmail:openChat",
  // broadcast, main → renderer — { sessionId } (Phase 3: open an email's chat)
  CHAT_SESSIONS_CHANGED: "chat:sessionsChanged",
  // broadcast, main → renderer — refresh the chat sidebar
  // Conversation. EP-5: chat:send starts a turn and returns { turnId }; the result arrives on the
  // chat:done broadcast (reusing the ShellTurn shape). chat:cancel aborts an in-flight turn.
  // chat:delta is declared for a later token-streaming upgrade and stays idle this phase
  // (EP-5 uses the non-streamed complete() — 46 §Risk).
  CHAT_SEND: "chat:send",
  CHAT_CANCEL: "chat:cancel",
  // Persistent chat sessions (CONV). List past chats, start a new one, load a chat's turns to
  // resume it, rename.
  CHAT_SESSIONS_LIST: "chat:sessions:list",
  CHAT_SESSION_CREATE: "chat:session:create",
  CHAT_SESSION_TURNS: "chat:session:turns",
  CHAT_SESSION_RENAME: "chat:session:rename",
  CHAT_SESSION_DELETE: "chat:session:delete",
  // DELIVERY: a fired reminder was delivered into its chat. { sessionId, turn }. The renderer
  // live-appends it IFF that chat is currently open; otherwise it's there on reopen.
  CHAT_TURN_APPENDED: "chat:turn:appended",
  // broadcast, main → renderer
  // Real-time cross-window conversation sync. A turn STARTED (user text known, reply pending) is
  // mirrored to every OTHER window so both the main chat and the launcher show one live conversation
  // (the originating window shows its own turn through its own optimistic UI, so it's excluded).
  CHAT_TURN_STARTED: "chat:turn:started",
  // broadcast (except sender), main → renderers — { sessionId, turnId, userText }
  // The single active-conversation pointer shared by the main window and the voice launcher. The
  // main window reports its open chat here (invoke, renderer → main) so the launcher continues that
  // SAME conversation instead of starting a new one each time (conversation continuity).
  CHAT_ACTIVE_SESSION_SET: "chat:activeSessionSet",
  // invoke, popup → main (typed/spoken: lifecycle-or-chat, P2-B)
  CHAT_DELTA: "chat:delta",
  // broadcast, main → renderer (idle until streaming lands)
  CHAT_DONE: "chat:done",
  // broadcast, main → renderer — { turnId, reply, parse, proposal? }
  CHAT_SEARCHING: "chat:searching",
  // broadcast, main → renderer — { turnId } (web search in flight)
  // TTS control: main broadcasts whether Yogi is currently speaking; a renderer can stop it.
  TTS_SPEAKING: "tts:speaking",
  // broadcast, main → renderer — { active: boolean }
  TTS_STOP: "tts:stop",
  // invoke, renderer → main — stop all current speech immediately
  // Action Dispatcher (EP-6). confirm/cancel execute/discard the STORED pending proposal for a
  // turnId (the renderer never submits an action payload — 36 §4.3). action:expired tells the
  // renderer a pending proposal timed out (fails safe: expiry = cancel).
  ACTION_CONFIRM: "action:confirm",
  ACTION_CANCEL: "action:cancel",
  ACTION_EXPIRED: "action:expired",
  // broadcast, main → renderer
  // EP-7: a proposal was resolved BY VOICE in main (the matcher drove confirm/cancel), so the
  // renderer must settle the card it can't see resolve. { turnId, status, summary? }.
  ACTION_RESOLVED: "action:resolved",
  // broadcast, main → renderer
  // Voice preview (EP-4): speak the sample line through the active TTS provider+voice+rate.
  TTS_PREVIEW: "tts:preview",
  // Speech (Day 5)
  SPEECH_START: "speech:start",
  SPEECH_STOP: "speech:stop",
  SPEECH_AUDIO: "speech:audio",
  // send (renderer → main), high-frequency PCM frames
  SPEECH_PARTIAL: "speech:partial",
  // broadcast
  // SPEECH_FINAL removed (30 D8): the final transcript is the return value of speech:stop; the
  // broadcast was dead plumbing that risked a double-apply.
  SPEECH_ERROR: "speech:error",
  // broadcast, main -> launcher/renderers
  LAUNCHER_SESSION_ACTIVATED: "launcher:sessionActivated"
};
function subscribe(channel, cb) {
  const wrapped = (_e, ...args) => cb(...args);
  electron.ipcRenderer.on(channel, wrapped);
  return () => {
    electron.ipcRenderer.removeListener(channel, wrapped);
  };
}
const api = {
  reminders: {
    create: (input) => electron.ipcRenderer.invoke(CH.REMINDERS_CREATE, input),
    list: () => electron.ipcRenderer.invoke(CH.REMINDERS_LIST),
    get: (id) => electron.ipcRenderer.invoke(CH.REMINDERS_GET, id),
    update: (id, patch) => electron.ipcRenderer.invoke(CH.REMINDERS_UPDATE, id, patch),
    delete: (id) => electron.ipcRenderer.invoke(CH.REMINDERS_DELETE, id),
    pause: (id, paused) => electron.ipcRenderer.invoke(CH.REMINDERS_PAUSE, id, paused),
    complete: (id) => electron.ipcRenderer.invoke(CH.REMINDERS_COMPLETE, id),
    dismiss: (id) => electron.ipcRenderer.invoke(CH.REMINDERS_DISMISS, id),
    snooze: (id, minutes) => electron.ipcRenderer.invoke(CH.REMINDERS_SNOOZE, id, minutes),
    history: (filter) => electron.ipcRenderer.invoke(CH.REMINDERS_HISTORY, filter)
  },
  settings: {
    get: () => electron.ipcRenderer.invoke(CH.SETTINGS_GET),
    update: (patch) => electron.ipcRenderer.invoke(CH.SETTINGS_UPDATE, patch),
    resetLocalData: () => electron.ipcRenderer.invoke(CH.SETTINGS_RESET),
    openDataFolder: () => electron.ipcRenderer.invoke(CH.SETTINGS_OPEN_DATA),
    // Write-only from here: the key goes to main once, is encrypted, and never comes back.
    setApiKey: (key) => electron.ipcRenderer.invoke(CH.SETTINGS_SET_API_KEY, key),
    clearApiKey: () => electron.ipcRenderer.invoke(CH.SETTINGS_CLEAR_API_KEY),
    validateApiKey: () => electron.ipcRenderer.invoke(CH.SETTINGS_VALIDATE_API_KEY)
  },
  overdue: {
    take: () => electron.ipcRenderer.invoke(CH.OVERDUE_TAKE)
  },
  speech: {
    start: (sampleRate) => electron.ipcRenderer.invoke(CH.SPEECH_START, sampleRate),
    stop: () => electron.ipcRenderer.invoke(CH.SPEECH_STOP),
    pushAudio: (pcm) => electron.ipcRenderer.send(CH.SPEECH_AUDIO, pcm),
    onPartial: (cb) => subscribe(CH.SPEECH_PARTIAL, cb),
    // onFinal removed (30 D8): the final transcript is the return value of speech.stop().
    onError: (cb) => subscribe(CH.SPEECH_ERROR, cb)
  },
  parse: (text) => electron.ipcRenderer.invoke(CH.PARSE_REMINDER, text),
  chat: {
    // Starts a turn in a session → { turnId }; the result arrives on chat:done (matched by turnId).
    send: (text, sessionId) => electron.ipcRenderer.invoke(CH.CHAT_SEND, { text, sessionId }),
    cancel: (turnId) => electron.ipcRenderer.invoke(CH.CHAT_CANCEL, turnId),
    // chat:delta is declared for a later token-streaming upgrade; idle this phase (non-streamed).
    onDelta: (cb) => subscribe(CH.CHAT_DELTA, cb),
    onDone: (cb) => subscribe(CH.CHAT_DONE, cb),
    onSearching: (cb) => subscribe(CH.CHAT_SEARCHING, cb),
    // Persistent sessions (CONV): list past chats, start a new one, load a chat's turns, rename.
    listSessions: () => electron.ipcRenderer.invoke(CH.CHAT_SESSIONS_LIST),
    createSession: () => electron.ipcRenderer.invoke(CH.CHAT_SESSION_CREATE),
    turns: (sessionId) => electron.ipcRenderer.invoke(CH.CHAT_SESSION_TURNS, sessionId),
    rename: (id, title) => electron.ipcRenderer.invoke(CH.CHAT_SESSION_RENAME, { id, title }),
    deleteSession: (id) => electron.ipcRenderer.invoke(CH.CHAT_SESSION_DELETE, id),
    // Report the open chat so the voice launcher continues this same conversation (continuity).
    setActiveSession: (id) => electron.ipcRenderer.invoke(CH.CHAT_ACTIVE_SESSION_SET, id),
    // Real-time sync: a turn STARTED in another window (the launcher) — show it live (reply pending).
    onTurnStarted: (cb) => subscribe(CH.CHAT_TURN_STARTED, cb),
    // DELIVERY / sync: a fired reminder or a turn from another window landed in a chat.
    onTurnAppended: (cb) => subscribe(CH.CHAT_TURN_APPENDED, cb)
  },
  action: {
    // Confirm/cancel execute or discard the STORED proposal for a turnId (no action payload).
    confirm: (turnId) => electron.ipcRenderer.invoke(CH.ACTION_CONFIRM, turnId),
    cancel: (turnId) => electron.ipcRenderer.invoke(CH.ACTION_CANCEL, turnId),
    onExpired: (cb) => subscribe(CH.ACTION_EXPIRED, cb),
    // EP-7: a proposal resolved by voice in main — settle the card.
    onResolved: (cb) => subscribe(CH.ACTION_RESOLVED, cb)
  },
  tts: {
    preview: () => electron.ipcRenderer.invoke(CH.TTS_PREVIEW),
    stop: () => electron.ipcRenderer.invoke(CH.TTS_STOP),
    onSpeaking: (cb) => subscribe(CH.TTS_SPEAKING, cb)
  },
  gmail: {
    // Credentials go in write-only (the secret is encrypted in main, never returned).
    setCredentials: (clientId, clientSecret) => electron.ipcRenderer.invoke(CH.GMAIL_SET_CREDENTIALS, { clientId, clientSecret }),
    connect: () => electron.ipcRenderer.invoke(CH.GMAIL_CONNECT),
    disconnect: () => electron.ipcRenderer.invoke(CH.GMAIL_DISCONNECT),
    test: () => electron.ipcRenderer.invoke(CH.GMAIL_TEST),
    deleteCache: () => electron.ipcRenderer.invoke(CH.GMAIL_DELETE_CACHE),
    syncNow: () => electron.ipcRenderer.invoke(CH.GMAIL_SYNC_NOW),
    status: () => electron.ipcRenderer.invoke(CH.GMAIL_STATUS_GET),
    onStatusChanged: (cb) => subscribe(CH.GMAIL_STATUS_CHANGED, cb),
    onOpenChat: (cb) => subscribe(CH.GMAIL_OPEN_CHAT, cb)
  },
  app: {
    version: () => electron.ipcRenderer.invoke(CH.APP_VERSION),
    onRemindersChanged: (cb) => subscribe(CH.REMINDERS_CHANGED, cb),
    onSettingsChanged: (cb) => subscribe(CH.SETTINGS_CHANGED, cb),
    onSessionsChanged: (cb) => subscribe(CH.CHAT_SESSIONS_CHANGED, cb),
    onReminderTrigger: (cb) => subscribe(CH.REMINDER_TRIGGER, cb),
    onLauncherSessionActivated: (cb) => subscribe(CH.LAUNCHER_SESSION_ACTIVATED, cb),
    // A local "open settings" command asks the main window to switch screens (main → renderer).
    onNavigate: (cb) => subscribe(CH.NAVIGATE, cb)
  }
};
electron.contextBridge.exposeInMainWorld("lifeos", Object.freeze(api));
