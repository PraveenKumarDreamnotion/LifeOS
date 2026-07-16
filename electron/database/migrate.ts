/**
 * PRAGMA user_version migration runner (10 §4).
 *
 * Each migration runs inside a transaction that also bumps the version — so a failure
 * rolls back cleanly and leaves user_version unchanged. Forward-only. A database from a
 * newer app version is refused, never migrated backwards.
 */
import type { SqliteDriver } from './driver';
import { MIGRATIONS } from './migrations';

export class DatabaseFromNewerVersionError extends Error {
  constructor(
    public readonly found: number,
    public readonly known: number,
  ) {
    super(
      `This data was created by a newer version of LifeOS (schema v${found}; this build knows v${known}).`,
    );
    this.name = 'DatabaseFromNewerVersionError';
  }
}

export function currentVersion(db: SqliteDriver): number {
  const row = db.get<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

export function migrate(db: SqliteDriver): { from: number; to: number } {
  const from = currentVersion(db);

  if (from > MIGRATIONS.length) {
    throw new DatabaseFromNewerVersionError(from, MIGRATIONS.length);
  }

  for (let v = from; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      // Safe interpolation: v is a loop index over a hardcoded array, and SQLite does
      // not permit a bound parameter in a PRAGMA. This is the ONE documented exception
      // to the no-interpolation rule (10 §6, 11 §9).
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }

  return { from, to: MIGRATIONS.length };
}
