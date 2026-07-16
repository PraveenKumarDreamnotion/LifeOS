/**
 * Reminder popup contracts (55) — the data main sends to the always-on-top popup window, and the
 * lifecycle action the popup sends back. Pure/DOM-free so both the preload (dependency-free) and
 * the renderer can type against it.
 */

/** What the popup renders for the current reminder (+ how many are queued behind it). */
export interface ReminderPopupData {
  reminderId: string;
  title: string;
  description: string | null;
  /** Human-readable local time, e.g. "9:00 AM" or "Mon 9:00 AM". */
  timeLabel: string;
  /** The line Yogi speaks / shows, e.g. "It's time to call Rahul." */
  spokenLine: string;
  /** Reminders waiting behind this one ("+N more"); 0 = none. */
  queued: number;
  /** Recurring reminders can't be snoozed — the popup hides the Snooze control. */
  canSnooze: boolean;
  /** The chat this reminder belongs to (CONV), so a popup reply continues that conversation with
   *  full context. null for a manual/pre-existing reminder — the popup mints a session lazily. */
  sessionId: string | null;
}

export type ReminderPopupAction =
  | { reminderId: string; action: 'complete' } // mark done → leaves Active Schedules, History records
  | { reminderId: string; action: 'dismiss' } // mark dismissed → leaves Active Schedules
  | { reminderId: string; action: 'snooze'; minutes: number } // re-fire later
  | { reminderId: string; action: 'hide' }; // ✕ — just close the toast; reminder stays active
