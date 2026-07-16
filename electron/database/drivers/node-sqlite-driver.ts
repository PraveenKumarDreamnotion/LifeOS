/**
 * SqliteDriver backed by node:sqlite (built into Electron 43 — SPIKE-1 PASS).
 * No native module, no rebuild, no asarUnpack.
 */
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { SqliteDriver } from '../driver';

/**
 * Load node:sqlite via a runtime require rather than a static import.
 *
 * node:sqlite is newer than the builtin-module list some bundlers (Vite/Vitest) carry;
 * a static `import ... from 'node:sqlite'` makes their transform try to resolve a package
 * called `sqlite` and fail. A require through a non-`require`-named binding escapes static
 * analysis and lets Node load the real builtin, in Electron and in tests alike.
 */
const nodeRequire =
  typeof require !== 'undefined' ? require : createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

export class NodeSqliteDriver implements SqliteDriver {
  private db: DatabaseSyncType;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  get<T>(sql: string, params: unknown[] = []): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...(params as never[])) as T | undefined;
  }

  all<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params as never[])) as T[];
  }

  run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...(params as never[]));
    return { changes: Number(info.changes), lastInsertRowid: info.lastInsertRowid };
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.db.close();
  }
}
