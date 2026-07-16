/**
 * The 6-method surface all SQL goes through (10 §2). Swapping the SQLite binding is a
 * one-file change — this is what keeps node:sqlite vs better-sqlite3 reversible.
 */
export interface SqliteDriver {
  exec(sql: string): void;
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  transaction<T>(fn: () => T): T;
  close(): void;
}
