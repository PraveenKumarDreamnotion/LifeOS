/**
 * Ambiguity detection (08 §5) — the heart of the system. Uses chrono's
 * ParsedComponents.isCertain() to distinguish what the user SAID from what chrono
 * DEFAULTED. Never auto-assigns an ambiguous meridiem: a wrong-half-of-day reminder is
 * worse than a question.
 */
import type { ParsedResult } from 'chrono-node';
import type { Ambiguity } from './types';
import type { RecurrenceExtraction } from './extract-recurrence';
import { matchDaypart } from './daypart';

export function detectAmbiguity(
  r: ParsedResult | null,
  rec: RecurrenceExtraction,
  rawText: string,
): Ambiguity | null {
  if (rec.kind === 'unsupported') return { kind: 'unsupported_recurrence' };

  // "remind me to call Rahul" / "remind me later" — nothing chrono could resolve.
  if (!r) {
    const daypart = matchDaypart(rawText);
    if (daypart) return { kind: 'vague_daypart', daypart, resolvedDateUtcMs: Date.now() };
    return { kind: 'no_date_at_all' };
  }

  const c = r.start;
  const hourCertain = c.isCertain('hour');

  // "remind me at 6" → 6 AM or 6 PM? NEVER guess. Checked FIRST and with no override.
  if (hourCertain && !c.isCertain('meridiem') && (c.get('hour') ?? 0) <= 12) {
    return { kind: 'ambiguous_meridiem', hour: c.get('hour') ?? 0 };
  }

  // "remind me every Monday" → at what time?
  if (rec.kind !== 'none' && !hourCertain) {
    return { kind: 'recurrence_without_time', weekday: rec.weekday ?? 0 };
  }

  // "remind me tomorrow morning" → propose a time, but ASK.
  const daypart = matchDaypart(rawText);
  if (daypart && !hourCertain) {
    return { kind: 'vague_daypart', daypart, resolvedDateUtcMs: r.date().getTime() };
  }

  // "remind me Friday" → chrono defaulted the hour. Ask.
  if (!hourCertain) {
    return { kind: 'missing_time', resolvedDateUtcMs: r.date().getTime() };
  }

  return null; // unambiguous
}
