import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { NodeSqliteDriver } from '../../electron/database/drivers/node-sqlite-driver';
import { migrate, currentVersion, DatabaseFromNewerVersionError } from '../../electron/database/migrate';
import { MIGRATIONS, M001_INITIAL, M002_MEMORY, M003_CHAT_SESSIONS, M004_TURN_KIND } from '../../electron/database/migrations';
import type { SqliteDriver } from '../../electron/database/driver';

let dbPath: string;
let db: SqliteDriver;

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-mig-${randomUUID()}.db`);
  db = new NodeSqliteDriver(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
});

afterEach(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(dbPath + suffix);
    } catch {
      /* ignore */
    }
  }
});

describe('migrations', () => {
  it('a fresh DB reaches the latest user_version', () => {
    const { from, to } = migrate(db);
    expect(from).toBe(0);
    expect(to).toBe(MIGRATIONS.length);
    expect(currentVersion(db)).toBe(MIGRATIONS.length);
  });

  it('creates every expected table', () => {
    migrate(db);
    const names = db
      .all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`)
      .map((r) => r.name);
    for (const t of [
      'reminders', 'reminder_history', 'settings', 'app_logs', 'memories', 'conversations',
      // Gmail (M006–M008).
      'gmail_accounts', 'gmail_sync_state', 'gmail_threads', 'gmail_messages', 'gmail_participants',
      'gmail_labels', 'gmail_message_labels', 'gmail_attachments', 'email_ai_context', 'web_research',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('M008 added the research columns to email_ai_context (ALTER on a real schema)', () => {
    migrate(db);
    const cols = db.all<{ name: string }>(`PRAGMA table_info(email_ai_context)`).map((r) => r.name);
    expect(cols).toContain('research_worthwhile');
    expect(cols).toContain('research_query');
  });

  it('is idempotent — re-running is a no-op', () => {
    migrate(db);
    const v1 = currentVersion(db);
    const result = migrate(db);
    expect(result.from).toBe(v1);
    expect(currentVersion(db)).toBe(v1);
  });

  it('migrates a POPULATED v2 database to v3 without losing data (the real upgrade path)', () => {
    // Recreate a real user's v2 DB: schema v1+v2 applied, a reminder already stored, version = 2.
    db.transaction(() => {
      db.exec(M001_INITIAL);
      db.exec('PRAGMA user_version = 1');
    });
    db.transaction(() => {
      db.exec(M002_MEMORY);
      db.exec('PRAGMA user_version = 2');
    });
    const now = Date.now();
    db.run(
      `INSERT INTO reminders (id, title, scheduled_at, next_fire_at, timezone, created_at, updated_at)
       VALUES ('r1', 'Call mom', ?, ?, 'UTC', ?, ?)`,
      [now, now, now, now],
    );
    expect(currentVersion(db)).toBe(2);

    // The next launch runs every pending migration (v2 → head) against this populated DB.
    const { from, to } = migrate(db);
    expect(from).toBe(2);
    expect(to).toBe(MIGRATIONS.length);

    // The pre-existing reminder survived, now with a null session_id; chat tables exist.
    const row = db.get<{ title: string; session_id: string | null }>('SELECT title, session_id FROM reminders WHERE id = ?', ['r1']);
    expect(row?.title).toBe('Call mom');
    expect(row?.session_id).toBeNull();
    const tables = db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name);
    expect(tables).toContain('chat_sessions');
    expect(tables).toContain('chat_turns');
  });

  it('migrates a POPULATED v3 database to v4 (chat kind) without losing turns', () => {
    // Recreate a v3 DB with a chat session + turn already stored.
    for (const [i, sql] of [M001_INITIAL, M002_MEMORY, M003_CHAT_SESSIONS].entries()) {
      db.transaction(() => {
        db.exec(sql);
        db.exec(`PRAGMA user_version = ${i + 1}`);
      });
    }
    const now = Date.now();
    db.run('INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', ['s1', 'Chat', now, now]);
    db.run(
      `INSERT INTO chat_turns (id, session_id, user_text, assistant_text, created_at) VALUES ('t1', 's1', 'hi', 'hello', ?)`,
      [now],
    );
    expect(currentVersion(db)).toBe(3);

    const { from, to } = migrate(db);
    expect(from).toBe(3);
    expect(to).toBe(MIGRATIONS.length);
    // Pre-existing turn survived and got the default kind='chat' (M004 ran).
    const row = db.get<{ user_text: string; kind: string }>('SELECT user_text, kind FROM chat_turns WHERE id = ?', ['t1']);
    expect(row?.user_text).toBe('hi');
    expect(row?.kind).toBe('chat');
  });

  it('M005: migrates a populated v4 DB to head, giving existing reminders a null execution_json', () => {
    // Recreate a v4 DB (M001..M004) with a plain reminder already stored.
    for (const [i, sql] of [M001_INITIAL, M002_MEMORY, M003_CHAT_SESSIONS, M004_TURN_KIND].entries()) {
      db.transaction(() => {
        db.exec(sql);
        db.exec(`PRAGMA user_version = ${i + 1}`);
      });
    }
    const now = Date.now();
    db.run(
      `INSERT INTO reminders (id, title, scheduled_at, next_fire_at, timezone, created_at, updated_at)
       VALUES ('r1', 'Drink water', ?, ?, 'UTC', ?, ?)`,
      [now, now, now, now],
    );
    expect(currentVersion(db)).toBe(4);

    const { from, to } = migrate(db);
    expect(from).toBe(4);
    expect(to).toBe(MIGRATIONS.length);
    // The pre-existing reminder survived and its new execution_json defaults to NULL (classic).
    const row = db.get<{ title: string; execution_json: string | null }>(
      'SELECT title, execution_json FROM reminders WHERE id = ?',
      ['r1'],
    );
    expect(row?.title).toBe('Drink water');
    expect(row?.execution_json).toBeNull();
  });

  it('refuses a database from a newer version', () => {
    migrate(db);
    db.exec(`PRAGMA user_version = 99`);
    expect(() => migrate(db)).toThrow(DatabaseFromNewerVersionError);
  });

  it('rolls back a failing migration and leaves user_version unchanged', () => {
    // A driver whose 2nd exec throws mid-migration.
    let calls = 0;
    const flaky: SqliteDriver = {
      ...db,
      exec: (sql: string) => {
        calls++;
        if (calls === 2) throw new Error('boom');
        return db.exec(sql);
      },
      transaction: db.transaction.bind(db),
      get: db.get.bind(db),
      all: db.all.bind(db),
      run: db.run.bind(db),
      close: db.close.bind(db),
    };
    expect(() => migrate(flaky)).toThrow('boom');
    expect(currentVersion(db)).toBe(0); // nothing committed
  });
});
