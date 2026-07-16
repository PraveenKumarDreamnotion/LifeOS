/**
 * The Action contracts (36 §2) — the framework-free vocabulary the Action Dispatcher speaks.
 * These live behind the `core/` purity wall (30 §2.1): no electron, no zod-at-import, no DOM.
 *
 * EP-6 Scope A ships ONE executable action — `reminder_create` — whose fields come from the local
 * parser (the always-present offline reminder executor, 33 §6), NOT from unvalidated LLM output
 * (that surface stays closed until a later phase). So `input` is an already-validated
 * `CreateReminderInput`; the dispatcher stores it, a human confirms, the Execution Layer persists.
 * Further kinds (reminder_update/delete, memory_*, settings, research) land behind the SAME
 * dispatcher seam in their own phases (31 §8) — additive, no change to this contract.
 */
import type { CreateReminderInput } from '../types/ipc';

/** Create a reminder. `input` is ready-to-persist; `summary` is the resolved line the user confirms. */
export interface ReminderCreateAction {
  kind: 'reminder_create';
  input: CreateReminderInput;
  /** e.g. "Call Rahul · tomorrow 9:00 AM · one-time" — what the user actually confirms (36 §3). */
  summary: string;
}

/** The EP-6 action union. One member today; extended additively per phase. */
export type Action = ReminderCreateAction;

/** Provenance (36 §5): who produced the fields. Maps to the reminder `source` column
 *  (ui/voice → 'manual', llm → 'llm', local → 'local'). In Scope A creates are parser-produced. */
export type ActionSource = 'llm' | 'local' | 'ui' | 'voice';

/** What the dispatcher receives: a validated action + its provenance + the owning turn. */
export interface ActionEnvelope {
  action: Action;
  source: ActionSource;
  turnId: string;
  /** The chat session this action belongs to — stamped onto the reminder as provenance. */
  sessionId?: string | null;
}

/**
 * The display-ready proposal the renderer renders (never the raw stored action). Confirm relays
 * only the `turnId`; the dispatcher executes the STORED action for that id (36 §4.3), so the
 * renderer can never confirm an action it wasn't shown.
 */
export interface Proposal {
  turnId: string;
  kind: Action['kind'];
  /** The resolved, human-readable summary the user confirms. */
  summary: string;
}

/** The outcome of confirming/executing a stored proposal. */
export type DispatchResult =
  | { ok: true; summary: string; reminderId?: string }
  | { ok: false; code: string; message: string };
