/**
 * The only place the renderer touches window.lifeos. Converts the Result envelope into a
 * thrown AppError at the edge, so the rest of the app uses normal try/catch (16 §8).
 */
import type { ReminderDto, HistoryDto, SettingsDto, SettingsUpdate, GmailStatusDto, GmailSyncResultDto } from '../../core/types/ipc';
import type { ParseResult } from '../../core/parsing/types';
import type { ShellTurn, ChatDonePayload } from '../../core/types/chat';
import type { DispatchResult, Proposal } from '../../core/actions/action';

/** What the renderer gets back from a chat turn: the reply + either a local parse proposal (EP-2
 *  path) or a dispatcher `proposal` (EP-6), plus the `turnId` needed to confirm the latter. */
export type ChatTurnResult = ShellTurn & { turnId: string; proposal?: Proposal };

// SettingsUpdate is imported from core (30 D6) — no local duplicate to keep in lockstep.
export type { SettingsUpdate };

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new AppError(r.error.code, r.error.message);
  return r.data;
}

export interface CreateReminderArgs {
  title: string;
  description: string | null;
  scheduledAtUtcMs: number;
  timezone: string;
  recurrenceRule: string | null;
  actionType: 'notify' | 'sing';
  source: 'local' | 'llm' | 'manual';
}

/** A reminder edit: every field optional; omit a key to leave it unchanged. */
export interface UpdateReminderArgs {
  title?: string;
  description?: string | null;
  scheduledAtUtcMs?: number;
  timezone?: string;
  recurrenceRule?: string | null;
  actionType?: 'notify' | 'sing';
}

/**
 * chat:send is async in EP-5: it returns { turnId } and the ShellTurn arrives later on the
 * chat:done broadcast. This adapter hides that behind the same Promise<ShellTurn> the EP-2
 * `useConversation` already awaits, so the shell is unchanged until token streaming actually
 * lands. NB: for a cloud-off turn the engine broadcasts chat:done SYNCHRONOUSLY inside send(),
 * before we know our turnId — so we subscribe first and buffer, then match by turnId.
 */
/** Ultimate safety net: even if main never broadcasts chat:done, the UI unsticks after this. */
const CHAT_CLIENT_TIMEOUT_MS = 50_000;

function chatSend(text: string, sessionId: string): Promise<ChatTurnResult> {
  return new Promise<ChatTurnResult>((resolve, reject) => {
    const buffered: ChatDonePayload[] = [];
    let targetId: string | null = null;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      reject(new AppError('timeout', "Sorry, I couldn't complete that — please try again."));
    }, CHAT_CLIENT_TIMEOUT_MS);

    const settle = (p: ChatDonePayload) => {
      settled = true;
      clearTimeout(timeout);
      unsub();
      resolve({ reply: p.reply, parse: p.parse, proposal: p.proposal, turnId: p.turnId });
    };

    const unsub = window.lifeos.chat.onDone((p: ChatDonePayload) => {
      if (settled) return;
      if (targetId !== null && p.turnId === targetId) settle(p);
      else buffered.push(p);
    });

    window.lifeos.chat
      .send(text, sessionId)
      .then((r) => {
        if (!r.ok) {
          settled = true;
          clearTimeout(timeout);
          unsub();
          reject(new AppError(r.error.code, r.error.message));
          return;
        }
        targetId = r.data.turnId;
        const already = buffered.find((p) => p.turnId === targetId);
        if (already && !settled) settle(already);
      })
      .catch((e) => {
        settled = true;
        clearTimeout(timeout);
        unsub();
        reject(e as Error);
      });
  });
}

export const ipc = {
  parse: (text: string): Promise<ParseResult> => unwrap(window.lifeos.parse(text)),
  chatSend,
  // Persistent chat sessions (CONV).
  listSessions: () => unwrap(window.lifeos.chat.listSessions()),
  createSession: () => unwrap(window.lifeos.chat.createSession()),
  sessionTurns: (sessionId: string) => unwrap(window.lifeos.chat.turns(sessionId)),
  renameSession: (id: string, title: string) => unwrap(window.lifeos.chat.rename(id, title)),
  deleteSession: (id: string) => unwrap(window.lifeos.chat.deleteSession(id)),
  // Report the open chat so the voice launcher continues this same conversation (continuity).
  setActiveSession: (id: string) => unwrap(window.lifeos.chat.setActiveSession(id)),
  onTurnStarted: (cb: (p: { sessionId: string; turnId: string; userText: string }) => void) =>
    window.lifeos.chat.onTurnStarted(cb),
  onTurnAppended: (cb: (p: { sessionId: string; turn: import('../../core/types/chat').ChatTurn }) => void) =>
    window.lifeos.chat.onTurnAppended(cb),
  // EP-6: confirm/cancel a dispatcher proposal by turnId (executes the STORED action).
  actionConfirm: (turnId: string): Promise<DispatchResult> => unwrap(window.lifeos.action.confirm(turnId)),
  actionCancel: (turnId: string) => unwrap(window.lifeos.action.cancel(turnId)),
  onActionExpired: (cb: (p: { turnId: string }) => void) => window.lifeos.action.onExpired(cb),
  onActionResolved: (cb: (p: { turnId: string; status: 'executed' | 'cancelled'; summary?: string }) => void) =>
    window.lifeos.action.onResolved(cb),
  ttsPreview: () => unwrap(window.lifeos.tts.preview()),
  stopSpeaking: () => unwrap(window.lifeos.tts.stop()),
  onSpeaking: (cb: (p: { active: boolean }) => void) => window.lifeos.tts.onSpeaking(cb),
  onSearching: (cb: (p: { turnId: string; sessionId: string | null }) => void) => window.lifeos.chat.onSearching(cb),
  createReminder: (input: CreateReminderArgs): Promise<ReminderDto> =>
    unwrap(window.lifeos.reminders.create(input)),
  updateReminder: (id: string, patch: UpdateReminderArgs): Promise<ReminderDto> =>
    unwrap(window.lifeos.reminders.update(id, patch)),
  listReminders: (): Promise<ReminderDto[]> => unwrap(window.lifeos.reminders.list()),
  deleteReminder: (id: string): Promise<{ deleted: boolean }> =>
    unwrap(window.lifeos.reminders.delete(id)),
  completeReminder: (id: string) => unwrap(window.lifeos.reminders.complete(id)),
  dismissReminder: (id: string) => unwrap(window.lifeos.reminders.dismiss(id)),
  snoozeReminder: (id: string, minutes: number) => unwrap(window.lifeos.reminders.snooze(id, minutes)),
  pauseReminder: (id: string, paused: boolean) => unwrap(window.lifeos.reminders.pause(id, paused)),
  getSettings: (): Promise<SettingsDto> => unwrap(window.lifeos.settings.get()),
  updateSettings: (patch: SettingsUpdate) => unwrap(window.lifeos.settings.update(patch)),
  resetLocalData: () => unwrap(window.lifeos.settings.resetLocalData()),
  openDataFolder: () => unwrap(window.lifeos.settings.openDataFolder()),
  setApiKey: (key: string) => unwrap(window.lifeos.settings.setApiKey(key)),
  clearApiKey: () => unwrap(window.lifeos.settings.clearApiKey()),
  validateApiKey: (): Promise<{ valid: boolean; reason?: string }> =>
    unwrap(window.lifeos.settings.validateApiKey()),
  history: (status: 'all' | 'completed' | 'dismissed' | 'missed', limit = 100): Promise<HistoryDto[]> =>
    unwrap(window.lifeos.reminders.history({ status, limit })),
  takeOverdue: () => unwrap(window.lifeos.overdue.take()),
  version: () => unwrap(window.lifeos.app.version()),
  onRemindersChanged: (cb: () => void) => window.lifeos.app.onRemindersChanged(cb),
  onSettingsChanged: (cb: () => void) => window.lifeos.app.onSettingsChanged(cb),
  // Gmail (docs §5). Credentials in write-only; only a safe status ever comes back.
  gmailSetCredentials: (clientId: string, clientSecret: string) =>
    unwrap(window.lifeos.gmail.setCredentials(clientId, clientSecret)),
  gmailConnect: (): Promise<{ emailAddress: string }> => unwrap(window.lifeos.gmail.connect()),
  gmailDisconnect: () => unwrap(window.lifeos.gmail.disconnect()),
  gmailTest: (): Promise<{ ok: boolean; emailAddress?: string; reason?: string }> =>
    unwrap(window.lifeos.gmail.test()),
  gmailDeleteCache: (): Promise<{ ok: boolean; deleted: number }> => unwrap(window.lifeos.gmail.deleteCache()),
  gmailSyncNow: (): Promise<GmailSyncResultDto> => unwrap(window.lifeos.gmail.syncNow()),
  gmailStatus: (): Promise<GmailStatusDto> => unwrap(window.lifeos.gmail.status()),
  onGmailStatusChanged: (cb: (s: GmailStatusDto) => void) => window.lifeos.gmail.onStatusChanged(cb),
  onGmailOpenChat: (cb: (p: { sessionId: string }) => void) => window.lifeos.gmail.onOpenChat(cb),
  onSessionsChanged: (cb: () => void) => window.lifeos.app.onSessionsChanged(cb),
  onLauncherSessionActivated: (cb: (p: { sessionId: string }) => void) => window.lifeos.app.onLauncherSessionActivated(cb),
};
