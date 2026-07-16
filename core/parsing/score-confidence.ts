/**
 * Confidence scoring (08 §6). These weights are a starting point tuned against the fixture
 * corpus, not derived from theory. Confidence never bypasses the confirmation gate; it only
 * controls how loudly Yogi hedges.
 */
import type { ParsedResult } from 'chrono-node';
import type { RecurrenceExtraction } from './extract-recurrence';

export function scoreConfidence(
  r: ParsedResult | null,
  rec: RecurrenceExtraction,
  title: string,
): number {
  if (!r) return 0;

  let s = 0.5;
  const c = r.start;

  if (c.isCertain('hour')) s += 0.2;
  if (c.isCertain('minute')) s += 0.05;
  if (c.isCertain('day')) s += 0.1;
  if (c.isCertain('meridiem')) s += 0.1;
  if (rec.kind === 'weekly' || rec.kind === 'daily') s += 0.05;

  const trimmed = title.trim();
  if (trimmed.length === 0) s -= 0.4; // parsed a time but no action
  else if (trimmed.length < 3) s -= 0.2;

  return Math.max(0, Math.min(1, s));
}
