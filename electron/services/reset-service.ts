/**
 * Reset LifeOS Local Data (10 §10, 11 §10) — the ONLY filesystem-delete in the app, and the
 * only file that may import fs.rm (enforced by ESLint).
 *
 * The path comes from app.getPath('userData'), NEVER from a setting or from IPC. The pure
 * safety guard lives in reset-guard.ts (unit-tested). The IPC handler passes no arguments.
 *
 * Windows caveat (10 §10 RISK): a live Electron process keeps files locked. A just-closed
 * SQLite handle is released lazily, and — more importantly — Chromium holds its OWN profile
 * files (DIPS, Cookies, Network Persistent State…) open for the whole process lifetime, so a
 * folder-wide rm can never fully succeed while we are running (it hits EBUSY). We therefore:
 *   1. delete LifeOS's own data explicitly and with retries — all of it lives in lifeos.db and
 *      its WAL/SHM sidecars — so the real wipe never depends on rm's walk order or Chromium's
 *      locks; and
 *   2. best-effort rm the rest of the profile (harmless caches that regenerate), swallowing the
 *      expected EBUSY, and ALWAYS relaunch in a finally so we never leave the app running against
 *      a closed database (the "database is not open" zombie state).
 */
import { app } from 'electron';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafeResetPath } from './reset-guard';

export { UnsafeResetPathError } from './reset-guard';

// Ride out the brief post-close EBUSY on Windows without leaving the file behind. NOTE: fs.rm
// ignores maxRetries/retryDelay unless `recursive` is also true — every use below sets it.
const RM_RETRY = { recursive: true, maxRetries: 10, retryDelay: 100 } as const;

// Everything LifeOS persists lives in the SQLite database (settings, encrypted API keys and
// Gmail tokens, chat, reminders, history) — these three files ARE the user's data.
const LIFEOS_DATA_FILES = ['lifeos.db', 'lifeos.db-wal', 'lifeos.db-shm'];

export async function resetLocalData(closeDb: () => void): Promise<void> {
  const userData = assertSafeResetPath(app.getPath('userData'));

  try {
    // Release the WAL before deleting, or Windows will hold lifeos.db* locked.
    try {
      closeDb();
    } catch {
      /* already closed */
    }

    // 1. Deterministically delete LifeOS's own data. force ignores ENOENT; maxRetries rides out
    //    the lazy post-close handle release. Each file is independent — one failure must not skip
    //    the others or the relaunch.
    for (const name of LIFEOS_DATA_FILES) {
      try {
        await rm(join(userData, name), { force: true, ...RM_RETRY });
      } catch (e) {
        console.error(`[reset] failed to delete ${name}:`, e);
      }
    }

    // 2. Best-effort wipe of the rest of the profile. Chromium's own open files (DIPS, Cookies,
    //    …) EBUSY while we're alive on Windows — that's expected; they hold no LifeOS data and are
    //    recreated on next launch. Keep retries low: those handles won't release until we exit, so
    //    a long backoff would only delay the relaunch. Never let this abort the relaunch below.
    try {
      await rm(userData, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    } catch (e) {
      console.warn('[reset] userData not fully removed (OS files still in use):', e);
    }
  } finally {
    // Always relaunch into a clean state, even if a delete threw — the DB is already closed, so
    // continuing to run would only spam "database is not open".
    app.relaunch();
    app.exit(0);
  }
}
