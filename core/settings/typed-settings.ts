/**
 * Typed settings coercion (30 D6). Settings are stored as TEXT strings in SQLite; every reader
 * used to hand-parse `'true'`/`'30000'`/`'1.0'`. These pure helpers centralise that coercion so
 * call sites stop repeating it. The canonical `SettingsDto` TYPE lives in `core/types/ipc.ts`
 * (it is the IPC contract shape); this module only provides the string→typed helpers and the
 * DTO builder the settings repository uses. Pure: no electron/node imports.
 */
import type { SettingsDto } from '../types/ipc';

export function asBool(value: string | undefined): boolean {
  return value === 'true';
}

export function asNumber(value: string | undefined, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asEnum<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

/**
 * Build the safe, typed DTO the renderer receives from `settings:get`. `raw` MUST already have
 * had `ai_key_ciphertext` excluded by the repository's getAllSafe (16 §6); `hasApiKey` is passed
 * as a boolean, never the key. This is the single place the string map becomes the typed DTO.
 */
export function toSettingsDto(raw: Record<string, string>, hasApiKey: boolean): SettingsDto {
  return {
    remindersPaused: asBool(raw.reminders_paused),
    ttsEnabled: asBool(raw.tts_enabled),
    theme: asEnum(raw.theme, ['system', 'light', 'dark'] as const, 'system'),
    trayNoticeShown: asBool(raw.tray_notice_shown),
    onboardingCompleted: asBool(raw.onboarding_completed),
    closeAction: asEnum(raw.close_action, ['tray', 'quit'] as const, 'tray'),
    snoozeMinutes: asNumber(raw.snooze_minutes, 10),
    hasApiKey,
    aiEnabled: asBool(raw.ai_assist_enabled),
    // Default true when the key is absent from the raw map (a fresh/older profile) so the new
    // conversation UI is the default at v0.3.
    conversationUiEnabled: raw.conversation_ui_enabled === undefined ? true : asBool(raw.conversation_ui_enabled),
    sttProvider: asEnum(raw.stt_provider, ['sherpa-onnx', 'openai'] as const, 'sherpa-onnx'),
    ttsProvider: asEnum(raw.tts_provider, ['web-speech', 'openai'] as const, 'web-speech'),
    ttsVoice: raw.tts_voice || 'calm',
    ttsRate: asNumber(raw.tts_rate, 1.0),
    desktopVoiceLauncherEnabled: raw.desktop_voice_launcher_enabled === undefined ? true : asBool(raw.desktop_voice_launcher_enabled),
    desktopVoiceShortcutEnabled: raw.desktop_voice_shortcut_enabled === undefined ? true : asBool(raw.desktop_voice_shortcut_enabled),
    launchAtLogin: asBool(raw.launch_at_login),
    conversationAutoResume: raw.conversation_auto_resume === undefined ? true : asBool(raw.conversation_auto_resume),
    // Gmail (non-secret; connection state comes from GmailStatusDto, not here). Defaults mirror
    // SETTING_DEFAULTS so a fresh/older profile reads sensibly.
    gmailEnabled: asBool(raw.gmail_enabled),
    gmailClientId: raw.gmail_client_id ?? '',
    gmailNotifications: raw.gmail_notifications === undefined ? true : asBool(raw.gmail_notifications),
    gmailAiSummaries: raw.gmail_ai_summaries === undefined ? true : asBool(raw.gmail_ai_summaries),
    gmailStoreContext: raw.gmail_store_context === undefined ? true : asBool(raw.gmail_store_context),
    gmailAutoResearch: asBool(raw.gmail_auto_research),
    gmailDownloadAttachments: asBool(raw.gmail_download_attachments),
    gmailIncludeThreads: raw.gmail_include_threads === undefined ? true : asBool(raw.gmail_include_threads),
    gmailSyncMode: asEnum(raw.gmail_sync_mode, ['push', '5min', '15min', 'manual'] as const, '5min'),
    gmailMaxStored: asEnum(raw.gmail_max_stored, ['1000', '5000', 'unlimited'] as const, '1000'),
  };
}
