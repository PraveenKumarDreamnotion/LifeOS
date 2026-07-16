import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { buildReminder, formFromRule, DEFAULT_REPEAT, type RepeatForm } from '../../src/features/schedules/repeat';
import { rruleToHuman } from '../../core/time/format';

const KOL = 'Asia/Kolkata';
const form = (over: Partial<RepeatForm>): RepeatForm => ({ ...DEFAULT_REPEAT, ...over });
const localOf = (ms: number) => DateTime.fromMillis(ms, { zone: KOL }).toFormat("yyyy-LL-dd'T'HH:mm");

describe('buildReminder — presets', () => {
  it('one time → no rule, exact instant', () => {
    const r = buildReminder('2026-08-15', '09:00', form({ preset: 'once' }), KOL);
    expect(r.recurrenceRule).toBeNull();
    expect(localOf(r.scheduledAtUtcMs)).toBe('2026-08-15T09:00');
  });

  it('every day', () => {
    const r = buildReminder('2026-08-15', '09:00', form({ preset: 'daily' }), KOL);
    expect(r.recurrenceRule).toBe('FREQ=DAILY;BYHOUR=9;BYMINUTE=0');
  });

  it('every week snaps to the chosen date’s weekday', () => {
    // 2026-08-15 is a Saturday (ISO weekday 6).
    const r = buildReminder('2026-08-15', '09:00', form({ preset: 'weekly' }), KOL);
    expect(r.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=SA;BYHOUR=9;BYMINUTE=0');
    expect(localOf(r.scheduledAtUtcMs)).toBe('2026-08-15T09:00');
  });

  it('every month / every year', () => {
    expect(buildReminder('2026-08-15', '09:00', form({ preset: 'monthly' }), KOL).recurrenceRule).toBe(
      'FREQ=MONTHLY;BYHOUR=9;BYMINUTE=0',
    );
    expect(buildReminder('2026-08-15', '09:00', form({ preset: 'yearly' }), KOL).recurrenceRule).toBe(
      'FREQ=YEARLY;BYHOUR=9;BYMINUTE=0',
    );
  });
});

describe('buildReminder — custom', () => {
  it('every 3 days', () => {
    const r = buildReminder('2026-08-15', '07:30', form({ preset: 'custom', unit: 'day', interval: 3 }), KOL);
    expect(r.recurrenceRule).toBe('FREQ=DAILY;INTERVAL=3;BYHOUR=7;BYMINUTE=30');
  });

  it('every 2 weeks on Mon/Wed/Fri', () => {
    const r = buildReminder(
      '2026-08-17', // a Monday
      '08:00',
      form({ preset: 'custom', unit: 'week', interval: 2, weekdays: [1, 3, 5] }),
      KOL,
    );
    expect(r.recurrenceRule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;BYHOUR=8;BYMINUTE=0');
  });

  it('ends after N occurrences (COUNT)', () => {
    const r = buildReminder('2026-08-15', '09:00', form({ preset: 'custom', unit: 'month', end: 'after', count: 6 }), KOL);
    expect(r.recurrenceRule).toBe('FREQ=MONTHLY;BYHOUR=9;BYMINUTE=0;COUNT=6');
  });

  it('ends on a date (UNTIL, end of day in zone)', () => {
    const r = buildReminder(
      '2026-08-15',
      '09:00',
      form({ preset: 'custom', unit: 'day', end: 'on', endDate: '2026-08-20' }),
      KOL,
    );
    // 2026-08-20 23:59:59.999 IST → 18:29:59 UTC.
    expect(r.recurrenceRule).toBe('FREQ=DAILY;BYHOUR=9;BYMINUTE=0;UNTIL=20260820T182959Z');
  });

  it('rejects an end date before the start', () => {
    expect(() =>
      buildReminder('2026-08-15', '09:00', form({ preset: 'custom', unit: 'day', end: 'on', endDate: '2026-08-01' }), KOL),
    ).toThrow();
  });
});

describe('formFromRule round-trips through the editor', () => {
  it('maps a plain weekly rule back to the weekly preset', () => {
    const f = formFromRule('FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0', KOL);
    expect(f.preset).toBe('weekly');
  });

  it('maps an interval/multi-day rule to custom', () => {
    const f = formFromRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=0', KOL);
    expect(f.preset).toBe('custom');
    expect(f.interval).toBe(2);
    expect(f.weekdays).toEqual([1, 3]);
  });

  it('maps a COUNT rule to custom / ends-after', () => {
    const f = formFromRule('FREQ=MONTHLY;BYHOUR=9;BYMINUTE=0;COUNT=6', KOL);
    expect(f.preset).toBe('custom');
    expect(f.end).toBe('after');
    expect(f.count).toBe(6);
  });
});

describe('rruleToHuman covers the new grammar', () => {
  const anchor = DateTime.fromISO('2026-08-15T09:00', { zone: KOL }).toMillis();
  it('describes monthly with the day-of-month from the anchor', () => {
    expect(rruleToHuman('FREQ=MONTHLY;BYHOUR=9;BYMINUTE=0', KOL, anchor)).toBe('Every month on the 15th at 9:00 AM');
  });
  it('describes an interval + multi-weekday rule', () => {
    expect(rruleToHuman('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;BYHOUR=8;BYMINUTE=0', KOL)).toBe(
      'Every 2 weeks on Mon, Wed, Fri at 8:00 AM',
    );
  });
  it('appends a COUNT end condition', () => {
    expect(rruleToHuman('FREQ=DAILY;BYHOUR=7;BYMINUTE=0;COUNT=5', KOL)).toBe('Every day at 7:00 AM, 5 times');
  });
});
