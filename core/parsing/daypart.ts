/**
 * Vague time-of-day words. Detected independently of chrono because "after lunch" is not
 * a time chrono can parse, yet it must produce a daypart clarification, not silence.
 */
import type { Daypart } from './types';

const DAYPART_WORDS: Array<{ re: RegExp; daypart: Daypart }> = [
  { re: /\b(?:morning|breakfast)\b/i, daypart: 'morning' },
  { re: /\b(?:afternoon|after\s+lunch|lunch\s*time|midday|noon(?:ish)?)\b/i, daypart: 'afternoon' },
  { re: /\b(?:evening|after\s+dinner|dinner\s*time|sunset|tonight)\b/i, daypart: 'evening' },
  { re: /\b(?:night|midnight|late)\b/i, daypart: 'night' },
];

export function matchDaypart(text: string): Daypart | null {
  for (const { re, daypart } of DAYPART_WORDS) {
    if (re.test(text)) return daypart;
  }
  return null;
}
