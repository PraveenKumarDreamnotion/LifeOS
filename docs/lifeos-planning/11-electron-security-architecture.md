# 11 — Electron Security Architecture

> **Threat model first.** Security decisions without a threat model are cargo cult. LifeOS is a local, single-user, offline desktop app with no server and no accounts. That shapes what matters.

---

## 1. Threat model

### What we are defending

| Asset | Sensitivity |
| --- | --- |
| Reminders, including health and family ones | High — reveals medical conditions, relationships, routines |
| Reminder history | Medium — reveals daily patterns and presence |
| The OpenAI API key | High — a stolen key bills the user |
| Memories (future) | **Highest** — explicitly health/family facts |
| The user's operating system | **Highest** — the brief's §3 is unambiguous |

### Who we are defending against

| Adversary | In scope? | Rationale |
| --- | --- | --- |
| **A malicious or compromised LLM response** | ✅ **Primary** | AI Assist introduces attacker-controlled text into the app. This is the one genuinely novel attack surface. |
| **A malicious npm dependency** | ✅ | 400+ transitive packages run with Node privileges in main. |
| **Prompt injection via speech** | ✅ | The user's own speech reaches the LLM. A recorded phrase could try to steer it. |
| **A copied `%APPDATA%\LifeOS` folder** | ✅ | Laptop resale, backup leak, shared machine. |
| **Malware already running as the user** | ❌ | Out of scope. It can read `%APPDATA%`, key-log, and inject into our process. No desktop app defends against this; claiming otherwise is dishonest. |
| **Remote network attacker** | ❌ mostly | The app listens on no port and, by default, opens no socket. |
| **The user themselves** | ❌ | It is their machine. We defend them from *us*, not from themselves. |

### The one thing we must never do

Restating the brief's §3 as the security objective:

> **LifeOS must be incapable of harming the operating system, by construction, not by intention.**

"By construction" means: the code paths that could do harm **do not exist**, rather than existing and being guarded.

## 2. Process model

```text
┌── MAIN PROCESS ─────────────────────────── full Node privileges ──┐
│  SQLite · scheduler · tray · notifications · TTS fallback         │
│  API key (plaintext, in memory, at call time only)                │
│  The ONLY code that touches the filesystem or the network         │
└──────────────────┬────────────────────────────────────────────────┘
                   │  ipcMain.handle — every channel validated
┌──────────────────┴─ PRELOAD ─────────── sandboxed, bundled, ~80 LOC ──┐
│  contextBridge.exposeInMainWorld('lifeos', { … })                    │
│  Exposes ~14 named functions. Never `ipcRenderer` itself.            │
└──────────────────┬────────────────────────────────────────────────────┘
                   │  window.lifeos.*
┌──────────────────┴─ RENDERER ──── sandbox:true, no Node, CSP ──┐
│  React. Knows nothing about SQL, files, or the OS.             │
│  Hostile-input boundary: everything it sends is untrusted.     │
└────────────────────────────────────────────────────────────────┘
┌── HIDDEN AUDIO WINDOW ──── sandbox:true, backgroundThrottling:false ──┐
│  speechSynthesis + <audio>. Receives text. Sends nothing back but ACKs.│
└───────────────────────────────────────────────────────────────────────┘
```

`MVP DECISION` — **Treat the renderer as untrusted**, even though we wrote it. If a supply-chain attack lands in a React dependency, the IPC boundary is the only thing standing between it and the user's filesystem. Validate at the boundary as if the caller were an attacker, because one day it might be.

## 3. BrowserWindow configuration

```ts
// electron/main/windows.ts
const secureDefaults: Electron.WebPreferences = {
  contextIsolation: true,     // default since Electron 12 — never disable
  nodeIntegration: false,     // default since Electron 5  — never enable
  sandbox: true,              // default since Electron 20 — never disable
  webSecurity: true,          // never disable, not even "just for dev"
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false,          // <webview> is a remote-code-execution vector
  spellcheck: false,          // Chromium's spellchecker downloads dictionaries
};

mainWindow = new BrowserWindow({
  width: 1080, height: 760, minWidth: 900, minHeight: 640,
  show: false,                                // show on 'ready-to-show', no white flash
  webPreferences: { ...secureDefaults, preload: path.join(__dirname, '../preload/index.mjs') },
});

audioWindow = new BrowserWindow({
  show: false,
  webPreferences: { ...secureDefaults, preload: audioPreloadPath, backgroundThrottling: false },
});
```

`VERIFIED FACT` — `sandbox: true` is **fully compatible** with `contextBridge` + `ipcRenderer`. This is the intended architecture; sandboxing does not break the bridge. (https://www.electronjs.org/docs/latest/tutorial/sandbox)

`VERIFIED FACT` — A sandboxed preload gets only a polyfilled Node subset. Its `require` resolves **only**: `electron` (and within it only `contextBridge`, `crashReporter`, `ipcRenderer`, `nativeImage`, `webFrame`, `webUtils`), plus `events`, `timers`, `url`. **No `fs`, no `path`, no `child_process`, no npm packages, no native addons.**

`VERIFIED FACT` — A sandboxed preload **cannot use CommonJS `require` to split itself across multiple files.** It must be bundled into one.
→ `MVP DECISION` — **electron-vite** bundles the preload. This is not a build preference; it is a requirement of the sandbox.

`MVP DECISION` — `spellcheck: false`. Chromium's spellchecker fetches dictionary files from Google's CDN on first use. In an app that promises zero network traffic by default, that is a broken promise hiding in a default.

## 4. Navigation and window lockdown

An Electron app that can be navigated to a remote URL has lost. Three independent locks:

```ts
app.on('web-contents-created', (_e, contents) => {
  // 1. Refuse all navigation away from our own origin.
  contents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
  });

  // 2. Refuse to open child windows. Send external links to the real browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowlistedExternal(url)) shell.openExternal(url);   // github.com/<user>/lifeos only
    return { action: 'deny' };
  });

  // 3. Refuse <webview>.
  contents.on('will-attach-webview', event => event.preventDefault());
});
```

```ts
const EXTERNAL_ALLOWLIST = [
  'https://github.com/<user>/lifeos',
  'https://github.com/<user>/lifeos/blob/main/PRIVACY.md',
  'https://platform.openai.com/api-keys',
];
const isAllowlistedExternal = (url: string) => EXTERNAL_ALLOWLIST.includes(url);
```

`MVP DECISION` — `shell.openExternal` receives **only strings from a hardcoded allowlist**, never a URL from the renderer, the database, or an LLM. `shell.openExternal(userControlledString)` is a remote code execution primitive on Windows (`file://`, `ms-msdt:`, and friends). An exact-match allowlist, not a prefix check, not a regex.

`MVP DECISION` — Permissions are denied by default:

```ts
session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
  callback(permission === 'media');   // microphone only. Everything else: no.
});
session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
```

`MVP DECISION` — Block all network requests the app does not need, in the session itself:

```ts
session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
  const url = new URL(details.url);
  if (url.protocol === 'devtools:' || url.protocol === 'blob:' || url.protocol === 'data:') return callback({});
  if (url.origin === APP_ORIGIN) return callback({});
  if (url.origin === 'https://api.openai.com' && aiAssistIsFullyConsented()) return callback({});
  log.warn('network', `blocked ${url.origin}`);
  callback({ cancel: true });      // ← default deny
});
```

That last handler is the enforcement of the product's central promise. With AI Assist off, **the app cannot make a network request even if a dependency tries.** It is worth more than the privacy policy.

## 5. Content Security Policy

`VERIFIED FACT` — CSP is item #7 on Electron's security checklist. Setting it via `onHeadersReceived` is more robust than a `<meta>` tag because the header wins and cannot be stripped by an injected DOM node.

```ts
const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",                    // no 'unsafe-inline', no 'unsafe-eval'
  "style-src 'self' 'unsafe-inline'",     // see note
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self'",                     // the bundled MP3
  "connect-src 'self'" + (aiAssistEnabled ? ' https://api.openai.com' : ''),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",              // AudioWorklet
].join('; ');

session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
  cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP_PROD] } });
});
```

`ASSUMPTION` — `style-src` requires `'unsafe-inline'` because React and most UI libraries inject inline `style=` attributes at runtime. Inline **styles** cannot execute code; inline **scripts** can. `script-src 'self'` with neither `unsafe-inline` nor `unsafe-eval` is what actually blocks injected code, and that is the directive we hold absolutely.

`RISK (high)` — Dev mode needs `'unsafe-inline'`, often `'unsafe-eval'` (React Fast Refresh), and `ws://localhost:5173` in `connect-src` for HMR. **Gate by `app.isPackaged`.** A dev CSP shipped to production is a real, boring, common vulnerability.

```ts
const csp = app.isPackaged ? CSP_PROD : CSP_DEV;
```

`MVP DECISION` — A test asserts that the packaged build's CSP string contains neither `unsafe-eval` nor `ws:` (`18` §6).

## 6. The preload bridge

`MVP DECISION` — The preload exposes **named functions with fixed channel names**. It never exposes `ipcRenderer`, never exposes a generic `invoke(channel, ...args)`, and never accepts a channel name from the renderer.

```ts
// electron/preload/index.ts  — bundled to one file by electron-vite
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  reminders: {
    create: (input: unknown)          => ipcRenderer.invoke('reminders:create', input),
    list:   ()                        => ipcRenderer.invoke('reminders:list'),
    update: (id: string, p: unknown)  => ipcRenderer.invoke('reminders:update', id, p),
    delete: (id: string)              => ipcRenderer.invoke('reminders:delete', id),
    pause:  (id: string)              => ipcRenderer.invoke('reminders:pause', id),
    complete: (id: string)            => ipcRenderer.invoke('reminders:complete', id),
    snooze: (id: string, m: number)   => ipcRenderer.invoke('reminders:snooze', id, m),
  },
  speech: {
    start: ()                         => ipcRenderer.invoke('speech:start'),
    stop:  ()                         => ipcRenderer.invoke('speech:stop'),
    pushAudio: (pcm: ArrayBuffer)     => ipcRenderer.send('speech:audio', pcm),
    onPartial: (cb: (t: string) => void) => subscribe('speech:partial', cb),
    onFinal:   (cb: (t: string) => void) => subscribe('speech:final', cb),
  },
  settings: {
    get:    ()                        => ipcRenderer.invoke('settings:get'),
    update: (patch: unknown)          => ipcRenderer.invoke('settings:update', patch),
    setApiKey: (key: string)          => ipcRenderer.invoke('settings:setApiKey', key),
    resetLocalData: ()                => ipcRenderer.invoke('settings:resetLocalData'),  // NO ARGS
  },
  parse: (text: string)               => ipcRenderer.invoke('parse:reminder', text),
};

// Wrap listeners so the renderer never receives the IpcRendererEvent object,
// which carries `sender` and is a privilege-escalation handle.
function subscribe(channel: string, cb: (...a: any[]) => void) {
  const wrapped = (_e: unknown, ...args: any[]) => cb(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('lifeos', Object.freeze(api));
```

Rules, each of which has been a real CVE in some Electron app:

| Rule | Why |
| --- | --- |
| Never `exposeInMainWorld('ipc', ipcRenderer)` | Gives the renderer every channel, including internal ones. |
| Never expose `invoke(channel, args)` generically | Same, one indirection later. |
| Strip the `IpcRendererEvent` from listener callbacks | `event.sender` lets the renderer reach `webContents`. |
| `Object.freeze` the exposed object | Stops a compromised renderer from monkey-patching the bridge for other scripts. |
| `resetLocalData()` takes **no arguments** | A path argument would be a filesystem-delete primitive handed to the renderer. |
| No function returns a raw Node object | Buffers, streams, and `fs.Stats` all leak capability. Return plain JSON. |

## 7. The `child_process` prohibition

The brief's §3 is a list of things Yogi must never do. Most are enforced by absence. This one needs a rule, because §7 of `07-text-to-speech-research.md` proposes exactly one exception.

`MVP DECISION` — **`child_process` may be imported in exactly one file:** `electron/tts/sapi-tts-service.ts`, and only if SPIKE-3 forces the SAPI fallback.

```jsonc
// .eslintrc.json
{
  "rules": {
    "no-restricted-imports": ["error", {
      "paths": [
        { "name": "child_process",      "message": "Forbidden. See 11-electron-security-architecture.md §7." },
        { "name": "node:child_process", "message": "Forbidden. See 11-electron-security-architecture.md §7." }
      ]
    }],
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error"
  },
  "overrides": [
    {
      "files": ["electron/tts/sapi-tts-service.ts"],
      "rules": { "no-restricted-imports": "off" }
    },
    {
      "files": ["core/**/*.ts"],
      "rules": { "no-restricted-imports": ["error", { "patterns": ["electron", "electron/*", "node:*", "fs", "path", "os"] }] }
    }
  ]
}
```

The last override is the one that keeps `05-framework-decision.md` §6.2's portability promise honest.

And the guarantees inside that one permitted file (from `07` §3.2):

1. The command string is a **module constant**. No interpolation. A unit test asserts `!SCRIPT.includes('${')`.
2. Arguments passed as an **array**. Never `shell: true`.
3. Reminder text arrives on **stdin**, treated by PowerShell as a string, never as source.
4. Text is length-capped and stripped of control characters.
5. `-NoProfile -NonInteractive`, `windowsHide: true`.

`MVP DECISION` — There is **no other process spawn, no `shell.openPath`, no `shell.openExternal` with dynamic input, no `exec`, no `execFile`, no `spawnSync`** anywhere in LifeOS. And if SPIKE-3 passes, the file above is never written and `child_process` is banned outright.

## 8. IPC handler discipline

Every `ipcMain.handle` follows the same four steps. No exceptions, including "trivial" handlers.

```ts
// electron/main/ipc/reminders.ts
ipcMain.handle('reminders:create', async (event, raw) => {
  // 1. AUTHENTICATE the sender. A compromised or unexpected frame must not reach the DB.
  assertSenderIsOurWindow(event.senderFrame);

  // 2. VALIDATE. Zod, .strict(), never a cast.
  const input = CreateReminderInput.parse(raw);        // throws → surfaces as a rejected promise

  // 3. AUTHORIZE. Business rules the schema cannot express.
  if (input.scheduledAtUtcMs <= Date.now()) throw new ValidationError('date_in_past');

  // 4. ACT, then return a plain serialisable object.
  return toDto(reminderRepo.create(input));
});

function assertSenderIsOurWindow(frame: Electron.WebFrameMain | null) {
  if (!frame) throw new SecurityError('no_frame');
  const url = new URL(frame.url);
  if (url.origin !== APP_ORIGIN) throw new SecurityError('bad_origin');
}
```

`MVP DECISION` — **`raw` is `unknown`, always.** A handler signature of `(event, input: CreateReminderInput)` is a lie the type system will happily tell you. TypeScript types do not survive the IPC boundary; only Zod does.

`MVP DECISION` — Errors returned across IPC are **sanitised**. A stack trace tells a compromised renderer the app's filesystem layout.

```ts
function toIpcError(e: unknown): { code: string; message: string } {
  if (e instanceof ValidationError) return { code: e.code, message: e.userMessage };
  log.error('ipc', String(e));                       // full detail stays in the local log
  return { code: 'internal_error', message: 'Something went wrong.' };
}
```

Full channel inventory with schemas: `16-api-and-ipc-contracts.md`.

## 9. SQL injection

`MVP DECISION` — Parameterized queries everywhere. One documented exception (`PRAGMA user_version = ${v}`, where `v` is a loop index over a hardcoded array, because SQLite forbids bound parameters in PRAGMA).

Test, run against a real database:

```ts
it('stores injection attempts as literal text', () => {
  const evil = `'); DROP TABLE reminders;--`;
  const r = repo.create({ ...valid, title: evil });
  expect(repo.get(r.id)!.title).toBe(evil);
  expect(db.all(`SELECT name FROM sqlite_master WHERE name='reminders'`)).toHaveLength(1);
});
```

`MVP DECISION` — The `CHECK` constraints in `10` §5 are the last line, after Zod and after the IPC validator. Defence in depth means the same rule expressed three times in three languages.

## 10. Secrets

`MVP DECISION` — The OpenAI key is encrypted with **`safeStorage`** (DPAPI on Windows, scoped to the Windows user account).

- It **never crosses IPC.** `settings:get` returns `hasApiKey: boolean`.
- It is read in main, at call time, handed to `fetch`, and dropped.
- It is never logged, never in an error message, never in `app_logs`.
- `RISK (medium)` — `safeStorage.isEncryptionAvailable()` can be `false`. Then **refuse to persist it**; offer session-only memory storage. Never write a plaintext key to disk.
- `RISK (low, disclosed)` — DPAPI ciphertext is readable by any process running as the same Windows user. That defends a copied `%APPDATA%` folder, not malware already running as you. Stated plainly in `22-privacy-policy-and-disclosures.md`; do not overclaim.

## 11. Supply chain

`RISK (medium)` — 400+ transitive dependencies execute with Node privileges in main. This is the most likely way LifeOS gets compromised, and it is largely outside our control.

`MVP DECISION`

- `npm ci` with a committed `package-lock.json`. Never `npm install` in CI.
- `npm audit --production --audit-level=high` in CI; a high finding fails the build.
- `"ignore-scripts": true` in `.npmrc`, with an explicit allowlist for the two packages that legitimately need a postinstall (`electron`, and `better-sqlite3` if the fallback is taken).
- Pin `electron` to an exact patch. Renovate/Dependabot proposes bumps; a human reads them.
- The **default-deny network handler** in §4 is the real mitigation: a malicious dependency in the renderer cannot exfiltrate anything, because the session blocks every origin that is not `self`.
- `RISK (accepted)` — a malicious dependency in **main** can bypass all of this. Nothing in an Electron app prevents that. Keep the main-process dependency count small and read what you add.

## 12. Logging

`MVP DECISION` — Logs are local, in SQLite, level-gated, and scrubbed.

Never logged: API keys, full reminder titles at `debug` in production, transcripts sent to the LLM (log a hash), memory facts, file paths outside `userData`.

```ts
const REDACT = [
  [/sk-[A-Za-z0-9_-]{20,}/g, 'sk-***REDACTED***'],
  [/Bearer\s+\S+/gi,          'Bearer ***REDACTED***'],
] as const;
```

`MVP DECISION` — **No crash reporter, no telemetry, no analytics, no Sentry.** The brief says the app must not upload user data by default, and a crash report contains memory contents. `Open logs folder` in Settings lets a user attach a log to a GitHub issue **deliberately**, having read it.

## 13. Packaging

`MVP DECISION`

```jsonc
"nsis": {
  "oneClick": false,
  "perMachine": false,      // ← per-user install. NO UAC prompt. NO admin. Ever.
  "allowToChangeInstallationDirectory": true
}
```

`perMachine: false` is the single line that enforces the brief's first safety requirement. A per-user install writes to `%LOCALAPPDATA%\Programs\`, touches no system directory, and needs no elevation.

`MVP DECISION` — No `requestedExecutionLevel: requireAdministrator`, no registry writes beyond the uninstall entry NSIS creates under `HKCU`, no services, no drivers, no scheduled tasks, no startup entry.

`VERIFIED FACT` — An unsigned installer triggers SmartScreen (`04` §11). That is an *availability* problem, not a security one. Mitigate with documentation and published SHA-256 checksums; do not mitigate by asking users to disable SmartScreen.

## 14. Verification checklist

Run before the Day-7 release. Each line maps to a requirement in `01` §6.

```text
□ SEC-1  Installer completes with no UAC prompt on a standard user account.
□ SEC-1  Process Explorer shows LifeOS.exe running non-elevated.
□ SEC-2  Procmon during a full session: zero writes outside %APPDATA%\LifeOS\
         and %LOCALAPPDATA%\Programs\LifeOS\.
□ SEC-3  Procmon: zero registry writes outside HKCU\…\Uninstall\LifeOS.
□ SEC-3  No entry in Task Scheduler. No new service. No new driver.
□ SEC-4  `grep -rE "child_process|exec\(|spawn\(|eval\(|new Function"` returns only
         the one allowlisted TTS file (or nothing, if SPIKE-3 passed).
□ SEC-5  Feed the LLM validator a response with intent "delete_all" → rejected.
□ SEC-6  DevTools console in the packaged app: `typeof require` → "undefined".
□ SEC-6  `window.lifeos.ipcRenderer` → undefined. `Object.isFrozen(window.lifeos)` → true.
□ SEC-7  Every ipcMain.handle body begins with a Zod .parse(). Reviewed by hand.
□ SEC-8  Reset with a symlinked userData → UnsafeResetPathError, nothing deleted.
□ SEC-9  Packaged CSP contains no 'unsafe-eval' and no 'ws:'.
□ SEC-10 Wireshark with AI Assist OFF, 30-minute session incl. a fired reminder:
         zero outbound packets.                       ← the promise, measured
□        Wireshark with AI Assist ON: traffic to api.openai.com only.
□        Uninstall leaves %APPDATA%\LifeOS\ intact (user data is not the installer's
         to delete) and removes everything under Programs\LifeOS\.
```

`MVP DECISION` — The Wireshark check is the one that matters most, because it is the only one that tests the *product's actual claim* rather than an implementation detail. Record it for the demo video.
