import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../electron/database/open';
import { currentVersion } from '../../electron/database/migrate';
import { MIGRATIONS } from '../../electron/database/migrations';
import { GmailRepository } from '../../electron/database/gmail-repository';
import type { SqliteDriver } from '../../electron/database/driver';
import type { GmailAccount } from '../../core/gmail/types';

let dbPath: string;
let db: SqliteDriver;
let repo: GmailRepository;

function account(overrides: Partial<GmailAccount> = {}): GmailAccount {
  const now = Date.now();
  return { id: randomUUID(), emailAddress: 'me@example.com', scope: 'gmail.readonly', connectedAt: now, updatedAt: now, ...overrides };
}

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-gmail-${randomUUID()}.db`);
  db = openDatabase(dbPath);
  repo = new GmailRepository(db);
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

describe('M006 gmail schema + repository', () => {
  it('migration reaches head and creates every gmail table', () => {
    expect(currentVersion(db)).toBe(MIGRATIONS.length); // openDatabase migrated to head (v6)
    const names = db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name);
    for (const t of [
      'gmail_accounts',
      'gmail_sync_state',
      'gmail_threads',
      'gmail_messages',
      'gmail_participants',
      'gmail_labels',
      'gmail_message_labels',
      'gmail_attachments',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('saveAccount stores the account and seeds a sync-state row', () => {
    const a = account();
    repo.saveAccount(a);
    const got = repo.getAccount();
    expect(got?.emailAddress).toBe('me@example.com');
    const sync = repo.getSyncState(a.id);
    expect(sync?.status).toBe('idle');
    expect(sync?.historyId).toBeNull();
  });

  it('setHistoryId + setSyncStatus update the cursor', () => {
    const a = account();
    repo.saveAccount(a);
    repo.setHistoryId(a.id, '98765', 1_700_000_000_000);
    repo.setSyncStatus(a.id, 'reconnect_needed', 'invalid_grant');
    const sync = repo.getSyncState(a.id);
    expect(sync?.historyId).toBe('98765');
    expect(sync?.lastSyncAt).toBe(1_700_000_000_000);
    expect(sync?.status).toBe('reconnect_needed');
    expect(sync?.lastError).toBe('invalid_grant');
  });

  it('deleteAccount cascades to sync-state and messages', () => {
    const a = account();
    repo.saveAccount(a);
    insertMessage(a.id, 'm1');
    expect(repo.messageCount(a.id)).toBe(1);
    repo.deleteAccount(a.id);
    expect(repo.getAccount()).toBeNull();
    expect(repo.getSyncState(a.id)).toBeNull(); // cascade
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM gmail_messages')?.n).toBe(0); // cascade
  });

  it('deleteEmailCache wipes messages/threads/labels but keeps the account + resets the cursor', () => {
    const a = account();
    repo.saveAccount(a);
    repo.setHistoryId(a.id, '111', Date.now());
    insertMessage(a.id, 'm1', 2048);
    db.run('INSERT INTO gmail_threads (id, account_id, snippet) VALUES (?, ?, ?)', ['t1', a.id, 'hi']);
    db.run('INSERT INTO gmail_labels (account_id, id, name, type) VALUES (?, ?, ?, ?)', [a.id, 'INBOX', 'Inbox', 'system']);

    expect(repo.messageCount(a.id)).toBe(1);
    expect(repo.storageBytes(a.id)).toBe(2048);

    repo.deleteEmailCache(a.id);

    expect(repo.messageCount(a.id)).toBe(0);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM gmail_threads')?.n).toBe(0);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM gmail_labels')?.n).toBe(0);
    expect(repo.getAccount()?.id).toBe(a.id); // still connected
    const sync = repo.getSyncState(a.id);
    expect(sync?.historyId).toBeNull(); // cursor reset so next sync reseeds
  });

  it('gmail_messages.id is unique — a re-synced message does not duplicate', () => {
    const a = account();
    repo.saveAccount(a);
    insertMessage(a.id, 'dup');
    expect(() => insertMessage(a.id, 'dup')).toThrow(); // PRIMARY KEY collision
    expect(repo.messageCount(a.id)).toBe(1);
  });
});

function insertMessage(accountId: string, id: string, size = 100): void {
  db.run(
    `INSERT INTO gmail_messages (id, account_id, thread_id, internal_date, subject, snippet, size_estimate, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, accountId, `thread-${id}`, Date.now(), 'Subject', 'snippet', size, Date.now()],
  );
}
