/**
 * ActionDispatcher (36 §2) — the one central place every proposed action flows through:
 * validate → (store + propose) → confirm → execute. In EP-6 Scope A it handles `reminder_create`,
 * whose fields come pre-validated from the local parser; the remaining gate is the business-rule
 * check (Gate 2 — date-in-past / too-far / sing+recurring) so an un-persistable reminder never
 * becomes a confirmable card.
 *
 * The pending-proposal invariant (36 §4.3): `confirm(turnId)` executes the STORED action; it takes
 * no action payload, so the renderer can't confirm an action it wasn't shown. Unknown/expired ids
 * are rejected.
 */
import type { ActionEnvelope, Action, ActionSource, Proposal, DispatchResult } from '../../core/actions/action';
import type { CreateReminderInput } from '../../core/types/ipc';
import type { ConfirmationStore } from './confirmation-store';

export interface DispatcherDeps {
  store: ConfirmationStore;
  /** Business-rule gate (throws on invalid — e.g. ValidationError with .code/.message). */
  validate: (input: CreateReminderInput) => void;
  /** Execution Layer — the only mutator; runs on confirm. */
  execute: (action: Action, source: ActionSource, sessionId: string | null) => DispatchResult;
}

export type ProposeResult = { proposal: Proposal } | { error: { code: string; message: string } };

export class ActionDispatcher {
  constructor(private readonly deps: DispatcherDeps) {}

  /** Validate + store a pending proposal. Returns the display proposal, or an error to show. */
  propose(env: ActionEnvelope): ProposeResult {
    const { action, turnId, source } = env;
    if (action.kind === 'reminder_create') {
      try {
        this.deps.validate(action.input); // Gate 2 — throws → not confirmable
      } catch (e) {
        return { error: toError(e) };
      }
      this.deps.store.put(turnId, action, source, env.sessionId ?? null);
      return { proposal: { turnId, kind: action.kind, summary: action.summary } };
    }
    return { error: { code: 'unsupported_action', message: "I can't do that yet." } };
  }

  /** Execute the STORED proposal for this turnId (36 §4.3). Rejects unknown/expired ids. A throw in
   *  the Execution Layer (e.g. persistence/verification failed) is caught and returned as a failure
   *  DispatchResult — so the turn is always SETTLED (never left pending) and success is never claimed
   *  for a reminder that wasn't actually stored + scheduled (reported reliability bug). */
  confirm(turnId: string): DispatchResult {
    const stored = this.deps.store.take(turnId);
    if (!stored) {
      return { ok: false, code: 'no_pending_proposal', message: 'That request has expired — please ask again.' };
    }
    try {
      return this.deps.execute(stored.action, stored.source, stored.sessionId);
    } catch (e) {
      const { code, message } = toError(e);
      return { ok: false, code, message: message || "I couldn't create that reminder because of an internal error." };
    }
  }

  cancel(turnId: string): void {
    this.deps.store.clear(turnId);
  }
}

function toError(e: unknown): { code: string; message: string } {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
    const err = e as { code: unknown; message: unknown };
    if (typeof err.code === 'string' && typeof err.message === 'string') {
      return { code: err.code, message: err.message };
    }
  }
  return { code: 'invalid_action', message: 'That reminder could not be created.' };
}
