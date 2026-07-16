/**
 * Form state ↔ recurrence rule, for the reminder editor. All of the RRULE grammar and the
 * occurrence maths live in `core/scheduling` — this module only translates between the small set
 * of choices the UI offers and a `{ recurrenceRule, scheduledAtUtcMs }` pair the IPC layer accepts.
 *
 * Timezone rule (the classic bug this avoids): a wall-clock date+time is turned into an epoch
 * instant with `DateTime.fromObject(..., { zone })`, NEVER `new Date('2026-08-15T09:00')` — the
 * latter silently uses the host's system zone, which is not always the reminder's zone.
 */
import { DateTime } from 'luxon';
import { buildRule, parseRule, type Freq, type ParsedRule } from '../../../core/scheduling/rrule';
import { firstFireAt } from '../../../core/scheduling/next-occurrence';

export type RepeatPreset = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type CustomUnit = 'day' | 'week' | 'month' | 'year';
export type EndMode = 'never' | 'on' | 'after';

export interface RepeatForm {
  preset: RepeatPreset;
  /** Custom "every N <unit>". */
  unit: CustomUnit;
  interval: number;
  /** ISO weekdays (1=Mon..7=Sun) selected for a custom weekly rule. */
  weekdays: number[];
  end: EndMode;
  /** yyyy-mm-dd, for end === 'on'. */
  endDate: string;
  /** occurrence count, for end === 'after'. */
  count: number;
}

export const DEFAULT_REPEAT: RepeatForm = {
  preset: 'once',
  unit: 'week',
  interval: 1,
  weekdays: [],
  end: 'never',
  endDate: '',
  count: 10,
};

const UNIT_TO_FREQ: Record<CustomUnit, Freq> = {
  day: 'DAILY',
  week: 'WEEKLY',
  month: 'MONTHLY',
  year: 'YEARLY',
};

export interface BuiltReminder {
  recurrenceRule: string | null;
  scheduledAtUtcMs: number;
}

export class RepeatError extends Error {}

/**
 * Turn the editor's date, time and repeat choices into a rule + first-fire instant.
 * `dateStr` is yyyy-mm-dd, `timeStr` is HH:mm (24h), both wall-clock in `zone`.
 * Throws `RepeatError` with a user-facing message on invalid input.
 */
export function buildReminder(dateStr: string, timeStr: string, form: RepeatForm, zone: string): BuiltReminder {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  if (!y || !mo || !d || hh === undefined || mm === undefined || Number.isNaN(hh) || Number.isNaN(mm)) {
    throw new RepeatError('Pick a valid date and time.');
  }

  const start = DateTime.fromObject({ year: y, month: mo, day: d, hour: hh, minute: mm }, { zone });
  if (!start.isValid) throw new RepeatError('Pick a valid date and time.');
  const startMs = start.toMillis();

  if (form.preset === 'once') {
    return { recurrenceRule: null, scheduledAtUtcMs: startMs };
  }

  const rule = toParsedRule(form, start, zone);
  const recurrenceRule = buildRule(rule);
  // First fire = first occurrence at or after the chosen start (snaps weekly to a selected day).
  const scheduledAtUtcMs = firstFireAt(rule, startMs, zone);
  return { recurrenceRule, scheduledAtUtcMs };
}

function toParsedRule(form: RepeatForm, start: DateTime, zone: string): ParsedRule {
  const hour = start.hour;
  const minute = start.minute;

  let freq: Freq;
  let interval = 1;
  let weekdays: number[] | undefined;

  if (form.preset === 'custom') {
    freq = UNIT_TO_FREQ[form.unit];
    interval = Math.max(1, Math.floor(form.interval));
    if (freq === 'WEEKLY') {
      weekdays = form.weekdays.length ? [...form.weekdays].sort((a, b) => a - b) : [start.weekday];
    }
  } else if (form.preset === 'weekly') {
    freq = 'WEEKLY';
    weekdays = [start.weekday];
  } else if (form.preset === 'monthly') {
    freq = 'MONTHLY';
  } else if (form.preset === 'yearly') {
    freq = 'YEARLY';
  } else {
    freq = 'DAILY'; // 'daily' (and the unreachable 'once', handled by the caller)
  }

  const rule: ParsedRule = { freq, interval, hour, minute };
  if (weekdays) rule.weekdays = weekdays;

  // End condition (custom only; presets never end).
  if (form.preset === 'custom') {
    if (form.end === 'after') {
      rule.count = Math.max(1, Math.floor(form.count));
    } else if (form.end === 'on') {
      if (!form.endDate) throw new RepeatError('Pick an end date, or choose “Never”.');
      const [ey, em, ed] = form.endDate.split('-').map(Number);
      const until = DateTime.fromObject({ year: ey, month: em, day: ed }, { zone }).endOf('day');
      if (!until.isValid) throw new RepeatError('Pick a valid end date.');
      if (until.toMillis() < start.toMillis()) throw new RepeatError('The end date is before the start.');
      rule.until = until.toMillis();
    }
  }

  return rule;
}

/** Best-effort reverse: seed the editor form from an existing reminder's rule. */
export function formFromRule(recurrenceRule: string | null, zone: string): RepeatForm {
  if (!recurrenceRule) return { ...DEFAULT_REPEAT };
  let rule: ParsedRule;
  try {
    rule = parseRule(recurrenceRule);
  } catch {
    return { ...DEFAULT_REPEAT };
  }

  const iv = rule.interval ?? 1;
  const form: RepeatForm = { ...DEFAULT_REPEAT, interval: iv };

  const freqToUnit: Record<Freq, CustomUnit> = {
    DAILY: 'day',
    WEEKLY: 'week',
    MONTHLY: 'month',
    YEARLY: 'year',
  };
  form.unit = freqToUnit[rule.freq];
  if (rule.weekdays) form.weekdays = [...rule.weekdays];

  const bounded = rule.count !== undefined || rule.until !== undefined;
  const simpleWeekly = rule.freq === 'WEEKLY' && (rule.weekdays?.length ?? 0) === 1;

  // A plain, unbounded, interval-1 rule maps back to a named preset; anything richer is "custom".
  if (!bounded && iv === 1 && (rule.freq !== 'WEEKLY' || simpleWeekly)) {
    form.preset = ({ DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' } as const)[rule.freq];
  } else {
    form.preset = 'custom';
    if (rule.count !== undefined) {
      form.end = 'after';
      form.count = rule.count;
    } else if (rule.until !== undefined) {
      form.end = 'on';
      form.endDate = DateTime.fromMillis(rule.until, { zone }).toFormat('yyyy-LL-dd');
    }
  }

  return form;
}
