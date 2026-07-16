import { describe, it, expect } from 'vitest';
import { VOICE_CATALOG, openAiVoiceFor, windowsMatchFor, DEFAULT_VOICE_KEY } from '../../core/tts/voice-catalog';

describe('voice catalog', () => {
  const STABLE = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

  it('every friendly voice maps to a STABLE OpenAI voice (no 400 risk)', () => {
    for (const v of VOICE_CATALOG) expect(STABLE).toContain(v.openaiVoice);
  });

  it('openAiVoiceFor resolves known keys; unknown → alloy', () => {
    expect(openAiVoiceFor('warm_female')).toBe('nova');
    expect(openAiVoiceFor('calm')).toBe('alloy');
    expect(openAiVoiceFor('nonexistent')).toBe('alloy');
  });

  it('the default voice key exists in the catalog', () => {
    expect(VOICE_CATALOG.some((v) => v.key === DEFAULT_VOICE_KEY)).toBe(true);
  });

  it('windowsMatch picks a female OS voice for a female personality', () => {
    const m = windowsMatchFor('warm_female');
    expect(m('Microsoft Zira - English (United States)', 'en-US')).toBe(true);
    expect(m('Microsoft David - English (United States)', 'en-US')).toBe(false);
  });

  it('windowsMatch picks a male OS voice for a male personality', () => {
    const m = windowsMatchFor('pro_male');
    expect(m('Microsoft David Desktop', 'en-US')).toBe(true);
    expect(m('Microsoft Zira Desktop', 'en-US')).toBe(false);
  });
});
