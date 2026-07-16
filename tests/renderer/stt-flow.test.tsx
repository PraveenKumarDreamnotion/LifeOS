import { describe, it, expect } from 'vitest';
import { decideTranscriptAction } from '../../src/launcher/stt-flow';

const SID = '00000000-0000-0000-0000-000000000001';

describe('decideTranscriptAction — provider-specific launcher STT flow', () => {
  it('OpenAI STT (autoSubmit) with a session → submit the trimmed transcript hands-free', () => {
    expect(decideTranscriptAction({ autoSubmit: true, sessionId: SID, transcript: '  hey yogi  ' })).toEqual({
      type: 'submit',
      text: 'hey yogi',
    });
  });

  it('offline STT → review (editable draft + Send), never auto-submit', () => {
    expect(decideTranscriptAction({ autoSubmit: false, sessionId: SID, transcript: 'remind me to drink water' })).toEqual({
      type: 'review',
      text: 'remind me to drink water',
    });
  });

  it('an empty / whitespace-only transcript is ignored in both modes', () => {
    expect(decideTranscriptAction({ autoSubmit: true, sessionId: SID, transcript: '   ' })).toEqual({ type: 'ignore' });
    expect(decideTranscriptAction({ autoSubmit: false, sessionId: SID, transcript: '' })).toEqual({ type: 'ignore' });
  });

  it('autoSubmit but no active session → falls back to review (cannot submit into nothing)', () => {
    expect(decideTranscriptAction({ autoSubmit: true, sessionId: null, transcript: 'hello' })).toEqual({
      type: 'review',
      text: 'hello',
    });
  });
});
