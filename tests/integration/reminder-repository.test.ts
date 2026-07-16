import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../electron/database/open';
import { ReminderRepository } from '../../electron/database/reminder-repository';
import { HistoryRepository } from '../../electron/database/history-repository';
import type { SqliteDriver } from '../../electron/database/driver';
import type { CreateReminderInput } from '../../core/types/ipc';

let dbPath: string;
let db: SqliteDriver;
let repo: ReminderRepository;

const IN_ONE_HOUR = Date.now() + 3_600_000;

function valid(overrides: Partial<CreateReminderInput> = {}): CreateReminderInput {
  return {
    title: 'Call my mother',
    description: null,
    scheduledAtUtcMs: IN_ONE_HOUR,
    timezone: 'Asia/Kolkata',
    recurrenceRule: null,
    actionType: 'notify',
    source: 'local',
    ...overrides,
  };
}

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-repo-${randomUUID()}.db`);
  db = openDatabase(dbPath);
  repo = new ReminderRepository(db);
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

describe('ReminderRepository', () => {
  it('creates and reads a reminder', () => {
    const r = repo.create(valid());
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.title).toBe('Call my mother');
    expect(r.status).toBe('pending');
    expect(r.scheduledAt).toBe(IN_ONE_HOUR);
    expect(r.nextFireAt).toBe(IN_ONE_HOUR); // starts equal to scheduledAt
    expect(r.execution).toBeNull(); // plain reminder → no execution spec
    expect(repo.get(r.id)).toEqual(r);
  });

  it('persists and round-trips a structured ai_task execution spec', () => {
    const r = repo.create(
      valid({
        title: 'NIT Hamirpur contacts',
        execution: {
          version: 1,
          type: 'ai_task',
          instruction: 'Find the contact details of NIT Hamirpur.',
          capabilities: ['web_search'],
          outputFormat: 'spoken_answer',
          delivery: { notify: true, voice: true },
        },
      }),
    );
    expect(r.execution?.type).toBe('ai_task');
    expect(r.execution?.instruction).toContain('NIT Hamirpur');
    expect(r.execution?.capabilities).toEqual(['web_search']);
    // Survives a fresh read from disk.
    const reread = repo.get(r.id);
    expect(reread?.execution).toEqual(r.execution);
  });

  it('lists and deletes', () => {
    const a = repo.create(valid({ title: 'A' }));
    repo.create(valid({ title: 'B' }));
    expect(repo.listAll()).toHaveLength(2);
    expect(repo.delete(a.id)).toBe(true);
    expect(repo.get(a.id)).toBeUndefined();
    expect(repo.listAll()).toHaveLength(1);
  });

  it('updates a reminder', () => {
    const r = repo.create(valid());
    const updated = repo.update(r.id, { title: 'Call my grandmother' });
    expect(updated?.title).toBe('Call my grandmother');
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(r.updatedAt);
  });

  it('stores a SQL-injection title as literal text; the table survives', () => {
    const evil = `'); DROP TABLE reminders;--`;
    const r = repo.create(valid({ title: evil }));
    expect(repo.get(r.id)!.title).toBe(evil);
    const tables = db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE name='reminders'`);
    expect(tables).toHaveLength(1);
  });

  it('rejects an empty title at the DATABASE level (licenses the toDomain casts)', () => {
    expect(() =>
      db.run(
        `INSERT INTO reminders (id, title, scheduled_at, next_fire_at, timezone, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`,
        [randomUUID(), '   ', IN_ONE_HOUR, IN_ONE_HOUR, 'Asia/Kolkata', Date.now(), Date.now()],
      ),
    ).toThrow();
  });

  it('rejects an unknown action_type at the DATABASE level', () => {
    expect(() =>
      db.run(
        `INSERT INTO reminders (id, title, scheduled_at, next_fire_at, timezone, action_type, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [randomUUID(), 'x', IN_ONE_HOUR, IN_ONE_HOUR, 'Asia/Kolkata', 'run_script', Date.now(), Date.now()],
      ),
    ).toThrow();
  });

  it('survives a close and reopen (persistence)', () => {
    const id = repo.create(valid({ title: 'Persist me' })).id;
    db.close();
    db = openDatabase(dbPath);
    const reopened = new ReminderRepository(db).get(id);
    expect(reopened?.title).toBe('Persist me');
  });

  it('findDue excludes paused reminders and future ones', () => {
    const now = Date.now();
    const due = repo.create(valid({ title: 'due', scheduledAtUtcMs: now - 1000 }));
    repo.create(valid({ title: 'future', scheduledAtUtcMs: now + 3_600_000 }));
    const paused = repo.create(valid({ title: 'paused', scheduledAtUtcMs: now - 1000 }));
    repo.setPaused(paused.id, true);

    const found = repo.findDue(now).map((r) => r.id);
    expect(found).toContain(due.id);
    expect(found).not.toContain(paused.id);
    expect(found).toHaveLength(1);
  });

  it('findDue caps at 20 (the clock-jump storm guard)', () => {
    const now = Date.now();
    for (let i = 0; i < 25; i++) repo.create(valid({ title: `r${i}`, scheduledAtUtcMs: now - 1000 }));
    expect(repo.findDue(now)).toHaveLength(20);
  });

  it('deleting a reminder cascades its history', () => {
    const r = repo.create(valid());
    const history = new HistoryRepository(db);
    history.record(r.id, r.title, Date.now());
    expect(history.list({ status: 'all', limit: 100 })).toHaveLength(1);
    repo.delete(r.id);
    expect(history.list({ status: 'all', limit: 100 })).toHaveLength(0);
  });

  it('completes and dismisses a reminder', () => {
    const a = repo.create(valid());
    const b = repo.create(valid());
    repo.markCompleted(a.id);
    repo.markDismissed(b.id);
    expect(repo.get(a.id)!.status).toBe('completed');
    expect(repo.get(a.id)!.completedAt).toBeGreaterThan(0);
    expect(repo.get(b.id)!.status).toBe('dismissed');
  });

  it('snooze re-arms a reminder to pending with a future next_fire_at', () => {
    const r = repo.create(valid({ scheduledAtUtcMs: Date.now() - 1000 }));
    repo.markTriggered(r.id, Date.now());
    expect(repo.get(r.id)!.status).toBe('triggered');
    const before = Date.now();
    const snoozed = repo.snooze(r.id, 10);
    expect(snoozed!.status).toBe('pending');
    expect(snoozed!.nextFireAt).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000);
  });

  it('pause/resume flips is_paused and excludes/includes it in findDue', () => {
    const now = Date.now();
    const r = repo.create(valid({ scheduledAtUtcMs: now - 1000 }));
    expect(repo.findDue(now).map((x) => x.id)).toContain(r.id);
    repo.setPaused(r.id, true);
    expect(repo.get(r.id)!.isPaused).toBe(true);
    expect(repo.findDue(now).map((x) => x.id)).not.toContain(r.id);
    repo.setPaused(r.id, false);
    expect(repo.findDue(now).map((x) => x.id)).toContain(r.id);
  });
});
