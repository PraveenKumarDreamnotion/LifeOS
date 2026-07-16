import { app, session, shell } from 'electron';

/**
 * The renderer's own origin. In dev this is the Vite server; when packaged the
 * app is loaded from file://, whose origin serialises to "null".
 */
export const APP_ORIGIN = process.env.ELECTRON_RENDERER_URL
  ? new URL(process.env.ELECTRON_RENDERER_URL).origin
  : 'null';

/**
 * Production CSP (11 §5).
 *
 * `script-src 'self'` with neither 'unsafe-inline' nor 'unsafe-eval' is what actually
 * blocks injected code. `style-src` needs 'unsafe-inline' because React injects inline
 * style attributes at runtime; inline *styles* cannot execute code, inline *scripts* can.
 */
export function buildCsp(opts: { packaged: boolean; aiAssistEnabled: boolean }): string {
  const connect = ["'self'"];
  if (opts.aiAssistEnabled) connect.push('https://api.openai.com');

  if (!opts.packaged) {
    // Dev only: Vite HMR needs eval + a websocket. NEVER ships.
    const devOrigin = process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173';
    const ws = devOrigin.replace(/^http/, 'ws');
    return [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
      "style-src 'self' 'unsafe-inline'",
      'img-src \'self\' data:',
      'font-src \'self\' data:',
      // blob: is required for the EP-4 audio:playBytes path — the hidden window plays OpenAI TTS
      // bytes as a same-origin blob: object URL (33 §3.1). worker-src blob: covers the AudioWorklet.
      "media-src 'self' blob:",
      `connect-src 'self' ${devOrigin} ${ws}`,
      "object-src 'none'",
      "base-uri 'self'",
      "frame-src 'none'",
      "worker-src 'self' blob:",
    ].join('; ');
  }

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    // blob: for the EP-4 audio:playBytes path (same-origin object URL of our own TTS bytes, 33 §3.1).
    "media-src 'self' blob:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
  ].join('; ');
}

/** Links we are willing to hand to the user's real browser. Exact match only. */
const EXTERNAL_ALLOWLIST = new Set([
  'https://github.com/dreamnotion/lifeos',
  'https://platform.openai.com/api-keys',
]);

/**
 * Everything the app is allowed to talk to. Empty by default — that is the product's
 * central privacy claim, enforced in code rather than in a policy document (22 §B1).
 */
/** Exported for the D1 session-rebind unit test (42): the allowlist flips with the predicate. */
export function isAllowedOrigin(url: URL, aiAssistEnabled: boolean): boolean {
  if (url.protocol === 'devtools:' || url.protocol === 'blob:' || url.protocol === 'data:') return true;
  if (url.protocol === 'file:') return true;
  if (url.origin === APP_ORIGIN) return true;
  if (aiAssistEnabled && url.origin === 'https://api.openai.com') return true;
  return false;
}

export function installSessionSecurity(getAiAssistEnabled: () => boolean): void {
  const ses = session.defaultSession;

  // 1. CSP as a response header. The header wins over a <meta> tag and cannot be
  //    stripped by an injected DOM node.
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          buildCsp({ packaged: app.isPackaged, aiAssistEnabled: getAiAssistEnabled() }),
        ],
      },
    });
  });

  // 2. Default-deny network. With AI Assist off, LifeOS cannot make a network request
  //    even if a dependency tries. This is worth more than the privacy policy.
  ses.webRequest.onBeforeRequest((details, callback) => {
    let url: URL;
    try {
      url = new URL(details.url);
    } catch {
      return callback({ cancel: true });
    }
    if (isAllowedOrigin(url, getAiAssistEnabled())) return callback({});
    console.warn(`[security] blocked outbound request to ${url.origin}`);
    callback({ cancel: true });
  });

  // 3. Permissions: microphone only. Everything else is denied.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
}

/** Navigation locks. An Electron app that can be navigated to a remote URL has lost. */
export function installNavigationLocks(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (event, url) => {
      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        return event.preventDefault();
      }
      if (origin !== APP_ORIGIN) {
        console.warn(`[security] blocked navigation to ${url}`);
        event.preventDefault();
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      // shell.openExternal with dynamic input is an RCE primitive on Windows
      // (file://, ms-msdt:, ...). Exact-match allowlist, not a prefix check.
      if (EXTERNAL_ALLOWLIST.has(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });

    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });
}
