import { describe, it, expect } from 'vitest';
import { classifyLocalIntent, LOCAL_CONFIDENCE_FLOOR } from '../../core/routing/local-intent';
import { makeLocalCommandRouter, formatTimeReply, formatDateReply } from '../../electron/main/chat/local-command-router';

const intentOf = (t: string) => classifyLocalIntent(t).intent;

describe('classifyLocalIntent — confidence-scored', () => {
  it('classifies clean deterministic commands (whole-command)', () => {
    expect(intentOf('what time is it')).toBe('time');
    expect(intentOf("what's the time")).toBe('time');
    expect(intentOf('what is the date')).toBe('date');
    expect(intentOf('what day is it')).toBe('date');
    expect(intentOf('open settings')).toBe('settings');
    expect(intentOf('go to preferences')).toBe('settings');
    expect(intentOf('show my reminders')).toBe('schedules');
    expect(intentOf('my schedule')).toBe('schedules');
    expect(intentOf('hello')).toBe('greeting');
    expect(intentOf('what can you do')).toBe('help');
  });

  it('scores reminders robustly across phrasing and word order', () => {
    for (const phrase of [
      'remind me to call John',
      'remind me in one minute',
      'remind me after one minute',
      'after one minute remind me',
      'in five minutes remind me',
      'Remind me to call Biplub after one minute',
      'After one minute remind me to call Biplub',
      'remind me tomorrow at 9',
      'remind me every Monday',
      'ping me in 5 minutes to stretch',
      "don't forget to call mom tomorrow",
      'wake me at 7 am',
    ]) {
      const c = classifyLocalIntent(phrase);
      expect(c.intent, phrase).toBe('reminder');
      expect(c.confidence, phrase).toBeGreaterThanOrEqual(LOCAL_CONFIDENCE_FLOOR);
    }
  });

  it('a reminder verb + a time expression scores higher than the verb alone', () => {
    expect(classifyLocalIntent('remind me to call John').confidence).toBeLessThan(
      classifyLocalIntent('remind me tomorrow at 9 to call John').confidence,
    );
  });

  it('does NOT match device commands with a tail — those fall through to the LLM', () => {
    expect(intentOf('what time is it in Tokyo')).toBe('none');
    expect(intentOf('what is the date of the French revolution')).toBe('none');
    expect(intentOf('open settings and enable dark mode')).toBe('none');
    expect(intentOf('hello, can you explain quantum physics')).toBe('none');
  });

  it('genuine reasoning is none (below the confidence floor)', () => {
    expect(intentOf('explain how photosynthesis works')).toBe('none');
    expect(intentOf('what is the capital of France')).toBe('none');
    expect(intentOf('write me a poem')).toBe('none');
    expect(intentOf('')).toBe('none');
  });
});

describe('makeLocalCommandRouter', () => {
  const now = () => new Date('2026-07-14T15:45:00+05:30').getTime();
  const deps = { now, timezone: () => 'Asia/Kolkata' };

  it('answers time and date locally in both modes', () => {
    const r = makeLocalCommandRouter(deps);
    for (const hasLlm of [true, false]) {
      expect(r('what time is it', hasLlm)?.reply).toMatch(/3:45\s?PM/i);
      expect(r('what is the date', hasLlm)?.reply).toMatch(/July 14, 2026/);
    }
  });

  it('handles greeting/help LOCALLY only when offline (online → null so the LLM answers)', () => {
    const r = makeLocalCommandRouter(deps);
    expect(r('hello', true)).toBeNull();
    expect(r('hello', false)?.reply).toMatch(/Yogi|reminder/i);
    expect(r('what can you do', true)).toBeNull();
    expect(r('what can you do', false)?.reply).toMatch(/reminder/i);
  });

  it('settings and schedules trigger navigation + reply', () => {
    const nav: string[] = [];
    const r = makeLocalCommandRouter({ ...deps, navigate: (s) => nav.push(s) });
    expect(r('open settings', false)?.reply).toMatch(/settings/i);
    expect(r('show my reminders', false)?.reply).toMatch(/schedule/i);
    expect(nav).toEqual(['settings', 'schedules']);
  });

  it('reminders and reasoning return null (not the router’s job)', () => {
    const r = makeLocalCommandRouter(deps);
    expect(r('remind me to call John', false)).toBeNull();
    expect(r('explain docker', false)).toBeNull();
  });
});

describe('date/time formatters', () => {
  it('format spoken-style time + date in the given zone', () => {
    const ms = new Date('2026-07-14T15:45:00+05:30').getTime();
    expect(formatTimeReply(ms, 'Asia/Kolkata')).toMatch(/It's 3:45\s?PM on Tuesday, July 14\./i);
    expect(formatDateReply(ms, 'Asia/Kolkata')).toBe('Today is Tuesday, July 14, 2026.');
  });
});
