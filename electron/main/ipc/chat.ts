/**
 * Chat IPC (46 §IPC, CONV) — the conversation channels, all guard()-wrapped. chat:send starts a
 * turn IN A SESSION and returns { turnId }; the result arrives on chat:done. The session channels
 * back the persistent, resumable chat list: list past chats, start a new one, load a chat's turns
 * to resume it, rename. The renderer never receives raw model JSON — only validated ShellTurns.
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import { guard } from './guard';
import { CH } from '../../../core/types/channels';
import type { ConversationEngine } from '../../conversation/conversation-engine';
import type { ChatRepository } from '../../database/chat-repository';

const ChatSendInput = z
  .object({ text: z.string().trim().min(1).max(4000), sessionId: z.string().uuid() })
  .strict();
const TurnIdInput = z.string().uuid();
const SessionIdInput = z.string().uuid();
const RenameInput = z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(120) }).strict();

export interface ChatIpcDeps {
  engine: ConversationEngine;
  chat: ChatRepository;
  /** Start a turn AND mirror "turn started" to the other windows (real-time sync). originId excludes
   *  the sender so it doesn't double-render its own optimistic message. Returns the turnId. */
  startTurn: (text: string, sessionId: string, originId?: number) => string;
  /** Report the main window's open chat so the launcher continues that same conversation. */
  setActiveSession: (sessionId: string) => void;
}

export function registerChatHandlers(deps: ChatIpcDeps): void {
  ipcMain.handle(CH.CHAT_SEND, (event, raw) =>
    guard(event, () => {
      const { text, sessionId } = ChatSendInput.parse(raw);
      return { turnId: deps.startTurn(text, sessionId, event.sender.id) };
    }),
  );

  ipcMain.handle(CH.CHAT_CANCEL, (event, raw) =>
    guard(event, () => {
      deps.engine.cancel(TurnIdInput.parse(raw));
      return { cancelled: true };
    }),
  );

  ipcMain.handle(CH.CHAT_SESSIONS_LIST, (event) => guard(event, () => deps.chat.listSessions()));

  ipcMain.handle(CH.CHAT_SESSION_CREATE, (event) => guard(event, () => deps.chat.createSession()));

  ipcMain.handle(CH.CHAT_SESSION_TURNS, (event, raw) =>
    guard(event, () => deps.chat.loadTurns(SessionIdInput.parse(raw))),
  );

  ipcMain.handle(CH.CHAT_SESSION_RENAME, (event, raw) =>
    guard(event, () => {
      const { id, title } = RenameInput.parse(raw);
      deps.chat.rename(id, title);
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.CHAT_SESSION_DELETE, (event, raw) =>
    guard(event, () => {
      deps.chat.deleteSession(SessionIdInput.parse(raw));
      return { ok: true };
    }),
  );

  // The main window reports its open chat so the launcher continues that same conversation
  // (continuity). Pointer-only: no broadcast back, so it can't echo-loop with launcher:sessionActivated.
  ipcMain.handle(CH.CHAT_ACTIVE_SESSION_SET, (event, raw) =>
    guard(event, () => {
      deps.setActiveSession(SessionIdInput.parse(raw));
      return { ok: true };
    }),
  );
}
