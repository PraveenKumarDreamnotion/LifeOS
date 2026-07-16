import { describe, it, expect } from 'vitest';
import { matchVoiceConfirm } from '../../electron/actions/voice-confirm-matcher';

describe('matchVoiceConfirm', () => {
  it('matches clear affirmations', () => {
    for (const t of ['yes', 'Yeah', 'yep', 'confirm', 'sure', 'okay', 'OK.', 'do it', 'go ahead', 'sounds good']) {
      expect(matchVoiceConfirm(t)).toBe('affirm');
    }
  });

  it('matches clear negations', () => {
    for (const t of ['no', 'Nope', 'nah', 'cancel', 'stop', "don't", 'never mind', 'forget it', 'no thanks']) {
      expect(matchVoiceConfirm(t)).toBe('negate');
    }
  });

  it('matches repeat requests', () => {
    for (const t of ['repeat', 'say again', 'what was that', 'read it back', 'what did you say?']) {
      expect(matchVoiceConfirm(t)).toBe('repeat');
    }
  });

  it('returns neither for ambiguous / qualified / empty utterances (fails safe)', () => {
    for (const t of ['maybe later', "I'm not sure", 'hmm', '', '   ', 'remind me to call mom']) {
      expect(matchVoiceConfirm(t)).toBe('neither');
    }
  });

  it('a QUALIFIED yes is NOT a confirm (false-positive prevention)', () => {
    expect(matchVoiceConfirm('yes but change the time to 8')).toBe('neither');
    expect(matchVoiceConfirm('yes, actually make it 9')).toBe('neither');
    expect(matchVoiceConfirm('sure but move it instead')).toBe('neither');
  });

  it('negate wins when both a yes and a no appear (fails safe to cancel)', () => {
    expect(matchVoiceConfirm('no yes')).toBe('negate');
    expect(matchVoiceConfirm('yes no')).toBe('negate');
  });

  it('is punctuation- and case-insensitive', () => {
    expect(matchVoiceConfirm('YES!')).toBe('affirm');
    expect(matchVoiceConfirm('  no. ')).toBe('negate');
  });

  it('does not match a yes hidden inside another word', () => {
    expect(matchVoiceConfirm('yesterday')).toBe('neither'); // word-boundary, not substring
  });
});
