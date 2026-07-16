/**
 * Reminder execution history (10 §5). title_at_time is denormalised so history does not
 * change when a reminder's title is edited — history is a log, not a view.
 */
import { randomUUID } from 'node:crypto';
import type { SqliteDriver } from './driver';
import { type HistoryRow, historyToDomain } from './rows';
import type { ReminderHistoryEntry, HistoryAction } from '../../core/types/reminder';
import type { HistoryFilterInput } from '../../core/types/ipc';

export class HistoryRepository {
  constructor(private readonly db: SqliteDriver) {}

  record(
    reminderId: string,
    titleAtTime: string,
    triggeredAt: number,
    action: HistoryAction = 'triggered',
  ): void {
    this.db.run(
      `INSERT INTO reminder_history (id, reminder_id, title_at_time, triggered_at, action_taken)
       VALUES (?,?,?,?,?)`,
      [randomUUID(), reminderId, titleAtTime, triggeredAt, action],
    );
  }

  list(filter: HistoryFilterInput): ReminderHistoryEntry[] {
    if (filter.status === 'all') {
      return this.db
        .all<HistoryRow>(
          'SELECT * FROM reminder_history ORDER BY triggered_at DESC LIMIT ?',
          [filter.limit],
        )
        .map(historyToDomain);
    }

    // Map the UI filter to the stored action_taken value.
    const action = filter.status === 'cancelled' ? 'dismissed' : filter.status;
    return this.db
      .all<HistoryRow>(
        'SELECT * FROM reminder_history WHERE action_taken = ? ORDER BY triggered_at DESC LIMIT ?',
        [action, filter.limit],
      )
      .map(historyToDomain);
  }
}
