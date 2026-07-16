/**
 * Settings: key/value TEXT with typed defaults (10 §7). No JSON blob, no ORM.
 */
import type { SqliteDriver } from './driver';

export const SETTING_DEFAULTS = {
  onboarding_completed: 'false',
  tray_notice_shown: 'false',
  reminders_paused: 'false',
  theme: 'system',
  tts_enabled: 'true',
  tts_voice_id: '',
  tts_rate: '1.0',
  tts_degraded: 'false',
  stt_provider: 'sherpa-onnx',
  notification_sound: 'true',
  snooze_minutes: '10',
  tick_interval_ms: '30000',
  close_action: 'tray',
  ai_assist_enabled: 'false',
  ai_provider: 'openai',
  ai_model: 'gpt-4o-mini',
  ai_only_when_uncertain: 'true',
  ai_consent_accepted_at: '',
  ai_last_used_at: '',
  ai_key_ciphertext: '',
  // EP-3: per-feature STT consent (ISO timestamp; presence = accepted, 32 §2) + the transcription
  // model (overridable without a release, 32 §1). Absent consent ⇒ STT stays offline (sherpa).
  stt_consented_at: '',
  // Full gpt-4o-transcribe (was the -mini tier): lower WER for a small cost bump. Overridable
  // without a release. Existing installs keep their seeded value; new installs get the better model.
  stt_model: 'gpt-4o-transcribe',
  // EP-4: TTS provider + the chosen friendly voice + per-feature consent. `tts_voice` is the
  // friendly key (survives a provider switch); it resolves to an OpenAI id or an OS voice at use
  // time (35 §1). The orphaned tts_voice_id/tts_rate/tts_degraded are now read/written too.
  tts_provider: 'web-speech',
  tts_voice: 'calm',
  tts_consented_at: '',
  // EP-2 rollback flag (41 §10): on → new conversation ChatScreen; off → the retained v0.2
  // single-shot screen. Default on at v0.3; no migration (seeded via INSERT OR IGNORE).
  conversation_ui_enabled: 'true',
  // EP-6 rollback flag (41 §6, §10): on → reminder create flows through the Action Dispatcher
  // (validate → confirm → execute); off → EP-2's direct ipc.createReminder path. Flipped on once
  // the renderer renders dispatcher proposals AND the byte-identical row check passes (47 §DoD #8).
  dispatcher_enabled: 'true',
  // EP-7 rollback flag (48 §Rollback): on → a pending proposal can be confirmed/cancelled by voice
  // ("yes"/"no", matched locally in main); off → button-only confirmation (identical to EP-6).
  voice_confirm_enabled: 'true',
  // Reminder popup flag (55 §10): on → a fired reminder shows the always-on-top conversational
  // popup; off → the retained in-app TriggerModal. Notification + history fire regardless.
  reminder_popup_enabled: 'true',
  // Web search (57): on → Yogi may call the web_search tool for live-info questions when AI assist
  // is on+keyed+consented; off → answers from the model only. Kill switch.
  web_search_enabled: 'true',
  search_model: 'gpt-4o-mini-search-preview',
  // Track A: LLM cleanup pass on dictation (punctuation/filler/casing) — the Wispr-Flow quality
  // lever. Online-only, reuses AI-assist consent; kill switch. Off → dictation is inserted raw.
  stt_cleanup_enabled: 'true',
  desktop_voice_launcher_enabled: 'true',
  desktop_voice_shortcut_enabled: 'true',
  // Start LifeOS (to the tray) at Windows login so the scheduler runs more of the time and fewer
  // reminders are missed. Opt-in, off by default. Does not help while the PC is fully off — the
  // startup catch-up summary covers that.
  launch_at_login: 'false',
  // After a reminder interrupts a voice conversation, automatically bring it back: re-open the
  // launcher, re-read the reply that was cut off, then resume listening. Off → the launcher just
  // re-opens ready and waits for the user to continue.
  conversation_auto_resume: 'true',
  launcher_x: '',
  launcher_y: '',
  // Gmail integration (docs/lifeos-planning/gmail-integration.md §5). Non-secret feature toggles +
  // sync policy + the non-secret Client ID. The two *_ciphertext keys hold safeStorage-encrypted
  // secrets (tokens, client secret) and are EXCLUDED from getAllSafe — they never cross IPC.
  gmail_enabled: 'false',
  gmail_client_id: '',
  gmail_notifications: 'true',
  gmail_ai_summaries: 'true',
  gmail_store_context: 'true',
  gmail_auto_research: 'false',
  gmail_download_attachments: 'false',
  gmail_include_threads: 'true',
  gmail_sync_mode: '5min',
  gmail_max_stored: '1000',
  gmail_token_ciphertext: '',
  gmail_client_secret_ciphertext: '',
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export class SettingsRepository {
  constructor(private readonly db: SqliteDriver) {}

  /** Insert any missing defaults. Idempotent — safe to call on every startup. */
  seedDefaults(): void {
    const now = Date.now();
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
        this.db.run(
          'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
          [key, value, now],
        );
      }
    });
  }

  get(key: SettingKey): string {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value ?? SETTING_DEFAULTS[key];
  }

  set(key: SettingKey, value: string): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, Date.now()],
    );
  }

  /** All settings EXCEPT encrypted secrets, which must never cross IPC (16 §6). The Gmail token
   *  bundle and OAuth client secret are safeStorage ciphertext — excluded exactly like the API key. */
  getAllSafe(): Record<string, string> {
    const rows = this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const out: Record<string, string> = {};
    for (const { key, value } of rows) {
      if (key === 'ai_key_ciphertext') continue;
      if (key === 'gmail_token_ciphertext') continue;
      if (key === 'gmail_client_secret_ciphertext') continue;
      out[key] = value;
    }
    return out;
  }

  hasApiKey(): boolean {
    return this.get('ai_key_ciphertext').length > 0;
  }
}
