/**
 * Turns an Ambiguity into a spoken question + time-chip suggestions (08 §5.1, 12 §5.5).
 */
import { DateTime } from 'luxon';
import type { Ambiguity, Clarification, TimeSuggestion, ParsedReminder } from './types';

const WEEKDAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function sug(label: string, hour: number, minute: number, preselect = false): TimeSuggestion {
  return { label, hour, minute, isPreselected: preselect };
}

const GENERIC: TimeSuggestion[] = [sug('9:00 AM', 9, 0), sug('12:00 PM', 12, 0), sug('6:00 PM', 18, 0)];

const DAYPART_SUGGESTIONS: Record<string, TimeSuggestion[]> = {
  morning: [sug('7:00 AM', 7, 0), sug('8:00 AM', 8, 0), sug('9:00 AM', 9, 0, true)],
  afternoon: [sug('1:00 PM', 13, 0), sug('3:00 PM', 15, 0), sug('4:00 PM', 16, 0)],
  evening: [sug('5:00 PM', 17, 0), sug('6:00 PM', 18, 0), sug('7:00 PM', 19, 0)],
  night: [sug('9:00 PM', 21, 0), sug('10:00 PM', 22, 0), sug('11:00 PM', 23, 0)],
};

export function buildClarification(
  amb: Ambiguity,
  zone: string,
  partial: Partial<ParsedReminder>,
): Clarification {
  switch (amb.kind) {
    case 'no_date_at_all':
      return { ambiguity: amb, question: 'I can set that. When should I remind you?', suggestions: GENERIC, partial };

    case 'missing_title':
      return { ambiguity: amb, question: 'What should I remind you about?', suggestions: [], partial };

    case 'ambiguous_meridiem':
      return {
        ambiguity: amb,
        question: `Should that be ${amb.hour} in the morning, or ${amb.hour} in the evening?`,
        suggestions: [sug(`${amb.hour}:00 AM`, amb.hour, 0), sug(`${amb.hour}:00 PM`, amb.hour + 12, 0)],
        partial,
      };

    case 'missing_time': {
      const d = DateTime.fromMillis(amb.resolvedDateUtcMs, { zone });
      return {
        ambiguity: amb,
        question: `I can set that for ${d.toFormat('cccc, d LLLL')}. What time?`,
        suggestions: GENERIC,
        partial,
      };
    }

    case 'vague_daypart':
      return {
        ambiguity: amb,
        question: `You said ${amb.daypart}. What time — shall I suggest one?`,
        suggestions: DAYPART_SUGGESTIONS[amb.daypart] ?? GENERIC,
        partial,
      };

    case 'recurrence_without_time':
      return {
        ambiguity: amb,
        question:
          amb.weekday > 0
            ? `Every ${WEEKDAY_NAMES[amb.weekday]} — at what time?`
            : 'At what time should it repeat?',
        suggestions: GENERIC,
        partial,
      };

    case 'unsupported_recurrence':
      return {
        ambiguity: amb,
        question:
          'In chat I can repeat daily or weekly. For monthly, yearly or custom repeats, use “＋ New reminder” on the Schedules screen. Or would you like a one-time reminder?',
        suggestions: [],
        partial,
      };
  }
}
