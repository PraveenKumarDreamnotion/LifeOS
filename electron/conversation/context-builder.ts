/**
 * ContextBuilder (46 §New services, 31 §4.3) — assembles the per-turn `LlmTurnInput` from
 * validated main-process state. It is the ONLY place the reminder set is summarised for the model,
 * and it enforces the two privacy invariants:
 *   • the reminder summary is TITLES + RELATIVE TIME only — never ids, never epoch-ms (31 §4.3);
 *   • `memories: []` ships empty and wired, so EP-9 fills it additively (46 §MVP DECISION).
 * A prompt-injected model cannot exfiltrate a row it was never shown.
 */
import { ASSISTANT_TURN_JSON_SCHEMA } from '../../core/conversation/turn-schema';
import type { LlmTurnInput } from '../../core/llm/llm-provider';

/** Structural view of the reminder repo — decoupled from the concrete class for testability. */
export interface ReminderSummarySource {
  listActive(): { title: string; nextFireAt: number }[];
}

export type ConversationMessage = { role: 'user' | 'assistant'; text: string };

/** Cap the summary so a large schedule can't balloon the prompt (bounded context, 46 §Perf). */
const MAX_REMINDERS = 20;

export class ContextBuilder {
  constructor(
    private readonly reminders: ReminderSummarySource,
    private readonly now: () => number = () => Date.now(),
    private readonly timezone: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  ) {}

  build(messages: ConversationMessage[], system: string): LlmTurnInput {
    const nowMs = this.now();
    return {
      system,
      nowIso: new Date(nowMs).toISOString(),
      timezone: this.timezone(),
      reminders: this.reminders
        .listActive()
        .slice(0, MAX_REMINDERS)
        .map((r) => ({ title: r.title, relativeTime: relativeTime(r.nextFireAt, nowMs) })),
      messages,
      // EP-5 ships this empty; EP-9 fills it with non-sensitive matched facts (do-not-omit).
      memories: [],
      responseSchema: ASSISTANT_TURN_JSON_SCHEMA,
    };
  }
}

/** A coarse, human-readable "when" — no absolute time leaks to the model (31 §4.3). */
export function relativeTime(whenMs: number, nowMs: number): string {
  const diff = whenMs - nowMs;
  if (diff <= 0) return 'now or overdue';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
