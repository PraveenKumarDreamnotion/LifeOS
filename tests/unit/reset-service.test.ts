import { describe, it, expect, vi, beforeEach } from 'vitest';

// resetLocalData is Electron- and fs-coupled; mock both so we can assert the delete/relaunch
// contract without touching the real filesystem or quitting the test process.
const { rmMock, appMock } = vi.hoisted(() => ({
  rmMock: vi.fn(),
  appMock: {
    getPath: vi.fn(() => 'C:\\Users\\me\\AppData\\Roaming\\LifeOS'),
    relaunch: vi.fn(),
    exit: vi.fn(),
  },
}));

vi.mock('electron', () => ({ app: appMock }));
vi.mock('node:fs/promises', () => ({ rm: rmMock }));

import { resetLocalData, UnsafeResetPathError } from '../../electron/services/reset-service';

const dbCalls = () =>
  rmMock.mock.calls.filter(([p]) => typeof p === 'string' && (p as string).includes('lifeos.db'));

describe('resetLocalData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appMock.getPath.mockReturnValue('C:\\Users\\me\\AppData\\Roaming\\LifeOS');
    rmMock.mockResolvedValue(undefined);
  });

  it('closes the db, then deletes lifeos.db + WAL + SHM, then relaunches', async () => {
    const closeDb = vi.fn();
    await resetLocalData(closeDb);

    expect(closeDb).toHaveBeenCalledTimes(1);
    // closeDb must run before any rm (release the WAL first).
    const closeOrder = closeDb.mock.invocationCallOrder[0];
    const firstRmOrder = rmMock.mock.invocationCallOrder[0];
    expect(closeOrder).toBeDefined();
    expect(firstRmOrder).toBeDefined();
    expect(closeOrder as number).toBeLessThan(firstRmOrder as number);

    const deleted = dbCalls().map(([p]) => (p as string));
    expect(deleted.some((p) => p.endsWith('lifeos.db'))).toBe(true);
    expect(deleted.some((p) => p.endsWith('lifeos.db-wal'))).toBe(true);
    expect(deleted.some((p) => p.endsWith('lifeos.db-shm'))).toBe(true);

    expect(appMock.relaunch).toHaveBeenCalledTimes(1);
    expect(appMock.exit).toHaveBeenCalledWith(0);
  });

  it('deletes the db files with recursive:true so maxRetries actually applies', async () => {
    // Regression guard: fs.rm ignores maxRetries/retryDelay unless recursive is true. Without this
    // the post-close EBUSY race on Windows would silently leave lifeos.db behind — a failed wipe.
    await resetLocalData(vi.fn());
    for (const [, opts] of dbCalls()) {
      expect(opts).toMatchObject({ force: true, recursive: true, maxRetries: expect.any(Number) });
      expect((opts as { maxRetries: number }).maxRetries).toBeGreaterThan(0);
    }
  });

  it('still relaunches when a delete throws (never leaves a closed-db zombie)', async () => {
    rmMock.mockRejectedValue(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));
    await resetLocalData(vi.fn());
    expect(appMock.relaunch).toHaveBeenCalledTimes(1);
    expect(appMock.exit).toHaveBeenCalledWith(0);
  });

  it('relaunches even when closeDb throws', async () => {
    await resetLocalData(() => {
      throw new Error('already closed');
    });
    expect(appMock.relaunch).toHaveBeenCalledTimes(1);
    expect(appMock.exit).toHaveBeenCalledWith(0);
  });

  it('refuses an unsafe path — deletes nothing and does not relaunch', async () => {
    appMock.getPath.mockReturnValue('C:\\Windows\\System32');
    await expect(resetLocalData(vi.fn())).rejects.toBeInstanceOf(UnsafeResetPathError);
    expect(rmMock).not.toHaveBeenCalled();
    expect(appMock.relaunch).not.toHaveBeenCalled();
    expect(appMock.exit).not.toHaveBeenCalled();
  });
});
