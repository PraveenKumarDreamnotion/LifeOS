import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { CH } from '../../../core/types/channels';
import { guard, SecurityError } from './guard';
import { DesktopVoiceController, type LauncherWindowApi } from '../desktop-voice/controller';
import type { ChatRepository } from '../../database/chat-repository';
import type { SettingsRepository } from '../../database/settings-repository';
import type { DesktopVoiceState } from '../../../core/types/desktop-voice';

const SendTranscriptInput = z
  .object({ sessionId: z.string().uuid(), text: z.string().trim().min(1).max(4000) })
  .strict();
const DiscardInput = z.object({ sessionId: z.string() }).strict();
const ReviewReadyInput = z.object({ sessionId: z.string().uuid() }).strict();
const OpenConversationInput = z.object({ sessionId: z.string().uuid() }).strict();
const HoverInput = z.object({ active: z.boolean() }).strict();
const InteractiveInput = z.object({ interactive: z.boolean() }).strict();
const ErrorInput = z.object({ message: z.string().trim().max(1000) }).strict();

export interface LauncherIpcDeps {
  chat: ChatRepository;
  startTurn: (text: string, sessionId: string, originId?: number) => string;
  settings: SettingsRepository;
  window: LauncherWindowApi;
  broadcast: (channel: string, payload?: unknown) => void;
  stopSpeaking: () => void;
  speak: (text: string) => void;
  getActiveProposalSessionId?: () => string | null;
  getActiveSessionId: () => string | null;
  setActiveSessionId: (sessionId: string) => void;
  /** True when the effective STT provider is cloud OpenAI — the launcher submits transcripts
   *  hands-free instead of showing the Review/Send step. */
  getSttAutoSubmit?: () => boolean;
}

export interface LauncherController {
  snapshot(): DesktopVoiceState;
  registerShortcut(): void;
  unregisterShortcut(): void;
  startListening(): void;
  stopListening(): void;
  registeredAccelerator(): string | null;
  markSearching(turnId: string): void;
  markTurnDone(turnId: string): void;
  setSpeaking(active: boolean): void;
  setError(message: string): void;
  /** Open the launcher directly into a conversation (notification click / chat switcher). */
  openConversation(sessionId: string): void;
  /** Conversations for the launcher's chat switcher (safe DTOs, newest first). */
  listSessions(): Array<{ id: string; title: string; updatedAt: number; kind: 'email' | 'chat' }>;
  /** Conversation interruption: pause an active conversation for a firing reminder, and resume it
   *  (re-open the launcher listening on the same session) once the reminder is handled. */
  pauseForReminder(): void;
  resumeAfterReminder(): void;
}

export function registerLauncherHandlers(deps: LauncherIpcDeps): LauncherController {
  const controller = new DesktopVoiceController(deps);

  const assertLauncherSender = (event: IpcMainInvokeEvent) => {
    const win = deps.window.current();
    if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id) throw new SecurityError('bad_launcher_sender');
  };

  ipcMain.handle(CH.LAUNCHER_STATE_GET, (event) =>
    guard(event, () => {
      assertLauncherSender(event);
      return controller.snapshot();
    }),
  );

  ipcMain.handle(CH.LAUNCHER_SEND_TRANSCRIPT, (event, raw) =>
    guard(event, () => {
      assertLauncherSender(event);
      const { sessionId, text } = SendTranscriptInput.parse(raw);
      const turnId = controller.sendTranscript(sessionId, text);
      return { turnId };
    }),
  );

  ipcMain.handle(CH.LAUNCHER_DISCARD_TRANSCRIPT, (event, raw) =>
    guard(event, async () => {
      assertLauncherSender(event);
      const { sessionId } = DiscardInput.parse(raw);
      await controller.discardTranscript(sessionId);
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.LAUNCHER_REVIEW_READY, (event, raw) =>
    guard(event, () => {
      assertLauncherSender(event);
      const { sessionId } = ReviewReadyInput.parse(raw);
      controller.markReviewReady(sessionId);
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.LAUNCHER_HOVER_CHANGED, (event, raw) =>
    guard(event, () => {
      assertLauncherSender(event);
      const { active } = HoverInput.parse(raw);
      controller.markHover(active);
      deps.window.setHovered(active);
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.LAUNCHER_INTERACTIVE, (event, raw) =>
    guard(event, () => {
      assertLauncherSender(event);
      const { interactive } = InteractiveInput.parse(raw);
      deps.window.setInteractive(interactive);
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.LAUNCHER_ERROR, (event, raw) =>
    guard(event, () => {
      assertLauncherSender(event);
      const { message } = ErrorInput.parse(raw);
      controller.setError(message);
      return { ok: true };
    }),
  );

  // Chat switcher (Issue 4): list the user's conversations, and jump to one.
  ipcMain.handle(CH.LAUNCHER_LIST_SESSIONS, (event) =>
    guard(event, () => {
      assertLauncherSender(event);
      return controller.listSessions();
    }),
  );

  ipcMain.handle(CH.LAUNCHER_OPEN_CONVERSATION, (event, raw) =>
    guard(event, () => {
      assertLauncherSender(event);
      const { sessionId } = OpenConversationInput.parse(raw);
      controller.openConversation(sessionId);
      return { ok: true };
    }),
  );

  return {
    snapshot: () => controller.snapshot(),
    registerShortcut: () => controller.registerShortcut(),
    unregisterShortcut: () => controller.unregisterShortcut(),
    startListening: () => controller.startListening(),
    stopListening: () => controller.stopListening(),
    registeredAccelerator: () => controller.registeredAccelerator(),
    markSearching: (turnId) => controller.markSearching(turnId),
    markTurnDone: (turnId) => controller.markTurnDone(turnId),
    setSpeaking: (active) => controller.setSpeaking(active),
    setError: (message) => controller.setError(message),
    openConversation: (sessionId) => controller.openConversation(sessionId),
    listSessions: () => controller.listSessions(),
    pauseForReminder: () => controller.pauseForReminder(),
    resumeAfterReminder: () => controller.resumeAfterReminder(),
  };
}
