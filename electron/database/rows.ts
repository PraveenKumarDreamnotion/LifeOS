/**
 * Row types (the SQLite shape) and the mapping to the domain model (15 §2).
 * Rows never leave the main process; the domain model is what crosses IPC.
 */
import type {
  Reminder,
  ActionType,
  ReminderStatus,
  ReminderSource,
  ReminderHistoryEntry,
  HistoryAction,
} from '../../core/types/reminder';
import { parseExecutionSpec } from '../../core/types/reminder-execution';

export interface ReminderRow {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: number;
  next_fire_at: number;
  timezone: string;
  recurrence_rule: string | null;
  action_type: string;
  status: string;
  source: string;
  is_paused: 0 | 1;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  last_triggered_at: number | null;
  session_id: string | null;
  /** Added by M005. NULL on every pre-M005 row and on plain notify/sing reminders. */
  execution_json: string | null;
}

export function toDomain(r: ReminderRow): Reminder {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    scheduledAt: r.scheduled_at,
    nextFireAt: r.next_fire_at,
    timezone: r.timezone,
    recurrenceRule: r.recurrence_rule,
    // Safe casts: the CHECK constraints make any other value impossible to store,
    // which an integration test asserts (that is what licenses these casts).
    actionType: r.action_type as ActionType,
    status: r.status as ReminderStatus,
    source: r.source as ReminderSource,
    isPaused: r.is_paused === 1,
    sessionId: r.session_id,
    // Defensive parse: a corrupt/legacy blob fails safe to null (→ classic notify/sing).
    execution: parseExecutionSpec(r.execution_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    lastTriggeredAt: r.last_triggered_at,
  };
}

export interface HistoryRow {
  id: string;
  reminder_id: string;
  title_at_time: string;
  triggered_at: number;
  action_taken: string;
  dismissed_at: number | null;
  completed_at: number | null;
  snoozed_to: number | null;
}

export function historyToDomain(r: HistoryRow): ReminderHistoryEntry {
  return {
    id: r.id,
    reminderId: r.reminder_id,
    titleAtTime: r.title_at_time,
    triggeredAt: r.triggered_at,
    actionTaken: r.action_taken as HistoryAction,
    dismissedAt: r.dismissed_at,
    completedAt: r.completed_at,
    snoozedTo: r.snoozed_to,
  };
}
