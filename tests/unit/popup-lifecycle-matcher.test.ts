import { describe, it, expect } from 'vitest';
import { matchPopupLifecycle, parseSnoozeMinutes, formatSnooze } from '../../electron/actions/popup-lifecycle-matcher';

describe('matchPopupLifecycle', () => {
  it('recognises complete phrasings', () => {
    for (const t of ['done', 'completed', "I've finished it", 'I already called him', 'did it', 'mark it complete']) {
      expect(matchPopupLifecycle(t).kind).toBe('complete');
    }
  });

  it('recognises snooze phrasings with a duration', () => {
    expect(matchPopupLifecycle('snooze 30 minutes')).toEqual({ kind: 'snooze', minutes: 30 });
    expect(matchPopupLifecycle('remind me again in 2 hours')).toEqual({ kind: 'snooze', minutes: 120 });
    expect(matchPopupLifecycle('snooze an hour')).toEqual({ kind: 'snooze', minutes: 60 });
    expect(matchPopupLifecycle('remind me later')).toEqual({ kind: 'snooze', minutes: 10 }); // default
  });

  it('recognises cancel/delete', () => {
    for (const t of ['cancel this reminder', 'delete it', 'remove this']) {
      expect(matchPopupLifecycle(t).kind).toBe('cancel');
    }
  });

  it('treats questions / small talk as none (→ chat)', () => {
    for (const t of ['what was this about?', 'thanks', 'who are you', 'tell me a joke']) {
      expect(matchPopupLifecycle(t).kind).toBe('none');
    }
  });

  it('parseSnoozeMinutes handles minutes and hours', () => {
    expect(parseSnoozeMinutes('in 45 min')).toBe(45);
    expect(parseSnoozeMinutes('3 hours')).toBe(180);
    expect(parseSnoozeMinutes('half an hour')).toBe(30);
    expect(parseSnoozeMinutes('snooze')).toBe(10);
  });

  it('formatSnooze reads naturally', () => {
    expect(formatSnooze(30)).toBe('30 minutes');
    expect(formatSnooze(60)).toBe('1 hour');
    expect(formatSnooze(120)).toBe('2 hours');
  });
});
