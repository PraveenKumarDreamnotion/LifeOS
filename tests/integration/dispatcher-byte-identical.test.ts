import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../electron/database/open';
import { ReminderRepository } from '../../electron/database/reminder-repository';
import { executeAction } from '../../electron/actions/execute';
import { reminderCreateEnvelope } from '../../electron/conversation/conversation-engine';
import type { SqliteDriver } from '../../electron/database/driver';
import type { CreateReminderInput } from '../../core/types/ipc';
import type { ParsedReminder } from '../../core/parsing/types';
import type { Reminder } from '../../core/types/reminder';

/**
 * EP-6 DoD #8 (47 §Regression 1) — the MANDATED byte-identical gate. A reminder created via the
 * Action Dispatcher must persist a row identical to the EP-2 direct path, minus id + timestamps.
 * Both paths start from the same ParsedReminder and end at the same repo.create writer, so this
 * proves the re-route is non-regressing.
 */
let dbPath: string;
let db: SqliteDriver;
let repo: ReminderRepository;

const IN_ONE_HOUR = Date.now() + 3_600_000;

const PARSED: ParsedReminder = {
  intent: 'create_reminder',
  title: 'Call Rahul',
  description: null,
  scheduledAtUtcMs: IN_ONE_HOUR,
  scheduledAtIso: new Date(IN_ONE_HOUR).toISOString(),
  timezone: 'Asia/Kolkata',
  recurrenceRule: null,
  actionType: 'notify',
  confidence: 0.9,
  source: 'local',
  matchedDateText: 'in one hour',
};

// The exact fields the EP-2 direct path (useConversation.confirm) sends to ipc.createReminder.
const directInput: CreateReminderInput = {
  title: PARSED.title,
  description: PARSED.description,
  scheduledAtUtcMs: PARSED.scheduledAtUtcMs,
  timezone: PARSED.timezone,
  recurrenceRule: PARSED.recurrenceRule,
  actionType: PARSED.actionType,
  source: 'local',
};

/** Fields that legitimately differ per-row (identity + wall-clock), stripped before the diff. */
function stripVolatile(r: Reminder): Partial<Reminder> {
  const rest: Partial<Reminder> = { ...r };
  delete rest.id;
  delete rest.createdAt;
  delete rest.updatedAt;
  return rest;
}

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-byteid-${randomUUID()}.db`);
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

describe('EP-6 byte-identical regression gate', () => {
  it('the dispatcher-built create input equals the direct-path input', () => {
    // The dispatcher builds its input from the SAME ParsedReminder via the real engine helper +
    // Execution Layer; capture what it hands to the writer.
    let captured: CreateReminderInput | undefined;
    const env = reminderCreateEnvelope(PARSED, randomUUID());
    executeAction(env.action, env.source, { createReminder: (input) => ((captured = input), 'rem-1') });
    expect(captured).toEqual(directInput);
  });

  it('the persisted row is identical (minus id + timestamps) via both paths', () => {
    const direct = repo.create(directInput);

    let captured: CreateReminderInput | undefined;
    const env = reminderCreateEnvelope(PARSED, randomUUID());
    executeAction(env.action, env.source, { createReminder: (input) => ((captured = input), 'rem-1') });
    const dispatched = repo.create(captured!);

    expect(stripVolatile(dispatched)).toEqual(stripVolatile(direct));
    // And the provenance column is 'local' on both (parser-produced fields).
    expect(dispatched.source).toBe('local');
    expect(direct.source).toBe('local');
  });
});
