/**
 * ReminderPopup coordinator (55 §7, P1) — owns the always-on-top popup's queue and lifecycle. One
 * reminder is shown at a time; further fired reminders QUEUE behind it ("+N more") so voices never
 * overlap and there is no confusing overlap (55 §2.7). It positions the (startup-created, hidden)
 * popup window bottom-right of the cursor's display, shows it INACTIVE (no focus steal), speaks the
 * reminder, and maps Complete/Dismiss/Snooze to the SAME repo writers the direct IPC uses.
 *
 * Best-effort: this runs AFTER the unconditional notification + history in the trigger-sink, so a
 * failure here never costs a reminder (55 §2.6). Kept electron-free (window + position are deps) so
 * the queue/action state machine is unit-testable; index.ts registers the POPUP_ACTION IPC over it.
 */
import { z } from 'zod';
import { CH } from '../../core/types/channels';
import { matchPopupLifecycle, formatSnooze } from '../actions/popup-lifecycle-matcher';
import { matchVoiceConfirm } from '../actions/voice-confirm-matcher';
import { spokenReminder } from '../../core/tts/reminder-speech';
import type { Reminder } from '../../core/types/reminder';
import type { ReminderPopupData, ReminderPopupAction } from '../../core/types/popup';

const SAFETY_HIDE_MS = 10 * 60 * 1000; // auto-hide an ignored popup (reminder stays active — fails safe)
const ADVANCE_AFTER_ACTION_MS = 1800; // show the confirming reply, then move to the next reminder

export const PopupMessageInput = z
  .object({ reminderId: z.string().uuid(), text: z.string().trim().min(1).max(4000) })
  .strict();

export const PopupActionInput = z.union([
  z.object({ reminderId: z.string().uuid(), action: z.literal('complete') }).strict(),
  z.object({ reminderId: z.string().uuid(), action: z.literal('dismiss') }).strict(),
  z.object({ reminderId: z.string().uuid(), action: z.literal('snooze'), minutes: z.number().int().positive().max(10080) }).strict(),
  z.object({ reminderId: z.string().uuid(), action: z.literal('hide') }).strict(),
]);

/** The reminder writers the popup drives — the same ones the direct lifecycle IPC calls (55 §7). */
export interface ReminderLifecycle {
  get(id: string): Reminder | undefined;
  markCompleted(id: string): void;
  markDismissed(id: string): void;
  snooze(id: string, minutes: number): unknown;
  delete(id: string): unknown;
}

/** The outcome of a typed/spoken popup message: a lifecycle action, or fall back to chat. */
export interface PopupMessageResult {
  reply?: string;
  /** Set when a lifecycle action ran — the popup will advance to the next reminder shortly. */
  action?: 'completed' | 'dismissed' | 'snoozed' | 'deleted';
  /** true → not a lifecycle command; the popup should send it as a normal chat turn. */
  chat?: boolean;
}
export interface HistoryRecorder {
  record(reminderId: string, title: string, at: number, action: 'completed' | 'dismissed' | 'snoozed'): void;
}

/** The subset of BrowserWindow the coordinator touches (structural, so a fake drives the tests). */
export interface PopupWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  showInactive(): void;
  hide(): void;
  webContents: { send(channel: string, payload: unknown): void };
}

export interface ReminderPopupDeps {
  /** The live popup window (created hidden at startup); null if it failed/was destroyed. */
  window: () => PopupWindow | null;
  /** Pin the popup bottom-right of the cursor display (injected so this file stays electron-free). */
  position: (win: PopupWindow) => void;
  reminders: ReminderLifecycle;
  history: HistoryRecorder;
  onChanged: () => void;
  /** Speak the reminder aloud through the shared audio path (gated by the Voice toggle in main). */
  speak: (text: string) => void;
  /** Human-readable local time for the reminder (e.g. "9:00 AM"). */
  formatTime: (r: Reminder) => string;
  /** Conversation interruption: fired when the popup queue DRAINS after the user handles the last
   *  reminder (complete/dismiss/snooze/✕) — the signal to resume any conversation paused when the
   *  reminder fired. Not fired by the safety auto-hide (the reminder was ignored, not handled). */
  onQueueDrained?: () => void;
  now?: () => number;
}

export interface ReminderPopup {
  enqueue(r: Reminder): void;
  handleAction(payload: ReminderPopupAction): { ok: boolean };
  handleMessage(reminderId: string, text: string): PopupMessageResult;
}

export function createReminderPopup(deps: ReminderPopupDeps): ReminderPopup {
  const now = deps.now ?? (() => Date.now());
  const queue: Reminder[] = [];
  let current: Reminder | null = null;
  let safetyTimer: ReturnType<typeof setTimeout> | undefined;
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingDelete: string | null = null; // a reminderId awaiting a "yes/no" delete confirmation

  const toData = (r: Reminder): ReminderPopupData => ({
    reminderId: r.id,
    title: r.title,
    description: r.description,
    timeLabel: deps.formatTime(r),
    spokenLine: spokenReminder(r.title),
    queued: queue.length,
    canSnooze: !r.recurrenceRule,
    sessionId: r.sessionId,
  });

  const send = (r: Reminder) => {
    const w = deps.window();
    if (w && !w.isDestroyed()) w.webContents.send(CH.POPUP_SHOW, toData(r));
  };

  const showCurrent = () => {
    const w = deps.window();
    if (!w || w.isDestroyed() || !current) return;
    deps.position(w);
    w.showInactive(); // visible + on top, but NEVER steals focus (55 §2.1)
    send(current);
    deps.speak(toData(current).spokenLine);
    if (safetyTimer) clearTimeout(safetyTimer);
    safetyTimer = setTimeout(hide, SAFETY_HIDE_MS);
    (safetyTimer as { unref?: () => void }).unref?.();
  };

  const hide = () => {
    const w = deps.window();
    if (w && !w.isDestroyed() && w.isVisible()) w.hide();
    if (safetyTimer) clearTimeout(safetyTimer);
  };

  /** Move to the next queued reminder, or hide when the queue drains. */
  const advance = () => {
    if (advanceTimer) clearTimeout(advanceTimer);
    pendingDelete = null;
    current = queue.shift() ?? null;
    if (current) {
      showCurrent();
    } else {
      hide();
      deps.onQueueDrained?.(); // all reminders handled → resume any paused conversation
    }
  };

  /** After a natural-language lifecycle action, let the user read the confirming reply, then move on. */
  const scheduleAdvance = () => {
    if (advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = setTimeout(advance, ADVANCE_AFTER_ACTION_MS);
    (advanceTimer as { unref?: () => void }).unref?.();
  };

  const enqueue = (r: Reminder) => {
    if (current?.id === r.id || queue.some((q) => q.id === r.id)) return; // no duplicates
    if (current) {
      queue.push(r);
      send(current); // refresh the "+N more" count on the shown popup
    } else {
      current = r;
      showCurrent();
    }
  };

  const handleAction = (payload: ReminderPopupAction): { ok: boolean } => {
    // Only ever act on the currently-shown reminder — the popup can't touch a queued/other one.
    if (!current || current.id !== payload.reminderId) return { ok: false };
    const r = deps.reminders.get(payload.reminderId);
    if (r) {
      if (payload.action === 'complete') {
        deps.reminders.markCompleted(r.id);
        deps.history.record(r.id, r.title, now(), 'completed');
        deps.onChanged();
      } else if (payload.action === 'dismiss') {
        deps.reminders.markDismissed(r.id);
        deps.history.record(r.id, r.title, now(), 'dismissed');
        deps.onChanged();
      } else if (payload.action === 'snooze' && !r.recurrenceRule) {
        deps.reminders.snooze(r.id, payload.minutes);
        deps.history.record(r.id, r.title, now(), 'snoozed');
        deps.onChanged();
      }
      // 'hide' (✕) does nothing to the reminder — it just closes the toast.
    }
    advance();
    return { ok: true };
  };

  /**
   * Classify a typed/spoken popup message. A lifecycle command (complete/dismiss/snooze/cancel)
   * acts on the SHOWN reminder — deterministically, in main, never via the LLM. Delete is gated by a
   * "yes/no" confirm. Anything else → { chat: true } so the popup answers it as a normal chat turn.
   */
  const handleMessage = (reminderId: string, text: string): PopupMessageResult => {
    if (!current || current.id !== reminderId) return { chat: true }; // stale — just chat
    const r = deps.reminders.get(reminderId);
    if (!r) return { reply: 'That reminder no longer exists.', action: 'dismissed' };

    // A pending delete confirmation takes precedence: only a clear yes/no resolves it.
    if (pendingDelete === reminderId) {
      const yn = matchVoiceConfirm(text);
      if (yn === 'affirm') {
        pendingDelete = null;
        deps.reminders.delete(reminderId);
        deps.onChanged();
        scheduleAdvance();
        return { reply: 'Deleted.', action: 'deleted' };
      }
      if (yn === 'negate') {
        pendingDelete = null;
        return { reply: 'Okay, I kept it.' };
      }
      pendingDelete = null; // ambiguous → drop the confirm and treat the message normally
    }

    const m = matchPopupLifecycle(text);
    switch (m.kind) {
      case 'complete':
        deps.reminders.markCompleted(reminderId);
        deps.history.record(reminderId, r.title, now(), 'completed');
        deps.onChanged();
        scheduleAdvance();
        return { reply: '✓ Marked complete. Nice work!', action: 'completed' };
      case 'dismiss':
        deps.reminders.markDismissed(reminderId);
        deps.history.record(reminderId, r.title, now(), 'dismissed');
        deps.onChanged();
        scheduleAdvance();
        return { reply: 'Dismissed.', action: 'dismissed' };
      case 'snooze':
        if (r.recurrenceRule) return { reply: "This one repeats, so it'll come back on its own — no need to snooze." };
        deps.reminders.snooze(reminderId, m.minutes);
        deps.history.record(reminderId, r.title, now(), 'snoozed');
        deps.onChanged();
        scheduleAdvance();
        return { reply: `Snoozed for ${formatSnooze(m.minutes)}.`, action: 'snoozed' };
      case 'cancel':
        pendingDelete = reminderId;
        return { reply: 'Delete this reminder? Reply “yes” to confirm, or “no” to keep it.' };
      case 'none':
        return { chat: true };
    }
  };

  return { enqueue, handleAction, handleMessage };
}
