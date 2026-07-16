/**
 * ConfirmationStore (36 §4.3) — the pending-proposal store that makes the confirmation gate
 * trustworthy even though the renderer is untrusted. It holds the ALREADY-VALIDATED, normalised
 * action keyed by `turnId`. `action:confirm(turnId)` executes the STORED action for that id — the
 * renderer never submits an action at confirm time, so it can't execute something it wasn't shown
 * (the pending-proposal invariant, 41 §8.3).
 *
 * Single-use (take removes it) and timeout = CANCEL, never auto-confirm (36 §4.1): a proposal the
 * user ignores fails safe.
 */
import type { Action, ActionSource } from '../../core/actions/action';

const DEFAULT_TIMEOUT_MS = 90_000;

interface Pending {
  action: Action;
  source: ActionSource;
  sessionId: string | null;
  timer: ReturnType<typeof setTimeout>;
}

export class ConfirmationStore {
  private readonly pending = new Map<string, Pending>();
  /** The most recently opened, still-pending proposal — the one a spoken "yes" targets (48 §main).
   *  Single conversation ⇒ at most one open at a time. */
  private lastOpen: string | null = null;

  constructor(
    /** Called when a proposal expires unconfirmed — the renderer is told the card timed out. */
    private readonly onTimeout: (turnId: string) => void,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /** Store a validated action awaiting confirmation. Replaces any prior proposal for the turn. */
  put(turnId: string, action: Action, source: ActionSource, sessionId: string | null = null): void {
    this.clear(turnId);
    const timer = setTimeout(() => {
      this.pending.delete(turnId);
      if (this.lastOpen === turnId) this.lastOpen = null;
      this.onTimeout(turnId); // fails safe: expiry = cancel
    }, this.timeoutMs);
    // A pending proposal must never keep the app alive / block quit.
    (timer as { unref?: () => void }).unref?.();
    this.pending.set(turnId, { action, source, sessionId, timer });
    this.lastOpen = turnId;
  }

  /** Read the stored action WITHOUT consuming it (e.g. to re-speak the summary on "repeat"). */
  peek(turnId: string): Action | undefined {
    return this.pending.get(turnId)?.action;
  }

  peekSessionId(turnId: string): string | null {
    return this.pending.get(turnId)?.sessionId ?? null;
  }

  /** The turnId of the currently-open proposal a voice "yes"/"no" applies to, if any. */
  currentOpen(): string | undefined {
    return this.lastOpen && this.pending.has(this.lastOpen) ? this.lastOpen : undefined;
  }

  /** Single-use: returns AND removes the stored action (the confirm path). undefined if unknown/expired. */
  take(turnId: string): { action: Action; source: ActionSource; sessionId: string | null } | undefined {
    const p = this.pending.get(turnId);
    if (!p) return undefined;
    clearTimeout(p.timer);
    this.pending.delete(turnId);
    if (this.lastOpen === turnId) this.lastOpen = null;
    return { action: p.action, source: p.source, sessionId: p.sessionId };
  }

  /** Explicit cancel (the Cancel button, or a superseding proposal). */
  clear(turnId: string): void {
    const p = this.pending.get(turnId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(turnId);
    if (this.lastOpen === turnId) this.lastOpen = null;
  }

  has(turnId: string): boolean {
    return this.pending.has(turnId);
  }
}
