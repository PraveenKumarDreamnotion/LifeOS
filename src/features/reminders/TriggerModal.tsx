import { Modal } from '../../components/Modal';
import { formatAbsolute } from '../../../core/time/format';
import type { ReminderDto } from '../../../core/types/ipc';

/**
 * The reminder trigger modal (12 §9). Focus lands on Dismiss (safest default). Snooze is
 * HIDDEN for recurring reminders — snoozing a weekly reminder is ambiguous and we refuse to
 * guess. Never auto-dismisses on a timer. Queues multiple simultaneous triggers.
 */
export function TriggerModal({
  reminder,
  total,
  snoozeMinutes,
  onDismiss,
  onComplete,
  onSnooze,
}: {
  reminder: ReminderDto;
  total: number;
  snoozeMinutes: number;
  onDismiss: () => void;
  onComplete: () => void;
  onSnooze: () => void;
}) {
  const recurring = !!reminder.recurrenceRule;
  return (
    <Modal role="alertdialog" onEscape={onDismiss} labelledBy="trigger-title">
      <div className="trigger">
        <div className="mark">◈</div>
        {/* total counts the current reminder + any queued behind it; acting on this one shrinks it. */}
        {total > 1 && <p className="chip queue-chip">+{total - 1} more waiting</p>}
        <h2 id="trigger-title">{reminder.title}</h2>
        {reminder.description && <p className="dim">{reminder.description}</p>}
        <p className="when">{formatAbsolute(reminder.nextFireAt, reminder.timezone)}</p>
        <div className="actions">
          {!recurring && (
            <button className="ghost" onClick={onSnooze}>
              Snooze {snoozeMinutes} min
            </button>
          )}
          {/* Focus starts on Dismiss — the safest default. */}
          <button className="ghost" autoFocus onClick={onDismiss}>
            Dismiss
          </button>
          <button onClick={onComplete}>✓ Done</button>
        </div>
      </div>
    </Modal>
  );
}
