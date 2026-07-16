import { describe, it, expect } from 'vitest';
import { spokenReminder } from '../../core/tts/reminder-speech';

describe('spokenReminder', () => {
  it('greets first, then delivers the reminder conversationally', () => {
    expect(spokenReminder('Call Biplab')).toBe("Hi there. It's time to call Biplab.");
    expect(spokenReminder('Drink water')).toBe("Hi there. It's time to drink water.");
    expect(spokenReminder('Take medicine')).toBe("Hi there. It's time to take medicine.");
  });
  it('handles an empty title gracefully', () => {
    expect(spokenReminder('')).toBe("Hi there. It's time for your reminder.");
    expect(spokenReminder('   ')).toBe("Hi there. It's time for your reminder.");
  });
  it('never speaks the raw title with no framing', () => {
    expect(spokenReminder('Call Biplab')).not.toBe('Call Biplab');
    expect(spokenReminder('Call Biplab')).toMatch(/^Hi there\./);
  });
});
