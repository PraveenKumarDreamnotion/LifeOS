/**
 * The parse pipeline's types (15 §5, 08 Part I).
 *
 * ParseResult is a discriminated union with no null and no thrown exception for the
 * normal cases: ambiguity and refusal are RESULTS, not errors. Only a genuine bug throws.
 * This is what makes the confirmation-gate invariant checkable by reading a type — only
 * the `ok: true` branch carries a ParsedReminder, and only a ParsedReminder can become a
 * CreateReminderInput.
 */
import type { ActionType } from '../types/reminder';

/**
 * The reminder parser's 2-value intent (+ unknown). Named `ReminderIntent` (not `Intent`) since
 * EP-5 introduced the app-wide `ConversationIntent` taxonomy (core/conversation/intent.ts) — this
 * one is only about whether the LOCAL parser recognises a reminder, not the whole app's intents.
 */
export type ReminderIntent = 'create_reminder' | 'create_sing_reminder' | 'unknown';

export type Daypart = 'morning' | 'afternoon' | 'evening' | 'night';

export interface ParsedReminder {
  intent: Exclude<ReminderIntent, 'unknown'>;
  title: string;
  description: string | null;
  scheduledAtUtcMs: number;
  scheduledAtIso: string; // ISO 8601 with offset — for display and the LLM contract
  timezone: string; // IANA
  recurrenceRule: string | null;
  actionType: ActionType;
  confidence: number; // [0, 1]
  source: 'local' | 'llm';
  matchedDateText: string; // verbatim, for the confirmation card's transparency
}

export type Ambiguity =
  | { kind: 'no_date_at_all' }
  | { kind: 'missing_time'; resolvedDateUtcMs: number }
  | { kind: 'ambiguous_meridiem'; hour: number }
  | { kind: 'vague_daypart'; daypart: Daypart; resolvedDateUtcMs: number }
  | { kind: 'recurrence_without_time'; weekday: number }
  | { kind: 'unsupported_recurrence' }
  | { kind: 'missing_title' };

export interface TimeSuggestion {
  label: string;
  hour: number;
  minute: number;
  isPreselected: boolean;
}

export interface Clarification {
  ambiguity: Ambiguity;
  /** Spoken verbatim by Yogi and rendered verbatim on the card. */
  question: string;
  suggestions: TimeSuggestion[];
  /** Merge the user's answer into this and re-enter the pipeline. Never persisted. */
  partial: Partial<ParsedReminder>;
}

export interface Refusal {
  reason: 'unknown_intent' | 'unsupported_recurrence';
  message: string;
  examples: string[];
}

export type ParseResult =
  | { ok: true; reminder: ParsedReminder }
  | { ok: false; kind: 'clarification'; clarification: Clarification }
  | { ok: false; kind: 'refusal'; refusal: Refusal };
