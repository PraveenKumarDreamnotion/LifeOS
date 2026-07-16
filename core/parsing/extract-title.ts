/**
 * Title extraction (08 §7). The flakiest step, but the least dangerous to get wrong — the
 * user sees and edits the title on the confirmation card. An empty result is not an error;
 * it becomes the `missing_title` sibling of `no_date_at_all`.
 */
import type { ReminderIntent } from './types';

export function extractTitle(text: string, dateText: string, intent: ReminderIntent): string {
  if (intent === 'create_sing_reminder') return 'Play Yogi song';

  let t = text;

  // Remove what chrono consumed (the date/time phrase).
  if (dateText) t = t.replace(dateText, ' ');

  t = t
    // Command prefixes.
    .replace(/^\s*(?:please\s+)?remind\s+me\s*/i, '')
    .replace(/^\s*don'?t\s+let\s+me\s+forget\s*/i, '')
    .replace(/^\s*(?:please\s+)?make\s+sure\s+i\s*/i, '')
    // "set/add/create/make/give/schedule/new [me|us] [a|an|the] reminder [to|for]" — verb, optional
    // pronoun, optional article. So "set me a reminder to call X" strips to "call X" (the pronoun
    // form previously left "me a reminder to call X" as the title).
    .replace(/^\s*(?:set|add|create|make|give|schedule|new)\s+(?:me\s+|us\s+)?(?:a\s+|an\s+|the\s+)?reminders?\s*(?:to|for|about)?\s*/i, '')
    // A bare noun-led "reminder to call X" → "call X".
    .replace(/^\s*reminders?\s+(?:to|for|about)\s+/i, '')
    .replace(/^\s*wake\s+me\s*(?:up)?\s*/i, '')
    // Leading connectors: "to", "about", "that", "that I need to", "that I have to".
    .replace(/^\s*(?:that\s+)?i\s+(?:need|have)\s+to\s*/i, '')
    .replace(/^\s*(?:to|about|that|for)\s+/i, '')
    // Any leftover recurrence remnant.
    .replace(/\b(?:every|each)\s+\w+day\b/i, '')
    .replace(/\bevery\s*day\b/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/, '')
    .trim();

  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
