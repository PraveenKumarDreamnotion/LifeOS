import { describe, it, expect } from 'vitest';
import { normalizeReminderText, isRemindVerbCue, editDistance } from '../../core/parsing/normalize-reminder';

describe('editDistance', () => {
  it('computes small distances and caps beyond max', () => {
    expect(editDistance('remind', 'remind')).toBe(0);
    expect(editDistance('remains', 'remind')).toBe(2);
    expect(editDistance('remained', 'remind')).toBe(2);
    expect(editDistance('completely', 'remind')).toBe(3); // > max(2) → capped to 3
  });
});

describe('isRemindVerbCue', () => {
  it('matches STT-garbled "remind" verb forms', () => {
    for (const w of ['remind', 'remained', 'remains', 'reminded', 'reminds']) {
      expect(isRemindVerbCue(w), w).toBe(true);
    }
  });
  it('does NOT match the noun "reminder", short words, or clearly-unrelated words', () => {
    for (const w of ['reminder', 'reminders', 'remote', 'remove', 'remedy', 'me', 'read', 'the']) {
      expect(isRemindVerbCue(w), w).toBe(false);
    }
  });

  it('MAY fuzzily match look-alikes like "remainder" — precision comes from the "me" gate', () => {
    // The cue function is intentionally fuzzy; normalizeReminderText only rewrites when the cue is
    // FOLLOWED BY "me", so "the remainder of 10" is never treated as a reminder (asserted below).
    expect(isRemindVerbCue('remainder')).toBe(true);
  });
});

describe('normalizeReminderText', () => {
  it('canonicalizes STT-corrupted cues to "remind me", dropping leading filler', () => {
    expect(normalizeReminderText('it remained me in one minute')).toBe('remind me in one minute');
    expect(normalizeReminderText('remains me to call John')).toBe('remind me to call John');
    expect(normalizeReminderText('it remind me in one minute')).toBe('remind me in one minute');
    expect(normalizeReminderText('who remind me after one minute')).toBe('remind me after one minute');
    expect(normalizeReminderText('hey yogi remind me tomorrow at 9 to call John')).toBe('remind me tomorrow at 9 to call John');
  });

  it('keeps meaningful content before the cue (e.g. a leading time phrase)', () => {
    expect(normalizeReminderText('after one minute remained me to call John')).toBe('after one minute remind me to call John');
  });

  it('leaves clean/typed reminder text unchanged', () => {
    expect(normalizeReminderText('remind me to call John')).toBe('remind me to call John');
    expect(normalizeReminderText('remind me in 10 minutes to drink water')).toBe('remind me in 10 minutes to drink water');
  });

  it('does NOT alter non-reminder sentences that merely contain look-alike words', () => {
    // "remainder"/"remained" NOT followed by "me" → untouched (no false reminder).
    expect(normalizeReminderText('what is the remainder of 10 divided by 3')).toBe('what is the remainder of 10 divided by 3');
    expect(normalizeReminderText('the meeting remained on schedule')).toBe('the meeting remained on schedule');
    expect(normalizeReminderText('set a reminder for 9am')).toBe('set a reminder for 9am'); // noun form preserved
  });
});
