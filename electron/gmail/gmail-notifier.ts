/**
 * New-email desktop notification (Phase 2/3). Mirrors electron/notifications/notifier.ts: a
 * main-process Notification that fires regardless of window state, with an explicit click handler
 * supplied by the caller (the email-delivery coordinator, which knows which chat to open).
 *
 * Button reality (docs §3): Windows Electron `Notification` has NO custom action buttons — the
 * codebase's precedent for actionable alerts is the reminder POPUP window. So "Open / Ask Yogi /
 * Dismiss" as toast buttons is deliberately deferred; clicking the toast opens the email's chat,
 * where the user talks to Yogi about it.
 */
import { Notification } from 'electron';

export interface EmailNotification {
  title: string;
  body: string;
  onClick: () => void;
}

export interface GmailNotifier {
  show(n: EmailNotification): void;
}

export function createGmailNotifier(): GmailNotifier {
  return {
    show(n: EmailNotification): void {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title: n.title, body: n.body, silent: false });
      notification.on('click', n.onClick);
      notification.show();
    },
  };
}
