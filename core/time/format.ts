/**
 * Absolute + relative time rendering (12 §5.4). The confirmation card always shows both:
 * the absolute form is what gets stored; the relative form is the sanity check.
 */
import { DateTime } from 'luxon';
import { parseRule } from '../scheduling/rrule';

/** "Tomorrow — Saturday, 11 July 2026, 9:00 AM" */
export function formatAbsolute(utcMs: number, zone: string): string {
  const d = DateTime.fromMillis(utcMs, { zone });
  const now = DateTime.now().setZone(zone);
  const dayDiff = d.startOf('day').diff(now.startOf('day'), 'days').days;

  let prefix = '';
  if (dayDiff === 0) prefix = 'Today — ';
  else if (dayDiff === 1) prefix = 'Tomorrow — ';

  return prefix + d.toFormat('cccc, d LLLL yyyy, h:mm a');
}

/** "in 15 hours 20 minutes" / "in 2 minutes" */
export function formatRelative(utcMs: number, fromMs: number = Date.now()): string {
  const diffMs = utcMs - fromMs;
  if (diffMs <= 0) return 'now';

  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;

  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) {
    return remMins
      ? `in ${hours} hour${hours === 1 ? '' : 's'} ${remMins} minute${remMins === 1 ? '' : 's'}`
      : `in ${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const days = Math.floor(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

/**
 * "Every Monday at 7:00 AM" — the UI never says "cron" or "RRULE" (08 §17). Covers the full
 * grammar: intervals ("Every 2 weeks"), multiple weekdays, monthly/yearly, and COUNT/UNTIL end
 * conditions. `anchorMs` (the reminder's scheduledAt) supplies the day-of-month / month a
 * monthly or yearly rule doesn't encode.
 *
 * D2 (30): the RRULE grammar lives in ONE place — `rrule.ts` `parseRule`. This reuses it instead
 * of re-implementing the regexes. `parseRule` throws on an unknown/legacy rule, so it is wrapped
 * to preserve the "Custom schedule" fallback.
 */
export function rruleToHuman(rule: string | null, zone: string, anchorMs?: number): string {
  if (!rule) return 'Does not repeat';

  let parsed;
  try {
    parsed = parseRule(rule);
  } catch {
    return 'Custom schedule';
  }

  const iv = parsed.interval ?? 1;
  const time = DateTime.fromObject({ hour: parsed.hour, minute: parsed.minute }, { zone }).toFormat('h:mm a');
  const anchor = anchorMs !== undefined ? DateTime.fromMillis(anchorMs, { zone }) : null;

  let base: string;
  if (parsed.freq === 'DAILY') {
    base = iv === 1 ? 'Every day' : `Every ${iv} days`;
  } else if (parsed.freq === 'WEEKLY') {
    const days = parsed.weekdays ?? [];
    if (days.length === 7) {
      base = iv === 1 ? 'Every day' : `Every ${iv} weeks, every day`;
    } else if (iv === 1 && days.length === 1) {
      base = `Every ${WEEKDAY_NAMES[days[0]!]}`;
    } else {
      const list = days.map((d) => WEEKDAY_SHORT[d]).join(', ');
      base = iv === 1 ? `Every ${list}` : `Every ${iv} weeks on ${list}`;
    }
  } else if (parsed.freq === 'MONTHLY') {
    base = iv === 1 ? 'Every month' : `Every ${iv} months`;
    if (anchor) base += ` on the ${ordinal(anchor.day)}`;
  } else {
    base = iv === 1 ? 'Every year' : `Every ${iv} years`;
    if (anchor) base += ` on ${anchor.toFormat('LLLL d')}`;
  }

  let out = `${base} at ${time}`;
  if (parsed.count !== undefined) {
    out += `, ${parsed.count} time${parsed.count === 1 ? '' : 's'}`;
  } else if (parsed.until !== undefined) {
    out += `, until ${DateTime.fromMillis(parsed.until, { zone }).toFormat('d LLL yyyy')}`;
  }
  return out;
}
