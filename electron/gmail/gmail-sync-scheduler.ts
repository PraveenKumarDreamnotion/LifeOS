/**
 * GmailSyncScheduler (Phase 2) — wall-clock, poll-based sync driver. Like the reminder scheduler,
 * it uses a short periodic tick that checks "is a sync due?" against the persisted `last_sync_at`,
 * NOT a setTimeout to a far-future time (which would hit the 24.8-day trap and not survive sleep).
 *
 * Sync modes (docs §2.4): 5min / 15min = interval polling; manual = only an explicit "Sync now";
 * push = not built this phase, treated as 5min so the option is never a dead end. The engine
 * serializes overlapping syncs itself, so a slow sync can't stack.
 */
import type { GmailSyncEngine, SyncResult } from './sync-engine';
import type { GmailRepository } from '../database/gmail-repository';

export type GmailSyncMode = 'push' | '5min' | '15min' | 'manual';

const INTERVAL_MS: Record<GmailSyncMode, number> = {
  push: 5 * 60_000,
  '5min': 5 * 60_000,
  '15min': 15 * 60_000,
  manual: Number.POSITIVE_INFINITY,
};

export interface GmailSyncSchedulerDeps {
  engine: GmailSyncEngine;
  repo: GmailRepository;
  /** Live snapshot of the relevant settings. */
  getConfig: () => { enabled: boolean; mode: GmailSyncMode };
  now?: () => number;
  tickMs?: number;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export class GmailSyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly tickMs: number;
  /** The first sync of the session runs as CATCH-UP (stores backlog, no delivery burst). Flips true
   *  after any real sync, so all subsequent syncs deliver new mail normally. */
  private caughtUp = false;

  constructor(private readonly deps: GmailSyncSchedulerDeps) {
    this.now = deps.now ?? Date.now;
    this.tickMs = deps.tickMs ?? 60_000;
  }

  start(): void {
    if (this.timer) return;
    // Swallow rejections: a tick that runs mid-teardown (e.g. DB closed by a reset) must never
    // surface as an unhandled rejection.
    this.timer = setInterval(
      () => void this.tick().catch((e) => this.deps.log?.('warn', `gmail: tick failed (${(e as Error).message})`)),
      this.tickMs,
    );
    if (typeof this.timer === 'object' && this.timer && 'unref' in this.timer) {
      (this.timer as { unref: () => void }).unref(); // don't hold the event loop open
    }
    // Boot catch-up: pull mail accrued while the app was closed WITHOUT a notification/chat burst.
    // Swallow rejections so a boot-time sync hiccup can never surface as an unhandled rejection.
    void this.catchUp().catch((e) => this.deps.log?.('warn', `gmail: boot catch-up failed (${(e as Error).message})`));
  }

  /** A forced sync that bypasses the interval (boot + powerMonitor resume). The first one of the
   *  session suppresses the delivery burst (catch-up); later ones deliver like a normal tick. */
  async catchUp(): Promise<SyncResult | null> {
    const config = this.deps.getConfig();
    if (!config.enabled) return null;
    const account = this.deps.repo.getAccount();
    if (!account) return null;
    if (this.deps.repo.getSyncState(account.id)?.status === 'reconnect_needed') return null;
    return this.run(account.id);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Periodic due-check. No-op unless enabled + connected + interval elapsed + not reconnect-needed. */
  async tick(): Promise<SyncResult | null> {
    const config = this.deps.getConfig();
    if (!config.enabled) return null;
    const account = this.deps.repo.getAccount();
    if (!account) return null;

    const sync = this.deps.repo.getSyncState(account.id);
    if (sync?.status === 'reconnect_needed') return null;

    const interval = INTERVAL_MS[config.mode];
    if (!Number.isFinite(interval)) return null; // manual mode — only syncNow()

    const last = sync?.lastSyncAt ?? 0;
    if (this.now() - last < interval) return null;

    return this.run(account.id);
  }

  /** Explicit sync — the "Sync now" button and the post-connect kick. Bypasses the interval AND
   *  always delivers new mail (it's a deliberate user action, never a catch-up). */
  async syncNow(): Promise<SyncResult | null> {
    const account = this.deps.repo.getAccount();
    if (!account) return null;
    this.caughtUp = true; // an explicit sync ends catch-up mode
    return this.deps.engine.sync(account.id, { deliverNew: true });
  }

  /** Run a scheduled sync: the first of the session is catch-up (no delivery burst), the rest deliver. */
  private async run(accountId: string): Promise<SyncResult | null> {
    const deliverNew = this.caughtUp;
    this.caughtUp = true;
    return this.deps.engine.sync(accountId, { deliverNew });
  }
}
