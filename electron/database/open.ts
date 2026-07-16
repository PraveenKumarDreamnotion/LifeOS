/**
 * Open + configure the database. Takes the path as an argument so the whole DB layer is
 * testable without Electron (the caller resolves app.getPath).
 */
import { NodeSqliteDriver } from './drivers/node-sqlite-driver';
import type { SqliteDriver } from './driver';
import { migrate } from './migrate';

export function openDatabase(dbPath: string): SqliteDriver {
  const db = new NodeSqliteDriver(dbPath);

  // Pragmas in order (10 §3). WAL gives durability + concurrent reads.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');

  migrate(db);
  return db;
}
