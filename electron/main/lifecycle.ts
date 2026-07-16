import { dialog, type BrowserWindow } from 'electron';
import type { SettingsRepository } from '../database/settings-repository';

/**
 * The one-time close-to-tray notice (12 §13). Shown the first time the user closes the
 * window, so the tray behaviour is never a surprise. A native dialog, because the window
 * is about to hide.
 */
export function showTrayNoticeOnce(win: BrowserWindow, settings: SettingsRepository): void {
  if (settings.get('tray_notice_shown') === 'true') return;

  dialog.showMessageBoxSync(win, {
    type: 'info',
    title: 'LifeOS is still running',
    message: 'LifeOS is still running',
    detail:
      'Yogi will keep running in the background so your reminders can work. ' +
      'Use Quit from the tray menu to fully close LifeOS.',
    buttons: ['Got it'],
    noLink: true,
  });

  // The notice is genuinely one-time.
  settings.set('tray_notice_shown', 'true');
}
