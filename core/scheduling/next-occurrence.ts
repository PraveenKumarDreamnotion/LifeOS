/**
 * Occurrence computation with Luxon — DST-correct by construction (08 §12).
 * "Every Monday at 7 AM" means 7 AM wall-clock, which is what stepping a ZonedDateTime
 * preserves across a DST boundary.
 *
 * The model is stateless and anchor-based: the reminder's `scheduledAt` is occurrence #1 and
 * never changes; every later occurrence is `anchor.plus({unit: k*interval})` computed FROM the
 * anchor (never iteratively from the previous occurrence — that would let Luxon's month-length
 * clamping drift, e.g. Jan 31 → Feb 28 → Mar 28 instead of the correct Mar 31). COUNT and UNTIL
 * are just index/instant bounds applied over the generated stream, so a reminder can end without
 * any extra persisted state.
 */
import { DateTime } from 'luxon';
import { parseRule, type ParsedRule } from './rrule';

/** Safety cap so a malformed rule can never spin forever (the generator is infinite). */
const MAX_ITER = 20_000;

/**
 * All occurrences of `rule` at or after `anchorMs`, in chronological order, as an infinite
 * stream (the caller bounds it). `anchorMs` should be occurrence #1 for COUNT to line up.
 */
export function* occurrences(rule: ParsedRule, anchorMs: number, zone: string): Generator<number> {
  const interval = rule.interval ?? 1;
  const base = DateTime.fromMillis(anchorMs, { zone }).set({
    hour: rule.hour,
    minute: rule.minute,
    second: 0,
    millisecond: 0,
  });

  if (rule.freq === 'WEEKLY') {
    const weekdays = (rule.weekdays && rule.weekdays.length ? rule.weekdays : [base.weekday])
      .slice()
      .sort((a, b) => a - b);
    // Monday 00:00 of the anchor's ISO week; stepping in `interval`-week blocks keeps wall clock.
    const weekStart0 = base.startOf('week');
    for (let k = 0; ; k++) {
      const ws = weekStart0.plus({ weeks: k * interval });
      for (const wd of weekdays) {
        const occ = ws.set({
          weekday: wd as 1 | 2 | 3 | 4 | 5 | 6 | 7,
          hour: rule.hour,
          minute: rule.minute,
          second: 0,
          millisecond: 0,
        });
        const occMs = occ.toMillis();
        // In the anchor week, skip weekdays that fall before the anchor itself.
        if (k === 0 && occMs < anchorMs) continue;
        yield occMs;
      }
    }
  }

  const unit = rule.freq === 'DAILY' ? 'days' : rule.freq === 'MONTHLY' ? 'months' : 'years';
  for (let k = 0; ; k++) {
    // Compute from the anchor each step (not from the previous occurrence) — see file header.
    yield base.plus({ [unit]: k * interval }).toMillis();
  }
}

/**
 * The next occurrence STRICTLY AFTER `afterMs`, ignoring COUNT/UNTIL. Back-compat entry point
 * used by the parser to resolve a recurring reminder's first fire; also the primitive the
 * scheduler's bounded roll-forward is built on. For MONTHLY/YEARLY the day-of-month / month is
 * taken from `afterMs` (the parser only ever calls this for DAILY/WEEKLY).
 */
export function nextOccurrence(rule: ParsedRule, afterMs: number, zone: string): number {
  let i = 0;
  for (const occ of occurrences(rule, afterMs, zone)) {
    if (occ > afterMs) return occ;
    if (++i > MAX_ITER) break;
  }
  // Unreachable for a valid unbounded rule; degrade to "tomorrow" rather than throw.
  return DateTime.fromMillis(afterMs, { zone }).plus({ days: 1 }).toMillis();
}

/** First occurrence AT OR AFTER `fromMs` — the reminder's first fire (occurrence #1). */
export function firstFireAt(rule: ParsedRule, fromMs: number, zone: string): number {
  let i = 0;
  for (const occ of occurrences(rule, fromMs, zone)) {
    if (occ >= fromMs) return occ;
    if (++i > MAX_ITER) break;
  }
  return fromMs;
}

/**
 * The scheduler's roll-forward: the next occurrence strictly after `afterMs`, or `null` when the
 * recurrence has ended (COUNT exhausted or the next occurrence is past UNTIL). `anchorMs` MUST be
 * the reminder's `scheduledAt` (occurrence #1) so COUNT indexing is exact.
 */
export function nextFireAfter(
  rule: ParsedRule,
  anchorMs: number,
  afterMs: number,
  zone: string,
): number | null {
  let index = 0;
  for (const occ of occurrences(rule, anchorMs, zone)) {
    index++;
    if (rule.count !== undefined && index > rule.count) return null;
    if (rule.until !== undefined && occ > rule.until) return null;
    if (occ > afterMs) return occ;
    if (index > MAX_ITER) return null;
  }
  return null;
}

// ── String-keyed convenience wrappers (the scheduler/parser hold RRULE strings) ──────────────

export function nextOccurrenceFromString(rrule: string, afterMs: number, zone: string): number {
  return nextOccurrence(parseRule(rrule), afterMs, zone);
}

export function firstFireFromString(rrule: string, fromMs: number, zone: string): number {
  return firstFireAt(parseRule(rrule), fromMs, zone);
}

export function nextFireAfterFromString(
  rrule: string,
  anchorMs: number,
  afterMs: number,
  zone: string,
): number | null {
  return nextFireAfter(parseRule(rrule), anchorMs, afterMs, zone);
}
