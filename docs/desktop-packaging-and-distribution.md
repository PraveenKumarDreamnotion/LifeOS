# Desktop Packaging & Distribution

How LifeOS is built into an installable Windows desktop app, how to run it without
`npm run dev`, and what remains before public distribution (code signing, auto-update).

The app is packaged with **electron-builder** (config: `electron-builder.yml`). This is the
right tool and is already fully configured — no change of packaging system is needed.

---

## TL;DR — build, install, run

```sh
# Produce the installer + portable exe (writes to release/)
npm run build:win

# Artifacts land in release/:
#   LifeOS Setup 0.1.0.exe        ← the installer (double-click to install)
#   LifeOS-0.1.0-portable.exe     ← single-file portable, no install
#   win-unpacked/LifeOS.exe       ← the raw runnable app
#   latest.yml + *.blockmap       ← auto-update metadata
```

Installing (`LifeOS Setup … .exe`) is **per-user, no admin/UAC** — it installs to
`%LOCALAPPDATA%\Programs\LifeOS`, and creates a **Desktop shortcut**, a **Start Menu
shortcut**, and an **uninstall entry** (Settings → Apps). After that you launch it like any
app: Start Menu, Taskbar pin, or Desktop shortcut. **`npm run dev` is only for development —
it is never required to run the installed app.**

---

## Why `npm run dev` is NOT required in production

`electron/main/windows.ts` → `loadRenderer()` picks the UI source by environment:

- **Dev:** `ELECTRON_RENDERER_URL` is set → loads from the Vite dev server (HMR).
- **Packaged:** the var is unset → loads from `file://…/out/renderer/*.html`.

The packaged path is self-contained. `npm run dev` merely starts the Vite server the dev
build points at; the installed app bundles its UI and needs neither Node nor npm.

---

## Application identity ("LifeOS" everywhere, never "Electron")

Verified on the packaged exe (`release/win-unpacked/LifeOS.exe`, Details tab):

| Surface | Value |
|---|---|
| Executable name | `LifeOS.exe` (`win.executableName` in `electron-builder.yml`) |
| Task Manager process / Details | `LifeOS.exe`, ProductName **LifeOS**, FileDescription **LifeOS** |
| Company | **DreamNotion** (from `package.json` `author`) |
| Legal copyright | **Copyright © 2026 DreamNotion** (`copyright:` in `electron-builder.yml`) |
| Window title | **LifeOS** (`src/index.html` `<title>`) |
| Installer / shortcuts / Start Menu | **LifeOS** (`nsis.shortcutName`, `productName`) |
| Notifications | grouped under AppUserModelID `com.dreamnotion.lifeos` (`main/index.ts`) |
| Tray tooltip / menu | "LifeOS — N active reminders" (`electron/tray/tray.ts`) |

> **Dev-only caveat:** while running `npm run dev`, Task Manager shows **`electron`** (or
> `electron.exe`), because the dev harness runs `node_modules/electron/dist/electron.exe`.
> This is unavoidable and irrelevant — only the *packaged* build renames the exe. Packaged =
> `LifeOS.exe`.

---

## Icons

electron-builder derives the Windows icon from `build/icon.png` (512×512) into a multi-size
`.ico` containing **16, 24, 32, 48, 64, 128, 256** px. Tray icons are
`assets/icons/tray.png` (32×32) + `tray@2x.png` (64×64). Taskbar, title-bar, Start-Menu,
installer, and notification icons all derive from these — no per-window `icon` is needed in
packaged builds. To refresh the artwork, replace `build/icon.png` with a square PNG
(≥256×256; 1024×1024 recommended as a master) and rebuild.

---

## Project size & cleanup

Build output is large but fully regenerable and **gitignored** (`out/`, `release/`,
`*.tsbuildinfo`). A helper removes it:

```sh
npm run clean          # delete out/, release/, *.tsbuildinfo   (~760 MB freed)
npm run clean -- --all # also delete node_modules (full reset; run `npm install` after)
```

Do **not** delete `resources/models/stt/*.onnx` (~67 MB) — the offline speech model the app
loads at runtime. Long-term: keep building in CI so local `release/` never accumulates, and
consider fetching the STT model as a release asset (see `scripts/fetch-stt-model.mjs`)
instead of storing it locally.

---

## ⚠️ Code signing — DEFERRED (do this before public release)

**Current state:** the installer and exe are **unsigned** (`Get-AuthenticodeSignature` →
`NotSigned`). electron-builder logs "signing with signtool.exe", but with no certificate
configured this is a no-op.

**Consequence:** on first launch of an unsigned installer, Windows SmartScreen shows
**"Windows protected your PC … unknown publisher."** The user must click *More info → Run
anyway*. The app still installs and runs, and Windows Defender does not block it — but it
does not yet feel like a signed, professionally-distributed app. This is the single item
standing between the current build and a Notion/Spotify-grade first-run.

**To sign later (when a certificate is available):**

1. Obtain a Windows code-signing certificate:
   - **OV** (Organization Validation, ~$200–400/yr) — signs successfully; SmartScreen
     reputation still builds up over downloads.
   - **EV** (Extended Validation) — immediate SmartScreen trust, but requires a hardware
     token / cloud HSM.
2. Add to `electron-builder.yml` under `win:` (file-based cert example):
   ```yaml
   win:
     # …existing keys…
     certificateFile: path/to/cert.pfx      # or use env / a signing service
     certificatePassword: ${env.CSC_KEY_PASSWORD}
   ```
   Or set the standard env vars before `npm run build:win`:
   `CSC_LINK` (path/URL to the `.pfx`) and `CSC_KEY_PASSWORD`.
3. Rebuild and verify: `Get-AuthenticodeSignature "release\LifeOS Setup <ver>.exe"` →
   `Status: Valid`, with your organization as the signer.

**Never commit the certificate or its password.** In CI, inject them as secrets.

---

## Auto-update — configured but NOT yet wired (future)

`electron-builder.yml` already has `publish: github` and each build emits `latest.yml`, so
the *distribution* side is ready. But the app does not yet check for updates:
`electron-updater` is not a dependency and nothing calls it. To enable:

1. `npm i electron-updater`
2. In the main process (after `app.whenReady()`), call `autoUpdater.checkForUpdatesAndNotify()`.
3. Publish releases to the configured GitHub repo (signed builds strongly recommended first,
   so updates are trustworthy).

---

## Data, logs, settings, crash handling

- **User data / settings / database:** `%APPDATA%\LifeOS\lifeos.db` (SQLite; `app.getPath('userData')`).
  Secrets (API key, Gmail tokens) are encrypted with Electron `safeStorage` and never leave main.
- **Logs:** written to the SQLite log table via `electron/services/logger.ts`.
- **Single instance:** a launch while an instance is running defers to it (focuses the existing
  window) — expected behavior, enforced by `app.requestSingleInstanceLock()`.
- **Crash resilience:** the hidden audio window self-heals with a capped restart (3×/60s) and
  falls back to notification-only reminders; the reminder path never depends on it.
