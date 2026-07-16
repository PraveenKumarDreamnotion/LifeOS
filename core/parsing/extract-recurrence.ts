/**
 * Recurrence extraction — the layer chrono cannot provide (08 §3). chrono-node does not
 * parse recurrence; given "every Monday at 7 AM" it drops "every". Without this layer a
 * recurring reminder silently becomes a one-time reminder — the highest-severity parser bug.
 */

const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  sunday: 7, sun: 7,
};

// "every Monday", "each monday", "every mon"
const WEEKLY_RE = /\b(?:every|each)\s+(mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\b/i;
// "every day", "daily", "each day"
const DAILY_RE = /\b(?:every\s*day|each\s*day|daily)\b/i;
// unsupported, but must be DETECTED so we can refuse honestly rather than degrade silently
const UNSUPPORTED_RE =
  /\b(?:every|each)\s+(?:month|year|other|weekend|\d+\s*(?:days?|weeks?|months?|years?)|\d+(?:st|nd|rd|th))\b/i;

export interface RecurrenceExtraction {
  kind: 'none' | 'daily' | 'weekly' | 'unsupported';
  weekday?: number; // 1=Mon..7=Sun
  strippedText: string; // recurrence phrase removed, for chrono
}

export function extractRecurrence(text: string): RecurrenceExtraction {
  if (UNSUPPORTED_RE.test(text)) return { kind: 'unsupported', strippedText: text };

  const weekly = text.match(WEEKLY_RE);
  if (weekly) {
    const key = weekly[1]!.toLowerCase();
    const weekday = WEEKDAYS[key] ?? WEEKDAYS[key + 'day'];
    // Strip only the "every|each" token. Leave the weekday so chrono anchors the time to
    // the right day of week (it needs { forwardDate: true } to pick the coming one).
    return { kind: 'weekly', weekday, strippedText: text.replace(/\b(?:every|each)\s+/i, '') };
  }

  if (DAILY_RE.test(text)) {
    // Replace the recurrence phrase with "today" so chrono still resolves the time-of-day.
    return { kind: 'daily', strippedText: text.replace(DAILY_RE, 'today') };
  }

  return { kind: 'none', strippedText: text };
}
