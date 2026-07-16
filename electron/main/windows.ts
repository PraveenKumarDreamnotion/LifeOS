import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

/**
 * Secure defaults (11 §3). Every one of these is already the Electron default;
 * they are written out explicitly so that turning one off is a visible act.
 */
export const secureDefaults: Electron.WebPreferences = {
  contextIsolation: true, // default since Electron 12 — never disable
  nodeIntegration: false, // default since Electron 5  — never enable
  sandbox: true, // default since Electron 20 — never disable
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false, // <webview> is a remote-code-execution vector
  spellcheck: false, // Chromium's spellchecker downloads dictionaries from Google's CDN
};

const preloadPath = join(__dirname, '../preload/index.js');

export let mainWindow: BrowserWindow | null = null;
export let audioWindow: BrowserWindow | null = null;
export let launcherWindow: BrowserWindow | null = null;

// Self-heal must not become a spin loop. If the audio renderer dies repeatedly,
// stop recreating it and fall back to notification-only reminders — the reminder
// path never depends on this window (13 §10).
const AUDIO_MAX_RESTARTS = 3;
const AUDIO_RESTART_WINDOW_MS = 60_000;
let audioRestarts: number[] = [];
export let audioDisabled = false;

/** `startHidden` = create the window but stay in the tray (a launch-at-login start). It still
 *  loads + attaches its handlers, so opening it later from the tray shows it instantly. */
export function createMainWindow(startHidden = false): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    show: false, // show on 'ready-to-show' — no white flash
    autoHideMenuBar: true,
    webPreferences: { ...secureDefaults, preload: preloadPath },
  });

  if (!startHidden) mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // NB: window-open handling lives in installNavigationLocks() (session.ts), which
  // applies to EVERY webContents with an exact-match external allowlist. Do NOT add a
  // per-window setWindowOpenHandler here — the last handler wins, and a permissive one
  // would silently override the allowlist. shell.openExternal(userUrl) is an RCE
  // primitive on Windows (11 §4).

  loadRenderer(mainWindow, 'index.html');
  return mainWindow;
}

/**
 * The hidden audio window (07 §2.2, 13 §4).
 *
 * speechSynthesis and <audio> are renderer APIs, but a reminder must speak while the
 * main window is hidden in the tray. Chromium throttles hidden renderers, and
 * backgroundThrottling:false is documented as buggy for the hide() case on Windows
 * (electron#31016). SPIKE-3 exists to measure whether this actually works.
 *
 * This window is created before the main window and outlives it. It is never shown.
 */
export function createAudioWindow(): BrowserWindow {
  audioWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      ...secureDefaults,
      preload: join(__dirname, '../preload/audio.js'),
      backgroundThrottling: false, // necessary, NOT sufficient — see SPIKE-3
    },
  });

  loadRenderer(audioWindow, 'audio-host.html');

  // Self-healing with a cap. A reminder must not depend on this window's health,
  // and a crashing renderer must not spin the main process.
  audioWindow.webContents.on('render-process-gone', (_e, details) => {
    audioWindow = null;
    if (audioDisabled) return;

    const now = Date.now();
    audioRestarts = audioRestarts.filter((t) => now - t < AUDIO_RESTART_WINDOW_MS);
    audioRestarts.push(now);

    if (audioRestarts.length > AUDIO_MAX_RESTARTS) {
      audioDisabled = true;
      console.error(
        `[audio] audio window died (${details.reason}) ${audioRestarts.length}x in ` +
          `${AUDIO_RESTART_WINDOW_MS / 1000}s — disabling spoken reminders. ` +
          `Notifications continue unaffected.`,
      );
      return;
    }

    console.error(`[audio] audio window died (${details.reason}); recreating (${audioRestarts.length}/${AUDIO_MAX_RESTARTS})`);
    // Small delay so an immediate re-crash cannot tight-loop.
    setTimeout(() => {
      if (!audioDisabled) createAudioWindow();
    }, 1_000);
  });

  return audioWindow;
}

export const POPUP_WIDTH = 384;
export const POPUP_HEIGHT = 440; // fixed height; the conversation scrolls internally, composer stays put
const POPUP_MARGIN = 16;

/**
 * The always-on-top reminder popup (55 §2). A frameless, taskbar-less window shown INACTIVE (so it
 * never steals focus from the app the user is in) at the bottom-right of the display the cursor is
 * on. A clone of the audio-window pattern, so it inherits the secure defaults + the shared session's
 * CSP / api.openai.com allowlist (55 §2.9). Reused across the queue: content is swapped via POPUP_SHOW.
 */
export let popupWindow: BrowserWindow | null = null;

export function createReminderPopupWindow(): BrowserWindow {
  popupWindow = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    show: false, // shown via showInactive() by the coordinator — never steals focus
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true, // it is a toast, not an app window
    alwaysOnTop: true,
    focusable: true, // the text input (P2) must accept keys when the user clicks in
    webPreferences: { ...secureDefaults, preload: join(__dirname, '../preload/popup.js') },
  });
  // 'screen-saver' is the highest practical level on Windows — over other apps + most fullscreen.
  popupWindow.setAlwaysOnTop(true, 'screen-saver');

  popupWindow.on('closed', () => {
    popupWindow = null;
  });

  loadRenderer(popupWindow, 'popup.html');
  return popupWindow;
}

/** Pin the popup to the bottom-right of the display under the cursor, above the taskbar (workArea). */
export function positionPopupBottomRight(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const [w, h] = win.getSize();
  const width = w ?? POPUP_WIDTH;
  const height = h ?? POPUP_HEIGHT;
  win.setBounds({
    x: workArea.x + workArea.width - width - POPUP_MARGIN,
    y: workArea.y + workArea.height - height - POPUP_MARGIN,
    width,
    height,
  });
}

// Sized and positioned to match the reminder popup so the launcher feels like the same surface.
export const LAUNCHER_WIDTH = POPUP_WIDTH; // 384 — same width as the reminder panel
export const LAUNCHER_HEIGHT = 380; // room for the compact conversation + the voice composer (≈ the popup)
const LAUNCHER_MARGIN = POPUP_MARGIN; // 16px from the screen edges, like the popup

export function createLauncherWindow(): BrowserWindow {
  launcherWindow = new BrowserWindow({
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      ...secureDefaults,
      preload: join(__dirname, '../preload/launcher.js'),
      backgroundThrottling: false,
    },
  });

  launcherWindow.setAlwaysOnTop(true, 'screen-saver');
  launcherWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  launcherWindow.setIgnoreMouseEvents(false);
  launcherWindow.on('closed', () => {
    launcherWindow = null;
  });

  loadRenderer(launcherWindow, 'launcher.html');
  return launcherWindow;
}

/** Pin the launcher to the bottom-right of the display under the cursor — a clone of the popup's
 *  positioning (called on every show, so it tracks multi-monitor / taskbar changes). */
export function positionLauncherBottomRight(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const [w, h] = win.getSize();
  const width = w ?? LAUNCHER_WIDTH;
  const height = h ?? LAUNCHER_HEIGHT;
  win.setBounds({
    x: workArea.x + workArea.width - width - LAUNCHER_MARGIN,
    y: workArea.y + workArea.height - height - LAUNCHER_MARGIN,
    width,
    height,
  });
}

function loadRenderer(win: BrowserWindow, htmlFile: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(`${devUrl}/${htmlFile}`);
  } else {
    void win.loadFile(join(__dirname, `../renderer/${htmlFile}`));
  }
}
