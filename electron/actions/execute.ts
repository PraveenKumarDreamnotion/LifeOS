/**
 * ExecutionLayer (36 §5) — the ONLY mutator. It runs only after the Confirmation Layer resolves,
 * on the already-validated stored action. There is still exactly one writer per entity (36 §7):
 * reminder_create reuses the same reminder repository the direct path uses, so the persisted row
 * is byte-identical (minus id/timestamps) to the EP-2 path — the mandated regression gate (41 §6).
 */
import type { Action, ActionSource, DispatchResult } from '../../core/actions/action';
import type { CreateReminderInput } from '../../core/types/ipc';
import type { ReminderSource } from '../../core/types/reminder';

export interface ExecutionDeps {
  /** Persist a reminder: the SAME writer the direct path calls (repo.create + reconcile + broadcast).
   *  Returns the created reminder id so the turn can be settled with a real link. */
  createReminder: (input: CreateReminderInput, sessionId: string | null) => string;
}

export function executeAction(
  action: Action,
  source: ActionSource,
  deps: ExecutionDeps,
  sessionId: string | null = null,
): DispatchResult {
  switch (action.kind) {
    case 'reminder_create': {
      // Provenance (36 §5): the reminder `source` column reflects who produced the fields;
      // `session_id` links it to the chat that created it.
      const reminderId = deps.createReminder({ ...action.input, source: mapSource(source) }, sessionId);
      return { ok: true, summary: action.summary, reminderId };
    }
    default:
      return { ok: false, code: 'unsupported_action', message: "I can't do that yet." };
  }
}

/** ui/voice → 'manual', llm → 'llm', local → 'local' (36 §5). */
function mapSource(s: ActionSource): ReminderSource {
  if (s === 'llm') return 'llm';
  if (s === 'local') return 'local';
  return 'manual';
}
