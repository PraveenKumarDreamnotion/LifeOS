import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { openDatabase } from '../../electron/database/open';
import { ReminderRepository } from '../../electron/database/reminder-repository';
import { createScheduler, type TriggerSink } from '../../electron/scheduler/scheduler';
import type { SqliteDriver } from '../../electron/database/driver';
import type { Reminder } from '../../core/types/reminder';
import type { CreateReminderInput } from '../../core/types/ipc';

const KOL = 'Asia/Kolkata';
const DAY = 86_400_000;

let dbPath: string;
let db: SqliteDriver;
let repo: ReminderRepository;
let fired: Reminder[];
let sink: TriggerSink;

function at(ms: number, overrides: Partial<CreateReminderInput> = {}): CreateReminderInput {
  return {
    title: 'T',
    description: null,
    scheduledAtUtcMs: ms,
    timezone: KOL,
    recurrenceRule: null,
    actionType: 'notify',
    source: 'local',
    ...overrides,
  };
}

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-sched-${randomUUID()}.db`);
  db = openDatabase(dbPath);
  repo = new ReminderRepository(db);
  fired = [];
  sink = { fire: (r) => fired.push(r) };
});

afterEach(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) {
    try {
      rmSync(dbPath + s);
    } catch {
      /* ignore */
    }
  }
});

describe('scheduler', () => {
  it('does NOT fire a reminder 30 days out (the 2^31-1 setTimeout trap)', () => {
    const now = DateTime.fromISO('2026-07-10T16:00', { zone: KOL }).toMillis();
    repo.create(at(now + 30 * DAY));
    const s = createScheduler({ now: () => now, repo, sink });
    expect(s.reconcile('tick').fired).toBe(0);
    expect(fired).toHaveLength(0);
  });

  it('fires a one-time reminder that is 45 seconds late', () => {
    const now = Date.now();
    const id = repo.create(at(now - 45_000)).id;
    const s = createScheduler({ now: () => now, repo, sink });
    expect(s.reconcile('tick').fired).toBe(1);
    expect(fired.map((r) => r.id)).toEqual([id]);
    expect(repo.get(id)!.status).toBe('triggered');
  });

  it('marks a one-time reminder MISSED (not fired) when the app was closed through it', () => {
    const now = Date.now();
    const id = repo.create(at(now - 6 * 3_600_000)).id; // 6 hours late
    const s = createScheduler({ now: () => now, repo, sink });
    const result = s.reconcile('startup');
    expect(result.fired).toBe(0);
    expect(result.missed).toBe(1);
    expect(fired).toHaveLength(0);
    expect(repo.get(id)!.status).toBe('missed');
  });

  it('collapses 4 missed weekly occurrences into 0 fires and 1 roll-forward', () => {
    // A weekly Monday 07:00 reminder whose next_fire_at is 4 weeks in the past.
    const created = DateTime.fromISO('2026-06-15T07:00', { zone: KOL }).toMillis(); // a Monday
    const now = DateTime.fromISO('2026-07-13T09:00', { zone: KOL }).toMillis(); // 4 Mondays later
    const id = repo.create(
      at(created, { recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0' }),
    ).id;

    const s = createScheduler({ now: () => now, repo, sink });
    const result = s.reconcile('startup');

    expect(result.fired).toBe(0); // NOT four alarms at once
    expect(fired).toHaveLength(0);
    const next = repo.get(id)!.nextFireAt;
    expect(next).toBeGreaterThan(now);
    // Next Monday after 2026-07-13 09:00 is 2026-07-20 07:00.
    expect(DateTime.fromMillis(next, { zone: KOL }).toFormat("yyyy-LL-dd'T'HH:mm")).toBe('2026-07-20T07:00');
  });

  it('fires a recurring reminder on time and rolls it forward one week', () => {
    const now = DateTime.fromISO('2026-07-13T07:00', { zone: KOL }).toMillis(); // Monday 07:00
    const id = repo.create(
      at(now, { recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0' }),
    ).id;
    const s = createScheduler({ now: () => now, repo, sink });
    expect(s.reconcile('tick').fired).toBe(1);
    expect(DateTime.fromMillis(repo.get(id)!.nextFireAt, { zone: KOL }).toFormat("yyyy-LL-dd'T'HH:mm")).toBe(
      '2026-07-20T07:00',
    );
  });

  it('completes a COUNT=1 recurring reminder after its single fire', () => {
    const now = DateTime.fromISO('2026-07-13T07:00', { zone: KOL }).toMillis();
    const id = repo.create(at(now, { recurrenceRule: 'FREQ=DAILY;BYHOUR=7;BYMINUTE=0;COUNT=1' })).id;
    const s = createScheduler({ now: () => now, repo, sink });
    expect(s.reconcile('tick').fired).toBe(1);
    expect(repo.get(id)!.status).toBe('completed');
    expect(fired).toHaveLength(1);
  });

  it('fires a COUNT=2 daily reminder exactly twice, then completes', () => {
    const day1 = DateTime.fromISO('2026-07-13T07:00', { zone: KOL }).toMillis();
    const day2 = day1 + DAY;
    const id = repo.create(at(day1, { recurrenceRule: 'FREQ=DAILY;BYHOUR=7;BYMINUTE=0;COUNT=2' })).id;

    expect(createScheduler({ now: () => day1, repo, sink }).reconcile('tick').fired).toBe(1);
    expect(repo.get(id)!.status).toBe('pending'); // still armed for the 2nd fire

    expect(createScheduler({ now: () => day2, repo, sink }).reconcile('tick').fired).toBe(1);
    expect(repo.get(id)!.status).toBe('completed');
    expect(fired).toHaveLength(2);
  });

  it('stops a recurring reminder once its UNTIL date has passed', () => {
    const day1 = DateTime.fromISO('2026-07-13T07:00', { zone: KOL }).toMillis();
    const day2 = day1 + DAY;
    // Valid through the 13th only → the 13th fires, then it's done.
    const rule = 'FREQ=DAILY;BYHOUR=7;BYMINUTE=0;UNTIL=20260713T093000Z'; // 15:00 IST on the 13th
    const id = repo.create(at(day1, { recurrenceRule: rule })).id;

    expect(createScheduler({ now: () => day1, repo, sink }).reconcile('tick').fired).toBe(1);
    expect(repo.get(id)!.status).toBe('completed'); // no occurrence remains before UNTIL
    expect(createScheduler({ now: () => day2, repo, sink }).reconcile('tick').fired).toBe(0);
    expect(fired).toHaveLength(1);
  });

  it('is idempotent — reconcile twice fires a one-time reminder once', () => {
    const now = Date.now();
    repo.create(at(now - 1000));
    const s = createScheduler({ now: () => now, repo, sink });
    s.reconcile('tick');
    s.reconcile('tick');
    expect(fired).toHaveLength(1);
  });

  it('does nothing while paused', () => {
    const now = Date.now();
    repo.create(at(now - 1000));
    const s = createScheduler({ now: () => now, repo, sink, isPaused: () => true });
    expect(s.reconcile('tick').fired).toBe(0);
    expect(fired).toHaveLength(0);
  });

  it('respects the repo findDue cap of 20 in a clock-jump storm', () => {
    const now = Date.now();
    for (let i = 0; i < 25; i++) repo.create(at(now - 1000 - i));
    const s = createScheduler({ now: () => now, repo, sink });
    // findDue caps at 20; the scheduler fires what it is given. The 5 remaining stay pending
    // for the next tick, so no notification storm.
    expect(s.reconcile('tick').fired).toBe(20);
  });
});
