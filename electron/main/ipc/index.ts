/**
 * IPC handler registration. Every handler: origin check → Zod .strict() → business rules
 * → act → broadcast → return a plain object (16 §5). raw is always `unknown`.
 */
import { app, ipcMain, BrowserWindow } from 'electron';
import { z } from 'zod';
import { guard, ValidationError } from './guard';
import {
  CH,
  CreateReminderInput,
  UpdateReminderInput,
  ReminderIdInput,
  PauseInput,
  SnoozeInput,
  HistoryFilterInput,
  SettingsPatch,
} from '../../../core/types/ipc';
import { toSettingsDto } from '../../../core/settings/typed-settings';
import { parseReminder } from '../../../core/parsing/parse-reminder';
import { resetLocalData } from '../../services/reset-service';
import { validateOpenAiKey } from '../../services/validate-openai-key';
import { EncryptionUnavailableError, type ApiKeyStore } from '../../services/api-key-store';
import type { ReminderRepository } from '../../database/reminder-repository';
import type { HistoryRepository } from '../../database/history-repository';
import type { SettingsRepository } from '../../database/settings-repository';

const ParseTextInput = z.string().trim().min(1).max(1000);
/** OpenAI keys are ~40–200 chars; reject obviously-malformed input at the boundary (42 edge case). */
const ApiKeySchema = z.string().trim().min(20).max(200);

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const GRACE_MS = 5_000;

export interface OverdueItem {
  id: string;
  title: string;
  recurring: boolean;
}

export interface IpcDeps {
  reminders: ReminderRepository;
  history: HistoryRepository;
  settings: SettingsRepository;
  apiKeyStore: ApiKeyStore;
  onChanged: () => void;
  onSettingsChanged: () => void;
  snoozeDefaultMinutes: () => number;
  /** Returns the startup-overdue list AND clears it — a pull, so it can't race the renderer. */
  takeOverdue: () => OverdueItem[];
  /** Close the DB (release the WAL) before Reset deletes the data folder. */
  closeDb: () => void;
  /** Best-effort work to run BEFORE the local wipe — currently a server-side Google OAuth revoke so
   *  a reset doesn't leave LifeOS authorized in the user's Google account (Issue 5). Must never throw. */
  onBeforeReset?: () => Promise<void>;
}

export function validateBusinessRules(scheduledAtUtcMs: number, recurrenceRule: string | null, actionType: string): void {
  const now = Date.now();
  if (scheduledAtUtcMs <= now - GRACE_MS) {
    throw new ValidationError('date_in_past', 'That time has already passed.');
  }
  if (scheduledAtUtcMs > now + TWO_YEARS_MS) {
    throw new ValidationError('date_too_far', "I can't schedule more than two years ahead.");
  }
  if (actionType === 'sing' && recurrenceRule) {
    throw new ValidationError('sing_not_recurring', 'The Yogi song is a one-time thing.');
  }
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { reminders, history, settings, apiKeyStore, onChanged, onSettingsChanged } = deps;

  ipcMain.handle(CH.REMINDERS_CREATE, (event, raw) =>
    guard(event, () => {
      const input = CreateReminderInput.parse(raw);
      validateBusinessRules(input.scheduledAtUtcMs, input.recurrenceRule, input.actionType);
      const reminder = reminders.create(input);
      onChanged();
      return reminder;
    }),
  );

  ipcMain.handle(CH.REMINDERS_LIST, (event) =>
    guard(event, () => reminders.listAll()),
  );

  ipcMain.handle(CH.REMINDERS_GET, (event, raw) =>
    guard(event, () => {
      const id = ReminderIdInput.parse(raw);
      return reminders.get(id) ?? null;
    }),
  );

  ipcMain.handle(CH.REMINDERS_UPDATE, (event, rawId, rawPatch) =>
    guard(event, () => {
      const id = ReminderIdInput.parse(rawId);
      const patch = UpdateReminderInput.parse(rawPatch);
      if (patch.scheduledAtUtcMs !== undefined) {
        validateBusinessRules(
          patch.scheduledAtUtcMs,
          patch.recurrenceRule ?? null,
          patch.actionType ?? 'notify',
        );
      }
      const updated = reminders.update(id, patch);
      if (!updated) throw new ValidationError('not_found', 'That reminder no longer exists.');
      onChanged();
      return updated;
    }),
  );

  ipcMain.handle(CH.REMINDERS_DELETE, (event, raw) =>
    guard(event, () => {
      const id = ReminderIdInput.parse(raw);
      const deleted = reminders.delete(id);
      if (deleted) onChanged();
      return { deleted };
    }),
  );

  ipcMain.handle(CH.REMINDERS_PAUSE, (event, rawId, rawPaused) =>
    guard(event, () => {
      const { id, paused } = PauseInput.parse({ id: rawId, paused: rawPaused });
      const updated = reminders.setPaused(id, paused);
      if (!updated) throw new ValidationError('not_found', 'That reminder no longer exists.');
      onChanged();
      return updated;
    }),
  );

  ipcMain.handle(CH.REMINDERS_HISTORY, (event, raw) =>
    guard(event, () => history.list(HistoryFilterInput.parse(raw ?? {}))),
  );

  ipcMain.handle(CH.REMINDERS_COMPLETE, (event, raw) =>
    guard(event, () => {
      const id = ReminderIdInput.parse(raw);
      const r = reminders.get(id);
      if (!r) throw new ValidationError('not_found', 'That reminder no longer exists.');
      reminders.markCompleted(id);
      history.record(id, r.title, Date.now(), 'completed');
      onChanged();
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.REMINDERS_DISMISS, (event, raw) =>
    guard(event, () => {
      const id = ReminderIdInput.parse(raw);
      const r = reminders.get(id);
      if (!r) throw new ValidationError('not_found', 'That reminder no longer exists.');
      reminders.markDismissed(id);
      history.record(id, r.title, Date.now(), 'dismissed');
      onChanged();
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.REMINDERS_SNOOZE, (event, rawId, rawMinutes) =>
    guard(event, () => {
      const { id, minutes } = SnoozeInput.parse({ id: rawId, minutes: rawMinutes });
      const r = reminders.get(id);
      if (!r) throw new ValidationError('not_found', 'That reminder no longer exists.');
      if (r.recurrenceRule) throw new ValidationError('snooze_recurring', 'Recurring reminders cannot be snoozed.');
      const updated = reminders.snooze(id, minutes);
      history.record(id, r.title, Date.now(), 'snoozed');
      onChanged();
      return updated;
    }),
  );

  ipcMain.handle(CH.OVERDUE_TAKE, (event) => guard(event, () => deps.takeOverdue()));

  // Reset takes NO arguments — the path is resolved in main, never supplied by the renderer.
  ipcMain.handle(CH.SETTINGS_RESET, (event) =>
    guard(event, async () => {
      // Revoke the Google OAuth grant server-side BEFORE the wipe, else deleting the local encrypted
      // token leaves LifeOS still authorized in the user's Google account (Issue 5). Best-effort AND
      // time-bounded: this adds a network call in front of a path that previously had none, and a
      // reset is often triggered while offline — a stalled revoke must never freeze the wipe. On
      // timeout/failure we proceed (worst case: the grant isn't revoked, exactly the pre-fix state).
      if (deps.onBeforeReset) {
        try {
          await Promise.race([
            deps.onBeforeReset(),
            new Promise<void>((resolve) => setTimeout(resolve, 4000)),
          ]);
        } catch {
          /* best-effort — proceed with the wipe regardless */
        }
      }
      await resetLocalData(deps.closeDb); // relaunches; never returns normally
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.SETTINGS_OPEN_DATA, (event) =>
    guard(event, async () => {
      const { app, shell } = await import('electron');
      await shell.openPath(app.getPath('userData'));
      return { ok: true };
    }),
  );

  // D6: the string→typed conversion lives in one place (toSettingsDto); the key is never
  // returned — getAllSafe excludes the ciphertext and hasApiKey is a boolean (16 §6).
  ipcMain.handle(CH.SETTINGS_GET, (event) =>
    guard(event, () => toSettingsDto(settings.getAllSafe(), apiKeyStore.has())),
  );

  ipcMain.handle(CH.SETTINGS_UPDATE, (event, raw) =>
    guard(event, () => {
      const patch = SettingsPatch.parse(raw);
      if (patch.remindersPaused !== undefined) settings.set('reminders_paused', String(patch.remindersPaused));
      if (patch.ttsEnabled !== undefined) settings.set('tts_enabled', String(patch.ttsEnabled));
      if (patch.theme !== undefined) settings.set('theme', patch.theme);
      if (patch.trayNoticeShown !== undefined) settings.set('tray_notice_shown', String(patch.trayNoticeShown));
      if (patch.onboardingCompleted !== undefined) settings.set('onboarding_completed', String(patch.onboardingCompleted));
      if (patch.closeAction !== undefined) settings.set('close_action', patch.closeAction);
      if (patch.aiEnabled !== undefined) {
        settings.set('ai_assist_enabled', String(patch.aiEnabled));
        // Enabling AI Assist records chat consent (the renderer showed the disclosure first);
        // disabling revokes it. Set HERE in main so the renderer cannot fabricate consent
        // (32 §2, mirrors the STT/TTS consent handling below). makeLlmProvider gates on it.
        settings.set('ai_consent_accepted_at', patch.aiEnabled ? new Date().toISOString() : '');
      }
      if (patch.sttProvider !== undefined) {
        settings.set('stt_provider', patch.sttProvider);
        // Choosing OpenAI records STT consent; reverting to sherpa revokes it (32 §2). The
        // timestamp is set HERE in main so the renderer cannot fabricate consent.
        settings.set('stt_consented_at', patch.sttProvider === 'openai' ? new Date().toISOString() : '');
      }
      if (patch.ttsProvider !== undefined) {
        settings.set('tts_provider', patch.ttsProvider);
        settings.set('tts_consented_at', patch.ttsProvider === 'openai' ? new Date().toISOString() : '');
        settings.set('tts_degraded', 'false'); // a fresh choice clears any prior degrade notice
      }
      if (patch.ttsVoice !== undefined) settings.set('tts_voice', patch.ttsVoice);
      if (patch.ttsRate !== undefined) settings.set('tts_rate', String(patch.ttsRate));
      if (patch.desktopVoiceLauncherEnabled !== undefined) {
        settings.set('desktop_voice_launcher_enabled', String(patch.desktopVoiceLauncherEnabled));
      }
      if (patch.desktopVoiceShortcutEnabled !== undefined) {
        settings.set('desktop_voice_shortcut_enabled', String(patch.desktopVoiceShortcutEnabled));
      }
      if (patch.launchAtLogin !== undefined) settings.set('launch_at_login', String(patch.launchAtLogin));
      if (patch.conversationAutoResume !== undefined) {
        settings.set('conversation_auto_resume', String(patch.conversationAutoResume));
      }
      // Gmail feature toggles + sync policy (all non-secret). Credentials/tokens are NOT here —
      // they flow through registerGmailHandlers (GMAIL_SET_CREDENTIALS / GMAIL_CONNECT).
      if (patch.gmailEnabled !== undefined) settings.set('gmail_enabled', String(patch.gmailEnabled));
      if (patch.gmailNotifications !== undefined) settings.set('gmail_notifications', String(patch.gmailNotifications));
      if (patch.gmailAiSummaries !== undefined) settings.set('gmail_ai_summaries', String(patch.gmailAiSummaries));
      if (patch.gmailStoreContext !== undefined) settings.set('gmail_store_context', String(patch.gmailStoreContext));
      if (patch.gmailAutoResearch !== undefined) settings.set('gmail_auto_research', String(patch.gmailAutoResearch));
      if (patch.gmailDownloadAttachments !== undefined) {
        settings.set('gmail_download_attachments', String(patch.gmailDownloadAttachments));
      }
      if (patch.gmailIncludeThreads !== undefined) settings.set('gmail_include_threads', String(patch.gmailIncludeThreads));
      if (patch.gmailSyncMode !== undefined) settings.set('gmail_sync_mode', patch.gmailSyncMode);
      if (patch.gmailMaxStored !== undefined) settings.set('gmail_max_stored', patch.gmailMaxStored);
      onSettingsChanged();
      return { ok: true };
    }),
  );

  // ── API key (EP-1): write-only from the renderer's view. The plaintext is encrypted here in
  //    main via safeStorage and never crosses IPC in readable form (invariant §8.4). ──────────
  ipcMain.handle(CH.SETTINGS_SET_API_KEY, (event, raw) =>
    guard(event, () => {
      const key = ApiKeySchema.parse(raw);
      try {
        apiKeyStore.set(key);
      } catch (e) {
        if (e instanceof EncryptionUnavailableError) {
          throw new ValidationError('encryption_unavailable', 'Secure key storage is unavailable on this device.');
        }
        throw e;
      }
      // hasApiKey changed → renderers refetch; the network predicate re-reads live from settings.
      onSettingsChanged();
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.SETTINGS_CLEAR_API_KEY, (event) =>
    guard(event, () => {
      apiKeyStore.clear();
      // Removing the key disables cloud + resets consent — a key-less cloud feature is meaningless.
      settings.set('ai_assist_enabled', 'false');
      settings.set('ai_consent_accepted_at', '');
      onSettingsChanged();
      return { ok: true };
    }),
  );

  // The one user-initiated outbound call (42, Security §): only fires on an explicit Validate click.
  ipcMain.handle(CH.SETTINGS_VALIDATE_API_KEY, (event) =>
    guard(event, async () => {
      const key = apiKeyStore.get();
      if (!key) return { valid: false, reason: 'no_key' as const };
      return validateOpenAiKey(key);
    }),
  );

  ipcMain.handle(CH.PARSE_REMINDER, (event, raw) =>
    guard(event, () => {
      const text = ParseTextInput.parse(raw);
      // Runs in main so the future AI Assist fallback (which needs the API key that never
      // crosses IPC) can live behind it. The renderer receives only a ParseResult.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return parseReminder(text, new Date(), tz);
    }),
  );

  // Conversation (chat:send/cancel) is registered separately by registerChatHandlers (ipc/chat.ts)
  // in EP-5 — it drives the ConversationEngine and broadcasts on chat:done, so it doesn't fit the
  // synchronous request/response shape of the handlers here.

  ipcMain.handle(CH.APP_VERSION, (event) =>
    guard(event, () => ({ version: app.getVersion(), electron: process.versions.electron })),
  );
}

/** Broadcast to every renderer that the reminder set changed; they refetch (16 §3.3). */
export function broadcastRemindersChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(CH.REMINDERS_CHANGED);
  }
}

export function broadcastSettingsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(CH.SETTINGS_CHANGED);
  }
}
