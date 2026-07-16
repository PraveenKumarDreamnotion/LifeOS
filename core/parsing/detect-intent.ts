/**
 * Intent detection — a closed allow-list (08 §2). There is no `else` branch that does
 * something. Sing patterns are checked first because they are the more specific intent.
 */
import type { ReminderIntent } from './types';

const SING_PATTERNS = [/\bsing\b/i, /\bplay\b.*\b(?:yogi )?song\b/i, /\byogi song\b/i];

const REMIND_PATTERNS = [
  /\bremind me\b/i,
  /\bremind\b/i,
  /\bdon'?t (?:let me )?forget\b/i,
  /\bmake sure i\b/i,
  // Reminder as a NOUN command. "set a reminder" was matched before, but "set reminder" (no
  // article), "add/create/make/schedule/new reminder", and plurals were NOT — so a perfectly clear
  // "Set reminder after one minute to call X" fell through to the offline AI notice. Article optional.
  /\b(?:set|add|create|make|schedule|new)\s+(?:a\s+|an\s+|the\s+)?reminders?\b/i,
  // Verb + PRONOUN: "set me a reminder", "give me a reminder", "make us a reminder". Without this the
  // pronoun between the verb and "reminder" broke every pattern above — the exact reported failure
  // ("Set me a reminder after two minutes to call Biplab" was refused, so Yogi faked success).
  /\b(?:set|add|create|make|give|schedule)\s+(?:me|us)\s+(?:a\s+|an\s+|the\s+)?reminders?\b/i,
  /\bset an? .*reminder\b/i, // "set a <thing> reminder"
  /\bset an? alarm\b/i,
  // Noun-led: "reminder to call…", "reminder for 5pm", "reminder every Monday". "after"/"within" were
  // MISSING — so "reminder after two minutes" didn't match even though "reminder in 5 minutes" did.
  /\breminders?\s+(?:to|for|about|at|in|on|by|after|within|every|each|tomorrow|today|tonight|next)\b/i,
  /\bwake me\b/i,
  // Kept in lock-step with the router's reminder classifier (core/routing/local-intent.ts) so a
  // phrase it scores as a reminder also PARSES as one — otherwise it would refuse → offline notice.
  /\b(?:ping|nudge|buzz|alert|notify)\s+me\b/i,
];

export function detectIntent(text: string): ReminderIntent {
  if (SING_PATTERNS.some((p) => p.test(text))) return 'create_sing_reminder';
  if (REMIND_PATTERNS.some((p) => p.test(text))) return 'create_reminder';
  return 'unknown';
}
