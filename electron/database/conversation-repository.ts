import { randomUUID } from 'node:crypto';
import type { SqliteDriver } from './driver';

/**
 * ConversationRepository (43) — the first reader/writer of the `conversations` table (migration
 * 002, previously dead schema — 30 §3.2, 31 §4.2). One human-readable row per completed turn;
 * no raw parser internals, no secrets. Writing is best-effort: a log-write failure must never
 * break a reminder (§8.6 — notification/history/reminder are first-class, the transcript is not).
 */
export class ConversationRepository {
  constructor(private readonly db: SqliteDriver) {}

  record(userText: string, assistantResponse: string, intent: string, reminderId: string | null): void {
    this.db.run(
      `INSERT INTO conversations (id, user_text, assistant_response, intent, reminder_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), userText, assistantResponse, intent, reminderId, Date.now()],
    );
  }
}
