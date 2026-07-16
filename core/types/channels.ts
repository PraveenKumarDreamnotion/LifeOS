/**
 * IPC channel names and the Result envelope — ZERO dependencies.
 *
 * This file is imported by the sandboxed preload, which cannot load zod (or any npm
 * package). The Zod schemas live in ipc.ts, which only the main process imports. Keeping
 * them apart is what stops zod from being pulled into the preload bundle.
 */

export const CH = {
  REMINDERS_CREATE: 'reminders:create',
  REMINDERS_LIST: 'reminders:list',
  REMINDERS_GET: 'reminders:get',
  REMINDERS_UPDATE: 'reminders:update',
  REMINDERS_DELETE: 'reminders:delete',
  REMINDERS_PAUSE: 'reminders:pause',
  REMINDERS_HISTORY: 'reminders:history',
  REMINDERS_COMPLETE: 'reminders:complete',
  REMINDERS_DISMISS: 'reminders:dismiss',
  REMINDERS_SNOOZE: 'reminders:snooze',
  REMINDERS_CHANGED: 'reminders:changed', // broadcast, main → renderer
  SETTINGS_CHANGED: 'settings:changed', // broadcast, main → renderer
  REMINDER_TRIGGER: 'reminder:trigger', // broadcast, main → renderer
  NAVIGATE: 'app:navigate', // broadcast, main → main-window renderer (local "open settings" command)
  OVERDUE_TAKE: 'overdue:take', // pull: renderer fetches + clears the startup overdue list
  PARSE_REMINDER: 'parse:reminder',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_RESET: 'settings:resetLocalData',
  SETTINGS_OPEN_DATA: 'settings:openDataFolder',
  // API key (EP-1): write-only from the renderer's view — no getter exists. The key never
  // crosses IPC in readable form; the store encrypts/decrypts only in main (30 §13.6).
  SETTINGS_SET_API_KEY: 'settings:setApiKey',
  SETTINGS_CLEAR_API_KEY: 'settings:clearApiKey',
  SETTINGS_VALIDATE_API_KEY: 'settings:validateApiKey',
  APP_VERSION: 'app:version',
  // Gmail integration (docs/lifeos-planning/gmail-integration.md). Credentials/tokens are handled
  // ONLY in main; the renderer sends the Client ID/Secret once (write-only) and receives back a
  // safe status (connected + email + counts), never a token.
  GMAIL_SET_CREDENTIALS: 'gmail:setCredentials', // { clientId, clientSecret }
  GMAIL_CONNECT: 'gmail:connect', // starts the loopback OAuth flow; returns { emailAddress }
  GMAIL_DISCONNECT: 'gmail:disconnect', // server-side revoke + local wipe
  GMAIL_TEST: 'gmail:test', // Test Connection
  GMAIL_DELETE_CACHE: 'gmail:deleteCache', // Delete Local Email Cache
  GMAIL_SYNC_NOW: 'gmail:syncNow', // manual sync trigger
  GMAIL_STATUS_GET: 'gmail:status:get', // safe status snapshot for the Settings section
  GMAIL_STATUS_CHANGED: 'gmail:status', // broadcast, main → renderer (connect/disconnect/sync)
  GMAIL_OPEN_CHAT: 'gmail:openChat', // broadcast, main → renderer — { sessionId } (Phase 3: open an email's chat)
  CHAT_SESSIONS_CHANGED: 'chat:sessionsChanged', // broadcast, main → renderer — refresh the chat sidebar
  // Conversation. EP-5: chat:send starts a turn and returns { turnId }; the result arrives on the
  // chat:done broadcast (reusing the ShellTurn shape). chat:cancel aborts an in-flight turn.
  // chat:delta is declared for a later token-streaming upgrade and stays idle this phase
  // (EP-5 uses the non-streamed complete() — 46 §Risk).
  CHAT_SEND: 'chat:send',
  CHAT_CANCEL: 'chat:cancel',
  // Persistent chat sessions (CONV). List past chats, start a new one, load a chat's turns to
  // resume it, rename.
  CHAT_SESSIONS_LIST: 'chat:sessions:list',
  CHAT_SESSION_CREATE: 'chat:session:create',
  CHAT_SESSION_TURNS: 'chat:session:turns',
  CHAT_SESSION_RENAME: 'chat:session:rename',
  CHAT_SESSION_DELETE: 'chat:session:delete',
  // DELIVERY: a fired reminder was delivered into its chat. { sessionId, turn }. The renderer
  // live-appends it IFF that chat is currently open; otherwise it's there on reopen.
  CHAT_TURN_APPENDED: 'chat:turn:appended', // broadcast, main → renderer
  // Real-time cross-window conversation sync. A turn STARTED (user text known, reply pending) is
  // mirrored to every OTHER window so both the main chat and the launcher show one live conversation
  // (the originating window shows its own turn through its own optimistic UI, so it's excluded).
  CHAT_TURN_STARTED: 'chat:turn:started', // broadcast (except sender), main → renderers — { sessionId, turnId, userText }
  // The single active-conversation pointer shared by the main window and the voice launcher. The
  // main window reports its open chat here (invoke, renderer → main) so the launcher continues that
  // SAME conversation instead of starting a new one each time (conversation continuity).
  CHAT_ACTIVE_SESSION_SET: 'chat:activeSessionSet', // invoke, renderer → main — { sessionId }
  // Reminder popup (55): main → popup shows the current reminder (+ queue count); popup → main
  // performs a lifecycle action (complete/dismiss/snooze) on it.
  POPUP_SHOW: 'popup:show', // main → popup window
  POPUP_ACTION: 'popup:action', // invoke, popup → main (button lifecycle)
  POPUP_MESSAGE: 'popup:message', // invoke, popup → main (typed/spoken: lifecycle-or-chat, P2-B)
  CHAT_DELTA: 'chat:delta', // broadcast, main → renderer (idle until streaming lands)
  CHAT_DONE: 'chat:done', // broadcast, main → renderer — { turnId, reply, parse, proposal? }
  CHAT_SEARCHING: 'chat:searching', // broadcast, main → renderer — { turnId } (web search in flight)
  // TTS control: main broadcasts whether Yogi is currently speaking; a renderer can stop it.
  TTS_SPEAKING: 'tts:speaking', // broadcast, main → renderer — { active: boolean }
  TTS_STOP: 'tts:stop', // invoke, renderer → main — stop all current speech immediately
  // Action Dispatcher (EP-6). confirm/cancel execute/discard the STORED pending proposal for a
  // turnId (the renderer never submits an action payload — 36 §4.3). action:expired tells the
  // renderer a pending proposal timed out (fails safe: expiry = cancel).
  ACTION_CONFIRM: 'action:confirm',
  ACTION_CANCEL: 'action:cancel',
  ACTION_EXPIRED: 'action:expired', // broadcast, main → renderer
  // EP-7: a proposal was resolved BY VOICE in main (the matcher drove confirm/cancel), so the
  // renderer must settle the card it can't see resolve. { turnId, status, summary? }.
  ACTION_RESOLVED: 'action:resolved', // broadcast, main → renderer
  // Voice preview (EP-4): speak the sample line through the active TTS provider+voice+rate.
  TTS_PREVIEW: 'tts:preview',
  // Speech (Day 5)
  SPEECH_START: 'speech:start',
  SPEECH_STOP: 'speech:stop',
  SPEECH_AUDIO: 'speech:audio', // send (renderer → main), high-frequency PCM frames
  SPEECH_PARTIAL: 'speech:partial', // broadcast
  // SPEECH_FINAL removed (30 D8): the final transcript is the return value of speech:stop; the
  // broadcast was dead plumbing that risked a double-apply.
  SPEECH_ERROR: 'speech:error', // broadcast
  // Desktop voice launcher. The launcher is a separate frameless BrowserWindow; main owns window
  // lifecycle + session creation, while the launcher renderer owns mic capture/review UI.
  LAUNCHER_BEGIN_LISTENING: 'launcher:beginListening', // main -> launcher
  LAUNCHER_STOP_LISTENING: 'launcher:stopListening', // main -> launcher
  LAUNCHER_STATE_GET: 'launcher:stateGet', // invoke, launcher -> main
  LAUNCHER_STATE_CHANGED: 'launcher:stateChanged', // broadcast, main -> launcher/renderers
  LAUNCHER_SESSION_ACTIVATED: 'launcher:sessionActivated', // broadcast, main -> renderers
  LAUNCHER_SEND_TRANSCRIPT: 'launcher:sendTranscript', // invoke, launcher -> main
  LAUNCHER_DISCARD_TRANSCRIPT: 'launcher:discardTranscript', // invoke, launcher -> main
  LAUNCHER_REVIEW_READY: 'launcher:reviewReady', // invoke, launcher -> main
  LAUNCHER_HOVER_CHANGED: 'launcher:hoverChanged', // invoke, launcher -> main
  LAUNCHER_INTERACTIVE: 'launcher:interactive', // invoke, launcher -> main
  LAUNCHER_ERROR: 'launcher:error', // invoke, launcher -> main
  LAUNCHER_LIST_SESSIONS: 'launcher:listSessions', // invoke, launcher -> main (chat switcher)
  LAUNCHER_OPEN_CONVERSATION: 'launcher:openConversation', // invoke, launcher -> main (chat switcher)
} as const;

export type Channel = (typeof CH)[keyof typeof CH];

export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError };
export interface IpcError {
  code: string;
  message: string;
}
