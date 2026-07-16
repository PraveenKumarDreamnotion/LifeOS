/**
 * The reminder domain model (15 §1).
 *
 * Times are epoch-ms integers, never Date objects and never ISO strings. The IANA
 * timezone is stored separately — an offset is not a zone (it can't tell you what it
 * will be after a DST change). This is what lets the model cross IPC and round-trip
 * through JSON unchanged.
 */
import type { ReminderExecutionSpec } from './reminder-execution';

export type ActionType = 'notify' | 'sing';

export type ReminderStatus =
  | 'pending'
  | 'triggered'
  | 'completed'
  | 'dismissed'
  | 'cancelled'
  | 'missed'
  | 'error';

export type ReminderSource = 'local' | 'llm' | 'manual';

export interface Reminder {
  id: string; // uuid v4

  title: string;
  description: string | null;

  /** What the user originally asked for. Never changes after creation. UTC epoch ms. */
  scheduledAt: number;
  /** What the scheduler compares against Date.now(). Rolls forward on recurrence. UTC epoch ms. */
  nextFireAt: number;

  timezone: string; // IANA, e.g. 'Asia/Kolkata'
  recurrenceRule: string | null; // 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0'
  actionType: ActionType;
  status: ReminderStatus;
  source: ReminderSource;
  isPaused: boolean;

  /** The chat that created this reminder (CONV), or null for manual/pre-existing ones. When set, a
   *  fired reminder is delivered INTO this chat so the conversation can continue from it. */
  sessionId: string | null;

  /** Structured "what to do when this fires" (reminder-execution). null = classic notify/sing.
   *  Non-null 'ai_task' → the fire-time executor runs the instruction and delivers the answer. */
  execution: ReminderExecutionSpec | null;

  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  lastTriggeredAt: number | null;
}

export type HistoryAction =
  | 'triggered'
  | 'dismissed'
  | 'completed'
  | 'snoozed'
  | 'missed'
  | 'failed';

export interface ReminderHistoryEntry {
  id: string;
  reminderId: string;
  /** Denormalised: history must not change when a reminder's title is edited. */
  titleAtTime: string;
  triggeredAt: number;
  actionTaken: HistoryAction;
  dismissedAt: number | null;
  completedAt: number | null;
  snoozedTo: number | null;
}
