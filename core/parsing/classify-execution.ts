/**
 * classifyReminderExecution — decide whether a reminder is a plain reminder (a task for the USER:
 * "call mom", "drink water") or an AI task for YOGI to perform at fire time and report back ("tell
 * me the contact details of NIT Hamirpur", "what's the weather tomorrow").
 *
 * This runs LOCALLY on the parser's extracted title (no LLM, works offline), keeping reminder
 * classification deterministic and consistent with "action fields come from the local parser, not
 * unvalidated LLM output" (36 §5). It is deliberately CONSERVATIVE — the cost of a false negative
 * is just today's behaviour (a plain reminder), and the confirmation gate ("Tomorrow 9am I'll look
 * up X and tell you — confirm?") backstops any false positive, so the user can decline or edit.
 *
 * v1 emits only the `web_search` capability (the one wired executor). The taxonomy supports
 * weather/news/email/calendar, but we don't classify into unimplemented capabilities.
 */
import type { ReminderExecutionSpec } from '../types/reminder-execution';

/**
 * Strong lead phrases that mean "Yogi, retrieve information and report." Conservative on purpose:
 * "tell me" (not "tell mom"), explicit lookups, and question forms. Excludes ambiguous phrases like
 * "let me know" / "remind me of" (recall, notifications) that aren't web lookups.
 */
const INFO_TASK_LEAD =
  /^\s*(?:tell me|find(?:\s+me)?|look\s*up|search(?:\s+for)?|research|get me the|what(?:'s| is| are)|what's the|how much (?:is|are)|how'?s the weather)\b/i;

/** Info nouns that, even without a lead verb, mark a lookup ("NIT Hamirpur contact details"). */
const INFO_NOUNS =
  /\b(?:contact details?|phone numbers?|email address(?:es)?|postal address|weather|forecast|temperature|news|headlines|latest on|price of|stock price|share price|exchange rate|match score|opening hours|timings?)\b/i;

/** Leading politeness stripped to turn the title into a bare lookup query. */
const LEAD_STRIP = /^\s*(?:tell me|let me know|show me|give me|get me(?: the)?|find(?:\s+me)?)\s+/i;

export function classifyReminderExecution(title: string): ReminderExecutionSpec | null {
  const t = title.trim();
  if (!t) return null;
  if (!INFO_TASK_LEAD.test(t) && !INFO_NOUNS.test(t)) return null;

  return {
    version: 1,
    type: 'ai_task',
    instruction: buildInstruction(t),
    capabilities: ['web_search'],
    outputFormat: 'spoken_answer',
    delivery: { notify: true, voice: true },
  };
}

/** Turn "Tell me the contact details of NIT Hamirpur" into a clean lookup query. */
function buildInstruction(title: string): string {
  const s = title.replace(LEAD_STRIP, '').trim() || title.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The confirmation lead that STATES the execution intent, so the user confirms what will actually
 * happen — "I'll look up the contact details of NIT Hamirpur and tell you" — rather than a vague
 * "remind you about X". This is what makes fire-time auto-execution legitimate under the
 * confirmation-gate invariant.
 */
export function executionSummaryLead(spec: ReminderExecutionSpec): string {
  const subject = spec.instruction.replace(/[.?!]+$/, '');
  const lowered = subject.charAt(0).toLowerCase() + subject.slice(1);
  return `I'll look up ${lowered} and tell you`;
}
