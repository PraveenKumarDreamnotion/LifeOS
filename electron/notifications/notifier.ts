/**
 * Windows notifications from the MAIN process (04 §10). Fires regardless of window state,
 * including hidden-to-tray. The click handler must be wired explicitly — it is not automatic.
 */
import { Notification } from 'electron';
import type { Reminder } from '../../core/types/reminder';

export interface Notifier {
  show(reminder: Reminder): void;
}

export function createNotifier(onClick: (reminder: Reminder) => void): Notifier {
  return {
    show(reminder: Reminder): void {
      if (!Notification.isSupported()) return;
      const n = new Notification({
        title: reminder.title,
        body: reminder.description ?? 'LifeOS reminder',
        silent: false,
      });
      // Pass the fired reminder to the click handler so it can open the launcher directly into that
      // reminder's conversation (matches the email-notification behaviour).
      n.on('click', () => onClick(reminder));
      n.show();
    },
  };
}
