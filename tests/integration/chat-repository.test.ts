import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../electron/database/open';
import { ChatRepository } from '../../electron/database/chat-repository';
import type { SqliteDriver } from '../../electron/database/driver';

let dbPath: string;
let db: SqliteDriver;
let repo: ChatRepository;
let clock = 1_000;

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-chat-${randomUUID()}.db`);
  db = openDatabase(dbPath);
  clock = 1_000;
  repo = new ChatRepository(db, () => clock);
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

describe('ChatRepository', () => {
  it('creates and lists sessions, newest activity first', () => {
    const a = repo.createSession('First');
    clock = 2_000;
    const b = repo.createSession('Second');
    const list = repo.listSessions();
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(repo.getSession(a.id)?.title).toBe('First');
  });

  it('records turns and rebuilds them faithfully (assistant_text is what was shown)', () => {
    const s = repo.createSession();
    repo.recordTurn({ id: 't1', sessionId: s.id, userText: 'hello', assistantText: 'Hi! I am Yogi.', intent: 'chat' });
    repo.recordTurn({ id: 't2', sessionId: s.id, userText: 'thanks', assistantText: 'Anytime.', intent: 'chat' });
    const turns = repo.loadTurns(s.id);
    expect(turns.map((t) => [t.userText, t.assistantText])).toEqual([
      ['hello', 'Hi! I am Yogi.'],
      ['thanks', 'Anytime.'],
    ]);
  });

  it('stores a proposal turn and settles its outcome on resolve', () => {
    const s = repo.createSession();
    repo.recordTurn({
      id: 'turn-x',
      sessionId: s.id,
      userText: 'remind me at 9am to call Rahul',
      assistantText: "Here's what I understood.",
      intent: 'reminder_create',
      proposalSummary: 'Call Rahul · 9:00 AM · one-time',
      proposalStatus: 'pending',
    });
    // reopen mid-pending → still pending
    expect(repo.loadTurns(s.id)[0]!.proposalStatus).toBe('pending');
    // user confirms → settle
    repo.resolveProposal('turn-x', 'executed', 'rem-123');
    const settled = repo.loadTurns(s.id)[0]!;
    expect(settled.proposalStatus).toBe('executed');
    expect(settled.reminderId).toBe('rem-123');
    expect(settled.proposalSummary).toBe('Call Rahul · 9:00 AM · one-time');
  });

  it('records a reminder delivery as an assistant-only reminder turn and bumps the session', () => {
    const a = repo.createSession('A');
    clock = 2_000;
    repo.createSession('B'); // B newer
    clock = 3_000;
    const turn = repo.recordReminderDelivery(a.id, 'rem-1', '⏰ Time to call Rahul');
    expect(turn.kind).toBe('reminder');
    expect(turn.userText).toBe(''); // no user text — renders assistant-only
    expect(turn.assistantText).toBe('⏰ Time to call Rahul');
    expect(turn.reminderId).toBe('rem-1');
    // it lands in the session's turns...
    const loaded = repo.loadTurns(a.id);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.kind).toBe('reminder');
    // ...and bumps A to the top of the list (so a fired reminder's chat is findable).
    expect(repo.listSessions()[0]!.id).toBe(a.id);
  });

  it('recentTurns returns the last K in chronological order', () => {
    const s = repo.createSession();
    for (let i = 0; i < 5; i++) {
      clock += 10;
      repo.recordTurn({ id: `t${i}`, sessionId: s.id, userText: `u${i}`, assistantText: `a${i}` });
    }
    const recent = repo.recentTurns(s.id, 3);
    expect(recent.map((t) => t.userText)).toEqual(['u2', 'u3', 'u4']);
  });

  it('recording a turn bumps the session to the top of the list', () => {
    const a = repo.createSession('A');
    clock = 2_000;
    repo.createSession('B'); // B is newer
    clock = 3_000;
    repo.recordTurn({ id: 't1', sessionId: a.id, userText: 'u', assistantText: 'a' }); // A now most recent
    expect(repo.listSessions()[0]!.id).toBe(a.id);
  });

  it('deleteSession removes the chat + its turns but KEEPS reminders (nulls their link)', () => {
    const s = repo.createSession('Doomed');
    repo.recordTurn({ id: 't1', sessionId: s.id, userText: 'hi', assistantText: 'hello' });
    db.run(
      `INSERT INTO reminders (id, title, scheduled_at, next_fire_at, timezone, created_at, updated_at, session_id)
       VALUES ('r1', 'Call mom', 1, 1, 'UTC', 1, 1, ?)`,
      [s.id],
    );
    repo.deleteSession(s.id);
    expect(repo.getSession(s.id)).toBeUndefined();
    expect(repo.loadTurns(s.id)).toHaveLength(0);
    // the reminder survives, with its session link cleared (reminders outlive chats)
    const rem = db.get<{ session_id: string | null }>('SELECT session_id FROM reminders WHERE id = ?', ['r1']);
    expect(rem?.session_id).toBeNull();
  });

  it('reminders gained a nullable session_id column (migration 003)', () => {
    // The ALTER TABLE applied — inserting a reminder with a session_id succeeds.
    db.run(
      `INSERT INTO reminders (id, title, scheduled_at, next_fire_at, timezone, created_at, updated_at, session_id)
       VALUES (?, 'x', 1, 1, 'UTC', 1, 1, ?)`,
      [randomUUID(), 'sess-1'],
    );
    const row = db.get<{ session_id: string }>('SELECT session_id FROM reminders LIMIT 1');
    expect(row?.session_id).toBe('sess-1');
  });
});
