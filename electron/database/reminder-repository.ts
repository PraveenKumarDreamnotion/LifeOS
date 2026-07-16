/**
 * Reminder repository (10 §6). Every query parameterized — zero string interpolation
 * into SQL, no exceptions.
 */
import { randomUUID } from 'node:crypto';
import type { SqliteDriver } from './driver';
import { type ReminderRow, toDomain } from './rows';
import type { Reminder } from '../../core/types/reminder';
import { serializeExecutionSpec } from '../../core/types/reminder-execution';
import type { CreateReminderInput, UpdateReminderInput } from '../../core/types/ipc';

export class ReminderRepository {
  constructor(private readonly db: SqliteDriver) {}

  /** `sessionId` links the reminder to the chat that created it (provenance — NOT part of the
   *  validated CreateReminderInput contract; null for reminders made outside a chat). */
  create(input: CreateReminderInput, sessionId: string | null = null): Reminder {
    const now = Date.now();
    const id = randomUUID();

    this.db.run(
      `INSERT INTO reminders
         (id, title, description, scheduled_at, next_fire_at, timezone, recurrence_rule,
          action_type, status, source, is_paused, created_at, updated_at, session_id, execution_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.title,
        input.description ?? null,
        input.scheduledAtUtcMs,
        input.scheduledAtUtcMs, // next_fire_at starts equal to scheduled_at
        input.timezone,
        input.recurrenceRule ?? null,
        input.actionType,
        'pending',
        input.source,
        0,
        now,
        now,
        sessionId,
        // null for simple/absent specs → the row is byte-identical to a pre-execution reminder.
        serializeExecutionSpec(input.execution),
      ],
    );

    return this.get(id)!;
  }

  get(id: string): Reminder | undefined {
    const row = this.db.get<ReminderRow>('SELECT * FROM reminders WHERE id = ?', [id]);
    return row ? toDomain(row) : undefined;
  }

  /** Active (not completed/cancelled) reminders for the schedules list, soonest first. */
  listActive(): Reminder[] {
    return this.db
      .all<ReminderRow>(
        `SELECT * FROM reminders
          WHERE status IN ('pending', 'triggered')
          ORDER BY next_fire_at ASC`,
      )
      .map(toDomain);
  }

  /** Everything, newest first — used by the Day-2 dev list. */
  listAll(): Reminder[] {
    return this.db
      .all<ReminderRow>('SELECT * FROM reminders ORDER BY created_at DESC')
      .map(toDomain);
  }

  /** The scheduler's hot path (08 §10). Hits idx_reminders_due. LIMIT is the storm guard. */
  findDue(nowMs: number): Reminder[] {
    return this.db
      .all<ReminderRow>(
        `SELECT * FROM reminders
          WHERE status = 'pending' AND is_paused = 0 AND next_fire_at <= ?
          ORDER BY next_fire_at ASC
          LIMIT 20`,
        [nowMs],
      )
      .map(toDomain);
  }

  update(id: string, patch: UpdateReminderInput): Reminder | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    // Re-scheduling (a new scheduledAt) re-anchors the reminder AND re-arms it: an edit that moves
    // a fired/dismissed/missed/completed reminder to a future time must make it pending again, or
    // the scheduler would never look at it. next_fire_at resets to the new first occurrence — the
    // caller (UI/parser) supplies the true first fire, so recurrence changes take effect cleanly.
    const rescheduled = patch.scheduledAtUtcMs !== undefined;
    const merged = {
      title: patch.title ?? existing.title,
      description: patch.description !== undefined ? patch.description : existing.description,
      scheduled_at: patch.scheduledAtUtcMs ?? existing.scheduledAt,
      next_fire_at: patch.scheduledAtUtcMs ?? existing.nextFireAt,
      timezone: patch.timezone ?? existing.timezone,
      recurrence_rule:
        patch.recurrenceRule !== undefined ? patch.recurrenceRule : existing.recurrenceRule,
      action_type: patch.actionType ?? existing.actionType,
      status: rescheduled ? 'pending' : existing.status,
      completed_at: rescheduled ? null : existing.completedAt,
    };

    this.db.run(
      `UPDATE reminders
          SET title = ?, description = ?, scheduled_at = ?, next_fire_at = ?,
              timezone = ?, recurrence_rule = ?, action_type = ?, status = ?,
              completed_at = ?, updated_at = ?
        WHERE id = ?`,
      [
        merged.title,
        merged.description,
        merged.scheduled_at,
        merged.next_fire_at,
        merged.timezone,
        merged.recurrence_rule,
        merged.action_type,
        merged.status,
        merged.completed_at,
        Date.now(),
        id,
      ],
    );
    return this.get(id);
  }

  delete(id: string): boolean {
    // ON DELETE CASCADE removes the reminder's history.
    return this.db.run('DELETE FROM reminders WHERE id = ?', [id]).changes > 0;
  }

  setPaused(id: string, paused: boolean): Reminder | undefined {
    this.db.run('UPDATE reminders SET is_paused = ?, updated_at = ? WHERE id = ?', [
      paused ? 1 : 0,
      Date.now(),
      id,
    ]);
    return this.get(id);
  }

  /**
   * Roll a recurring reminder forward to its next occurrence. `firedAtMs` is passed ONLY when the
   * reminder actually fired this cycle; a missed-while-closed roll-forward omits it so
   * last_triggered_at is not stamped for a fire that never happened (30 D3).
   */
  setNextFireAt(id: string, nextMs: number, firedAtMs?: number): void {
    const now = Date.now();
    if (firedAtMs !== undefined) {
      this.db.run(
        'UPDATE reminders SET next_fire_at = ?, last_triggered_at = ?, updated_at = ? WHERE id = ?',
        [nextMs, firedAtMs, now, id],
      );
    } else {
      this.db.run('UPDATE reminders SET next_fire_at = ?, updated_at = ? WHERE id = ?', [nextMs, now, id]);
    }
  }

  markTriggered(id: string, atMs: number): void {
    this.db.run(
      `UPDATE reminders SET status = 'triggered', last_triggered_at = ?, updated_at = ? WHERE id = ?`,
      [atMs, Date.now(), id],
    );
  }

  markCompleted(id: string): void {
    const now = Date.now();
    this.db.run(
      `UPDATE reminders SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, id],
    );
  }

  markMissed(id: string, atMs: number): void {
    this.db.run(`UPDATE reminders SET status = 'missed', updated_at = ? WHERE id = ?`, [
      atMs,
      id,
    ]);
  }

  markDismissed(id: string): void {
    this.db.run(`UPDATE reminders SET status = 'dismissed', updated_at = ? WHERE id = ?`, [
      Date.now(),
      id,
    ]);
  }

  /** Re-arm a fired one-time reminder to fire again after `minutes`. */
  snooze(id: string, minutes: number): Reminder | undefined {
    const now = Date.now();
    this.db.run(
      `UPDATE reminders SET status = 'pending', next_fire_at = ?, updated_at = ? WHERE id = ?`,
      [now + minutes * 60_000, now, id],
    );
    return this.get(id);
  }
}
