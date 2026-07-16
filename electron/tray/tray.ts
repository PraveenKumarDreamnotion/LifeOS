import { app, Tray, Menu, nativeImage } from 'electron';
import { join } from 'node:path';

/**
 * System tray (12 §14). The Tray instance is held at MODULE scope — a function-scoped Tray
 * is garbage-collected and the icon vanishes after ~10 s in packaged builds (11 §9 / SPIKE-4).
 */
let tray: Tray | null = null;

export interface TrayHandlers {
  onOpen: () => void;
  onViewSchedules: () => void;
  onTogglePause: () => void;
  onQuit: () => void;
  isPaused: () => boolean;
  activeCount: () => number;
}

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icons', 'tray.png')
    : join(app.getAppPath(), 'assets', 'icons', 'tray.png');
}

let handlersRef: TrayHandlers | null = null;

export function createTray(handlers: TrayHandlers): void {
  handlersRef = handlers;
  tray = new Tray(nativeImage.createFromPath(trayIconPath()));
  refreshTray();
  tray.on('click', handlers.onOpen);
}

/** Rebuild the menu + tooltip to reflect the current paused/active state. */
export function refreshTray(): void {
  if (!tray || !handlersRef) return;
  const h = handlersRef;
  const paused = h.isPaused();
  const count = h.activeCount();

  tray.setToolTip(`LifeOS — ${count} active reminder${count === 1 ? '' : 's'}${paused ? ' (paused)' : ''}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open LifeOS', click: h.onOpen },
      { label: 'View Active Schedules', click: h.onViewSchedules },
      { type: 'separator' },
      { label: paused ? 'Resume Reminders' : 'Pause Reminders', click: h.onTogglePause },
      { type: 'separator' },
      {
        label: paused ? `${count} active · paused` : `${count} active reminder${count === 1 ? '' : 's'}`,
        enabled: false,
      },
      { type: 'separator' },
      { label: 'Quit LifeOS', click: h.onQuit },
    ]),
  );
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
  handlersRef = null;
}
