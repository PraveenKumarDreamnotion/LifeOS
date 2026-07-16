import { describe, it, expect, vi } from 'vitest';
import { GmailSyncScheduler, type GmailSyncMode } from '../../electron/gmail/gmail-sync-scheduler';
import type { GmailSyncEngine, SyncResult } from '../../electron/gmail/sync-engine';
import type { GmailRepository } from '../../electron/database/gmail-repository';
import type { GmailSyncState } from '../../core/gmail/types';

const NOW = 1_700_000_000_000;
const OK: SyncResult = { ok: true, mode: 'incremental', fetched: 1, deleted: 0, newCount: 0 };

function setup(opts: {
  enabled: boolean;
  mode: GmailSyncMode;
  hasAccount?: boolean;
  lastSyncAt?: number | null;
  status?: GmailSyncState['status'];
}) {
  const sync = vi.fn(async () => OK);
  const engine = { sync } as unknown as GmailSyncEngine;
  const repo = {
    getAccount: () => (opts.hasAccount === false ? null : { id: 'acc', emailAddress: 'me@x.com', scope: '', connectedAt: 0, updatedAt: 0 }),
    getSyncState: () =>
      opts.hasAccount === false
        ? null
        : ({
            accountId: 'acc',
            historyId: '100',
            lastSyncAt: opts.lastSyncAt ?? null,
            lastFullSyncAt: null,
            watchExpiry: null,
            status: opts.status ?? 'idle',
            lastError: null,
          } satisfies GmailSyncState),
  } as unknown as GmailRepository;

  const scheduler = new GmailSyncScheduler({
    engine,
    repo,
    getConfig: () => ({ enabled: opts.enabled, mode: opts.mode }),
    now: () => NOW,
    tickMs: 60_000,
  });
  return { scheduler, sync };
}

describe('GmailSyncScheduler.tick', () => {
  it('does nothing when disabled', async () => {
    const { scheduler, sync } = setup({ enabled: false, mode: '5min' });
    expect(await scheduler.tick()).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it('does nothing when not connected', async () => {
    const { scheduler, sync } = setup({ enabled: true, mode: '5min', hasAccount: false });
    expect(await scheduler.tick()).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it('does nothing in manual mode (only syncNow triggers it)', async () => {
    const { scheduler, sync } = setup({ enabled: true, mode: 'manual', lastSyncAt: 0 });
    expect(await scheduler.tick()).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it('skips when the interval has not elapsed', async () => {
    const { scheduler, sync } = setup({ enabled: true, mode: '5min', lastSyncAt: NOW - 100_000 }); // 100s < 5min
    expect(await scheduler.tick()).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs when the interval has elapsed', async () => {
    const { scheduler, sync } = setup({ enabled: true, mode: '5min', lastSyncAt: NOW - 400_000 }); // 400s > 5min
    await scheduler.tick();
    expect(sync).toHaveBeenCalled();
  });

  it('syncs on first run (no prior lastSyncAt)', async () => {
    const { scheduler, sync } = setup({ enabled: true, mode: '15min', lastSyncAt: null });
    await scheduler.tick();
    expect(sync).toHaveBeenCalled();
  });

  it('does not sync while reconnect is needed', async () => {
    const { scheduler, sync } = setup({ enabled: true, mode: '5min', lastSyncAt: 0, status: 'reconnect_needed' });
    expect(await scheduler.tick()).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncNow bypasses the interval and syncs whenever connected', async () => {
    const { scheduler, sync } = setup({ enabled: true, mode: 'manual', lastSyncAt: NOW });
    await scheduler.syncNow();
    expect(sync).toHaveBeenCalled();
  });
});

describe('GmailSyncScheduler — startup catch-up (Phase 5)', () => {
  it('the FIRST scheduled sync is catch-up (no delivery burst); subsequent syncs deliver', async () => {
    const { scheduler, sync } = setup({ enabled: true, mode: '5min', lastSyncAt: null });
    await scheduler.tick(); // first of the session → catch-up
    await scheduler.tick(); // still due (fake lastSyncAt is static) → now delivers
    expect(sync).toHaveBeenNthCalledWith(1, 'acc', { deliverNew: false });
    expect(sync).toHaveBeenNthCalledWith(2, 'acc', { deliverNew: true });
  });

  it('catchUp() bypasses the interval and runs quietly even when a normal tick would skip', async () => {
    const { scheduler, sync } = setup({ enabled: true, mode: '5min', lastSyncAt: NOW }); // not due for a tick
    expect(await scheduler.tick()).toBeNull(); // interval not elapsed
    await scheduler.catchUp();
    expect(sync).toHaveBeenCalledWith('acc', { deliverNew: false });
  });

  it('syncNow always delivers (never catch-up), even as the first sync of the session', async () => {
    const { scheduler, sync } = setup({ enabled: true, mode: 'manual', lastSyncAt: null });
    await scheduler.syncNow();
    expect(sync).toHaveBeenCalledWith('acc', { deliverNew: true });
  });

  it('catchUp() no-ops when disabled / not connected / reconnect needed', async () => {
    const off = setup({ enabled: false, mode: '5min' });
    expect(await off.scheduler.catchUp()).toBeNull();
    expect(off.sync).not.toHaveBeenCalled();

    const noAcct = setup({ enabled: true, mode: '5min', hasAccount: false });
    expect(await noAcct.scheduler.catchUp()).toBeNull();

    const reconnect = setup({ enabled: true, mode: '5min', status: 'reconnect_needed' });
    expect(await reconnect.scheduler.catchUp()).toBeNull();
    expect(reconnect.sync).not.toHaveBeenCalled();
  });
});
