import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  nextOccurrence,
  firstFireAt,
  nextFireAfter,
} from '../../core/scheduling/next-occurrence';
import { buildRule, parseRule, UnsupportedRecurrenceError, type ParsedRule } from '../../core/scheduling/rrule';

const KOL = 'Asia/Kolkata';
const NY = 'America/New_York';

function ms(iso: string, zone: string): number {
  return DateTime.fromISO(iso, { zone }).toMillis();
}
function local(msVal: number, zone: string): string {
  return DateTime.fromMillis(msVal, { zone }).toFormat("yyyy-LL-dd'T'HH:mm");
}
const daily = (hour: number, minute: number, interval = 1): ParsedRule => ({ freq: 'DAILY', interval, hour, minute });
const weekly = (weekdays: number[], hour: number, minute: number, interval = 1): ParsedRule => ({
  freq: 'WEEKLY',
  interval,
  weekdays,
  hour,
  minute,
});

describe('rrule build/parse', () => {
  it('round-trips a single-weekday weekly rule (back-compat string)', () => {
    const rule = buildRule({ freq: 'WEEKLY', interval: 1, weekdays: [1], hour: 7, minute: 0 });
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0');
    expect(parseRule(rule)).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [1], hour: 7, minute: 0 });
  });

  it('round-trips a daily rule (back-compat string)', () => {
    const rule = buildRule({ freq: 'DAILY', interval: 1, hour: 22, minute: 30 });
    expect(rule).toBe('FREQ=DAILY;BYHOUR=22;BYMINUTE=30');
    expect(parseRule(rule)).toEqual({ freq: 'DAILY', interval: 1, hour: 22, minute: 30 });
  });

  it('parses a legacy stored rule without INTERVAL', () => {
    expect(parseRule('FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0')).toEqual({
      freq: 'WEEKLY',
      interval: 1,
      weekdays: [1],
      hour: 7,
      minute: 0,
    });
  });

  it('round-trips interval + multiple weekdays', () => {
    const rule = buildRule({ freq: 'WEEKLY', interval: 2, weekdays: [3, 1, 5], hour: 9, minute: 15 });
    expect(rule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=15');
    expect(parseRule(rule)).toEqual({ freq: 'WEEKLY', interval: 2, weekdays: [1, 3, 5], hour: 9, minute: 15 });
  });

  it('round-trips monthly with COUNT', () => {
    const rule = buildRule({ freq: 'MONTHLY', interval: 1, hour: 8, minute: 0, count: 6 });
    expect(rule).toBe('FREQ=MONTHLY;BYHOUR=8;BYMINUTE=0;COUNT=6');
    expect(parseRule(rule)).toEqual({ freq: 'MONTHLY', interval: 1, hour: 8, minute: 0, count: 6 });
  });

  it('round-trips yearly with UNTIL', () => {
    const until = Date.UTC(2030, 0, 1, 0, 0, 0);
    const rule = buildRule({ freq: 'YEARLY', interval: 1, hour: 10, minute: 0, until });
    expect(rule).toBe('FREQ=YEARLY;BYHOUR=10;BYMINUTE=0;UNTIL=20300101T000000Z');
    expect(parseRule(rule)).toEqual({ freq: 'YEARLY', interval: 1, hour: 10, minute: 0, until });
  });

  it('rejects COUNT and UNTIL together, and unknown keys', () => {
    expect(() => parseRule('FREQ=DAILY;BYHOUR=8;BYMINUTE=0;COUNT=3;UNTIL=20300101T000000Z')).toThrow(
      UnsupportedRecurrenceError,
    );
    expect(() => parseRule('FREQ=DAILY;BYHOUR=8;BYMINUTE=0;BYSECOND=0')).toThrow(UnsupportedRecurrenceError);
    expect(() => parseRule('FREQ=HOURLY;BYHOUR=8;BYMINUTE=0')).toThrow(UnsupportedRecurrenceError);
  });
});

describe('nextOccurrence — weekly/daily (strictly after)', () => {
  it('finds the next Monday 07:00 from a Friday', () => {
    const from = ms('2026-07-10T16:18', KOL); // Friday
    expect(local(nextOccurrence(weekly([1], 7, 0), from, KOL), KOL)).toBe('2026-07-13T07:00');
  });

  it('finds TODAY when the weekly time is later today', () => {
    const from = ms('2026-07-10T16:18', KOL); // Friday 16:18
    expect(local(nextOccurrence(weekly([5], 18, 0), from, KOL), KOL)).toBe('2026-07-10T18:00');
  });

  it('rolls a daily reminder to tomorrow when today has passed', () => {
    const from = ms('2026-07-10T16:18', KOL);
    expect(local(nextOccurrence(daily(8, 0), from, KOL), KOL)).toBe('2026-07-11T08:00');
  });

  it('advances strictly past now (roll-forward after a fire)', () => {
    const fireTime = ms('2026-07-13T07:00', KOL);
    expect(local(nextOccurrence(weekly([1], 7, 0), fireTime, KOL), KOL)).toBe('2026-07-20T07:00');
  });
});

describe('nextOccurrence — DST', () => {
  it('keeps 7:00 AM wall-clock across US spring-forward', () => {
    const beforeDst = ms('2027-03-08T07:00', NY);
    expect(local(nextOccurrence(weekly([7], 7, 0), beforeDst, NY), NY)).toBe('2027-03-14T07:00');
  });

  it('resolves a 2:30 AM daily reminder on the spring-forward day', () => {
    const from = ms('2027-03-14T00:00', NY);
    const next = nextOccurrence(daily(2, 30), from, NY);
    const dt = DateTime.fromMillis(next, { zone: NY });
    expect(next).toBeGreaterThan(from);
    expect(dt.isValid).toBe(true);
    expect(dt.hour).toBeGreaterThanOrEqual(3);
  });

  it('handles fall-back (1:30 AM occurs twice) without throwing', () => {
    const from = ms('2027-11-07T00:00', NY);
    const dt = DateTime.fromMillis(nextOccurrence(daily(1, 30), from, NY), { zone: NY });
    expect(dt.hour).toBe(1);
    expect(dt.minute).toBe(30);
  });
});

describe('multi-weekday + interval weekly', () => {
  it('yields Mon/Wed/Fri in order', () => {
    const anchor = ms('2026-07-13T09:00', KOL); // Monday
    const rule = weekly([1, 3, 5], 9, 0);
    const a = firstFireAt(rule, anchor, KOL);
    expect(local(a, KOL)).toBe('2026-07-13T09:00'); // Mon
    const b = nextFireAfter(rule, a, a, KOL)!;
    expect(local(b, KOL)).toBe('2026-07-15T09:00'); // Wed
    const c = nextFireAfter(rule, a, b, KOL)!;
    expect(local(c, KOL)).toBe('2026-07-17T09:00'); // Fri
    const d = nextFireAfter(rule, a, c, KOL)!;
    expect(local(d, KOL)).toBe('2026-07-20T09:00'); // next Mon
  });

  it('every 2 weeks skips the off week', () => {
    const anchor = ms('2026-07-13T09:00', KOL); // Monday
    const rule = weekly([1], 9, 0, 2);
    const next = nextFireAfter(rule, anchor, anchor, KOL)!;
    expect(local(next, KOL)).toBe('2026-07-27T09:00'); // two weeks later, not one
  });

  it('firstFireAt snaps a non-selected start day forward to the first selected weekday', () => {
    const start = ms('2026-07-14T09:00', KOL); // Tuesday
    const rule = weekly([1, 3], 9, 0); // Mon/Wed
    expect(local(firstFireAt(rule, start, KOL), KOL)).toBe('2026-07-15T09:00'); // Wednesday
  });
});

describe('monthly / yearly with anchor', () => {
  it('every month preserves the 31st and clamps only where the month is short', () => {
    const anchor = ms('2026-01-31T09:00', KOL);
    const rule = daily(9, 0); // reused shape; override freq below
    const monthly: ParsedRule = { freq: 'MONTHLY', interval: 1, hour: 9, minute: 0 };
    void rule;
    const feb = nextFireAfter(monthly, anchor, anchor, KOL)!;
    expect(local(feb, KOL)).toBe('2026-02-28T09:00'); // clamped
    const mar = nextFireAfter(monthly, anchor, feb, KOL)!;
    expect(local(mar, KOL)).toBe('2026-03-31T09:00'); // back to the 31st (computed from anchor)
  });

  it('every 2 months steps by the interval', () => {
    const anchor = ms('2026-01-15T08:00', KOL);
    const rule: ParsedRule = { freq: 'MONTHLY', interval: 2, hour: 8, minute: 0 };
    const next = nextFireAfter(rule, anchor, anchor, KOL)!;
    expect(local(next, KOL)).toBe('2026-03-15T08:00');
  });

  it('every year lands on the same month/day', () => {
    const anchor = ms('2026-06-01T10:00', KOL);
    const rule: ParsedRule = { freq: 'YEARLY', interval: 1, hour: 10, minute: 0 };
    const next = nextFireAfter(rule, anchor, anchor, KOL)!;
    expect(local(next, KOL)).toBe('2027-06-01T10:00');
  });
});

describe('COUNT / UNTIL exhaustion', () => {
  it('returns null once COUNT occurrences are used up', () => {
    const anchor = ms('2026-07-13T07:00', KOL);
    const rule = daily(7, 0);
    rule.count = 3; // fires on days 1,2,3 then ends
    const d2 = nextFireAfter(rule, anchor, anchor, KOL)!; // after occ1
    expect(local(d2, KOL)).toBe('2026-07-14T07:00');
    const d3 = nextFireAfter(rule, anchor, d2, KOL)!; // after occ2
    expect(local(d3, KOL)).toBe('2026-07-15T07:00');
    expect(nextFireAfter(rule, anchor, d3, KOL)).toBeNull(); // after occ3 → done
  });

  it('returns null after the UNTIL instant', () => {
    const anchor = ms('2026-07-13T07:00', KOL);
    const rule = daily(7, 0);
    rule.until = ms('2026-07-15T23:59', KOL); // valid through the 15th
    const d2 = nextFireAfter(rule, anchor, anchor, KOL)!;
    expect(local(d2, KOL)).toBe('2026-07-14T07:00');
    const d3 = nextFireAfter(rule, anchor, d2, KOL)!;
    expect(local(d3, KOL)).toBe('2026-07-15T07:00');
    expect(nextFireAfter(rule, anchor, d3, KOL)).toBeNull(); // next would be the 16th → past UNTIL
  });
});
