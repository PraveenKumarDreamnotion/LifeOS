import { describe, it, expect } from 'vitest';
import { asBool, asNumber, asEnum, toSettingsDto } from '../../core/settings/typed-settings';

describe('typed settings coercion (D6)', () => {
  it('asBool only "true" is true', () => {
    expect(asBool('true')).toBe(true);
    expect(asBool('false')).toBe(false);
    expect(asBool('')).toBe(false);
    expect(asBool(undefined)).toBe(false);
  });

  it('asNumber falls back on non-numbers', () => {
    expect(asNumber('30000')).toBe(30000);
    expect(asNumber('1.0')).toBe(1);
    expect(asNumber('nope', 10)).toBe(10);
    expect(asNumber(undefined, 5)).toBe(5);
  });

  it('asEnum falls back on values outside the allowed set', () => {
    expect(asEnum('dark', ['system', 'light', 'dark'] as const, 'system')).toBe('dark');
    expect(asEnum('rainbow', ['system', 'light', 'dark'] as const, 'system')).toBe('system');
    expect(asEnum(undefined, ['tray', 'quit'] as const, 'tray')).toBe('tray');
  });

  it('toSettingsDto builds the typed DTO from the raw string map', () => {
    const dto = toSettingsDto(
      {
        reminders_paused: 'true',
        tts_enabled: 'false',
        theme: 'dark',
        close_action: 'quit',
        snooze_minutes: '15',
        ai_assist_enabled: 'true',
      },
      true,
    );
    expect(dto.remindersPaused).toBe(true);
    expect(dto.ttsEnabled).toBe(false);
    expect(dto.theme).toBe('dark');
    expect(dto.closeAction).toBe('quit');
    expect(dto.snoozeMinutes).toBe(15);
    expect(dto.aiEnabled).toBe(true);
    expect(dto.hasApiKey).toBe(true);
  });

  it('NEVER leaks the API key — even if the raw map still contained a ciphertext', () => {
    // getAllSafe already excludes ai_key_ciphertext; this asserts toSettingsDto would not surface
    // it even if present, and that hasApiKey is a pure boolean (invariant §8.4, 16 §6).
    const dto = toSettingsDto({ ai_key_ciphertext: 'ZW5jOnNrLXNlY3JldA==', theme: 'light' }, true);
    const json = JSON.stringify(dto);
    expect(json).not.toContain('ciphertext');
    expect(json).not.toContain('ZW5jOnNrLXNlY3JldA==');
    expect(dto.hasApiKey).toBe(true);
  });
});
