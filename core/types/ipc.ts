/**
 * IPC contracts (16). Channel names live here — imported by both preload and main so a
 * typo is a compile error, not a silent no-op. Zod schemas validate every payload at the
 * boundary; TypeScript types do not survive structuredClone, only runtime validation does.
 */
import { z } from 'zod';
import type { Reminder, ReminderHistoryEntry } from './reminder';
import { ReminderExecutionSpecSchema } from './reminder-execution';
import { isSupportedRule } from '../scheduling/rrule';

// Channel names + Result live in channels.ts (dependency-free, preload-safe). Re-export
// them here so main-process code has a single import site.
export { CH } from './channels';
export type { Channel, Result, IpcError } from './channels';

// ── Validation building blocks ────────────────────────────────────────────────

/**
 * Recurrence rules the app can compute: daily/weekly/monthly/yearly, optional interval, multiple
 * weekdays, and COUNT/UNTIL end conditions. Validation delegates to `parseRule` (rrule.ts) so the
 * grammar lives in exactly ONE place — a regex here would inevitably drift from the parser.
 */
export const SUPPORTED_RRULE = z.string().refine(isSupportedRule, 'unsupported recurrence rule');

/** A permissive timezone check that does not depend on Luxon in this shared module. */
const IANA_ZONE = z.string().min(1).max(64).refine(isValidTimeZone, 'unknown timezone');

function isValidTimeZone(tz: string): boolean {
  try {
    // Intl is available in both the main process and the renderer.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ── Input schemas (all .strict(): an unknown key is a REJECTION, not ignored) ──

export const CreateReminderInput = z
  .object({
    title: z.string().trim().min(1, 'Give the reminder a name').max(200),
    description: z.string().trim().max(1000).nullable().default(null),
    scheduledAtUtcMs: z.number().int().positive(),
    timezone: IANA_ZONE,
    recurrenceRule: SUPPORTED_RRULE.nullable().default(null),
    actionType: z.enum(['notify', 'sing']),
    source: z.enum(['local', 'llm', 'manual']),
    /** Structured fire-time execution intent (reminder-execution). Optional + nullable → every
     *  existing caller and plain reminder is unaffected (omit it); only AI-task reminders set it. */
    execution: ReminderExecutionSpecSchema.nullable().optional(),
  })
  .strict();
export type CreateReminderInput = z.infer<typeof CreateReminderInput>;

export const UpdateReminderInput = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    scheduledAtUtcMs: z.number().int().positive().optional(),
    timezone: IANA_ZONE.optional(),
    recurrenceRule: SUPPORTED_RRULE.nullable().optional(),
    actionType: z.enum(['notify', 'sing']).optional(),
  })
  .strict();
export type UpdateReminderInput = z.infer<typeof UpdateReminderInput>;

export const ReminderIdInput = z.string().uuid();

export const PauseInput = z
  .object({ id: z.string().uuid(), paused: z.boolean() })
  .strict();

export const HistoryFilterInput = z
  .object({
    status: z
      .enum(['all', 'completed', 'dismissed', 'missed', 'cancelled'])
      .default('all'),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .strict();
export type HistoryFilterInput = z.infer<typeof HistoryFilterInput>;

export const SnoozeInput = z
  .object({ id: z.string().uuid(), minutes: z.number().int().min(1).max(1440) })
  .strict();

/** A settings patch is a small allow-list of keys the renderer may change (never the API key). */
export const SettingsPatch = z
  .object({
    remindersPaused: z.boolean().optional(),
    ttsEnabled: z.boolean().optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    trayNoticeShown: z.boolean().optional(),
    onboardingCompleted: z.boolean().optional(),
    closeAction: z.enum(['tray', 'quit']).optional(),
    // EP-1: the "Enable OpenAI" master toggle. Enabling alone sends nothing — each cloud
    // feature (STT/TTS/chat) is separately consented in its own phase (32 §2).
    aiEnabled: z.boolean().optional(),
    // EP-3: the STT provider. Choosing 'openai' records STT consent (the timestamp is set in
    // main); 'sherpa-onnx' revokes it. Enforced in main so the renderer can't fake consent.
    sttProvider: z.enum(['sherpa-onnx', 'openai']).optional(),
    // EP-4: the TTS provider (same consent pattern), the chosen friendly voice, and the rate.
    ttsProvider: z.enum(['web-speech', 'openai']).optional(),
    ttsVoice: z.string().max(40).optional(),
    ttsRate: z.number().min(0.25).max(4).optional(),
    desktopVoiceLauncherEnabled: z.boolean().optional(),
    desktopVoiceShortcutEnabled: z.boolean().optional(),
    launchAtLogin: z.boolean().optional(),
    conversationAutoResume: z.boolean().optional(),
    // Gmail feature toggles + sync policy (docs §5). All non-secret. Credentials (Client
    // ID/Secret) and tokens are NOT here — they go via GMAIL_SET_CREDENTIALS / GMAIL_CONNECT and
    // never cross IPC in readable form.
    gmailEnabled: z.boolean().optional(),
    gmailNotifications: z.boolean().optional(),
    gmailAiSummaries: z.boolean().optional(),
    gmailStoreContext: z.boolean().optional(),
    gmailAutoResearch: z.boolean().optional(),
    gmailDownloadAttachments: z.boolean().optional(),
    gmailIncludeThreads: z.boolean().optional(),
    gmailSyncMode: z.enum(['push', '5min', '15min', 'manual']).optional(),
    gmailMaxStored: z.enum(['1000', '5000', 'unlimited']).optional(),
  })
  .strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

/** Gmail OAuth credentials entered by the user. The secret is encrypted in main and never
 *  re-displayed; the id is non-secret. Handled by GMAIL_SET_CREDENTIALS, not SETTINGS_UPDATE. */
export const GmailCredentialsInput = z
  .object({
    clientId: z.string().trim().min(10).max(256),
    clientSecret: z.string().trim().min(6).max(256),
  })
  .strict();
export type GmailCredentialsInput = z.infer<typeof GmailCredentialsInput>;
/** The renderer-facing patch type. Single source of truth (30 D6) — the old duplicate in
 *  src/lib/ipc.ts is deleted and imports this instead. */
export type SettingsUpdate = SettingsPatch;

export interface SettingsDto {
  remindersPaused: boolean;
  ttsEnabled: boolean;
  theme: 'system' | 'light' | 'dark';
  trayNoticeShown: boolean;
  onboardingCompleted: boolean;
  closeAction: 'tray' | 'quit';
  snoozeMinutes: number;
  hasApiKey: boolean;
  aiEnabled: boolean;
  conversationUiEnabled: boolean;
  sttProvider: 'sherpa-onnx' | 'openai';
  ttsProvider: 'web-speech' | 'openai';
  ttsVoice: string;
  ttsRate: number;
  desktopVoiceLauncherEnabled: boolean;
  desktopVoiceShortcutEnabled: boolean;
  launchAtLogin: boolean;
  conversationAutoResume: boolean;
  // Gmail — all non-secret, all derived from settings rows. Connection state (connected/email/
  // counts/hasSecret) lives in GmailStatusDto (fetched via GMAIL_STATUS_GET), not here, so this
  // DTO builder stays pure.
  gmailEnabled: boolean;
  gmailClientId: string; // non-secret; prefills the textbox
  gmailNotifications: boolean;
  gmailAiSummaries: boolean;
  gmailStoreContext: boolean;
  gmailAutoResearch: boolean;
  gmailDownloadAttachments: boolean;
  gmailIncludeThreads: boolean;
  gmailSyncMode: 'push' | '5min' | '15min' | 'manual';
  gmailMaxStored: '1000' | '5000' | 'unlimited';
}

/** Result of a manual "Sync now" (Phase 2). */
export interface GmailSyncResultDto {
  ok: boolean;
  mode: 'initial' | 'incremental' | 'skipped';
  fetched: number;
  newCount: number;
  reason?: string;
}

/** Live Gmail connection status for the Settings section. Carries NO secrets — no token, no
 *  client secret (only booleans for their presence). */
export interface GmailStatusDto {
  connected: boolean;
  emailAddress: string | null;
  hasClientId: boolean;
  hasClientSecret: boolean;
  lastSyncAt: number | null;
  messageCount: number;
  storageBytes: number;
  syncStatus: 'idle' | 'syncing' | 'error' | 'reconnect_needed' | 'not_connected';
}

// ── Return DTOs (structurally identical to the domain model — 15 §3) ──────────
export type ReminderDto = Reminder;
export type HistoryDto = ReminderHistoryEntry;
