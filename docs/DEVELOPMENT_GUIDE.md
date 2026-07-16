# Development Guide

> **Home:** [docs/README.md](./README.md) · **Related:** [PROJECT_STRUCTURE](./PROJECT_STRUCTURE.md) · [IPC](./IPC.md) · [TESTING](./TESTING.md)

Everything a contributor needs to build, debug, and extend LifeOS.

## 1. Setup

```bash
npm install
npm run fetch:model     # ~68 MB offline STT model → resources/models/stt/ (required for voice)
```

## 2. Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | electron-vite dev (HMR renderer; **main is NOT hot-reloaded**) |
| `npm run build` | build main + preload + renderer to `out/` |
| `npm start` | preview the built app |
| `npm run build:win` | build + electron-builder → NSIS installer + portable exe in `release/` |
| `npm run typecheck` | `tsc --noEmit` for node + web projects |
| `npm run lint` | ESLint (flat config) |
| `npm test` / `test:unit` / `test:integration` | Vitest |
| `npm run fetch:model` | download the STT model |

## 3. The one dev gotcha you must know

**`npm run dev` reloads the renderer but not the main process.** Changes to anything under `electron/` (engine, scheduler, router, IPC handlers, providers) require a **full quit and relaunch** (or `npm run build && npm start`). Symptom if you forget: the UI updates but backend behavior is stale (this caused a multi-session debugging detour — see the changelog).

Other environment notes:
- **Single-instance lock**: only one LifeOS runs at a time. If a stale instance holds the lock, a new launch focuses it and exits. Killing `electron.exe` during dev can affect other Electron apps.
- **Process name**: dev shows `electron` in Task Manager; only a packaged build shows `LifeOS`.

## 4. Debugging

- **Renderer**: DevTools (allowed by CSP in dev). React 19.
- **Main**: `console.log` lands in the terminal running `npm run dev`; the `Logger` writes to the `app_logs` table (level-gated, redacted) and the console. The reminder pipeline emits `[reminder] parsed/created/fired/delivered` traces; the engine logs `answer: intent=… wantsSearch=…` and `web_search: …`.
- **Boot check**: `npm start` and watch for `startup: database ready …` and `launcher: shortcut Alt+Shift+Space` with no error lines.
- **DB**: open `%APPDATA%\lifeos\lifeos.db` (dev) with any SQLite browser (it's WAL; check the `-wal` sidecar).

## 5. Coding conventions

- **Language**: TypeScript, strict (`noUncheckedIndexedAccess`), `moduleResolution: bundler`, `noEmit`.
- **`core/` purity (load-bearing)**: `core/` must **not** import `electron`, `fs`, `path`, `os`, `child_process`, `node:*`, `../electron/*`, or `../src/*` — only `luxon`, `chrono-node`, `zod`. Enforced by `eslint.config.js`. This keeps the framework reversible.
- **No shell**: `child_process`/`node:child_process` are banned (`FORBIDDEN_SHELL`); `eval`/`new Function` banned. Exceptions: `scripts/` and two allowlisted files.
- **`fs` deletion**: only `electron/services/reset-service.ts` may import `fs`, and only behind `assertSafeResetPath`.
- **No Prettier config** — formatting is conveyed via ESLint only; match surrounding style.
- **`no-explicit-any`** is a warning (some remain in the launcher dev-mock).

## 6. Adding a feature — the patterns

### Add an IPC channel
1. Add the constant to `core/types/channels.ts` (`CH`). Keep `channels.ts` dependency-free.
2. Add a Zod input schema / DTO in `core/types/ipc.ts` (use `.strict()`).
3. Register a handler in the relevant `electron/main/ipc/*.ts`, wrapped in `guard()`; call `Schema.parse(raw)`.
4. Expose a named function in `electron/preload/index.ts` (and update `src/types/window.d.ts` + `src/lib/ipc.ts`). **Do not** import `channels.ts` in the popup/launcher/audio preloads — inline the string (the no-chunk invariant).
5. Broadcast changes with `fanout()` if other windows care.

### Add a database table/column
1. Append a migration constant in `electron/database/migrations.ts` and add it to `MIGRATIONS` (forward-only: no DROP). Bump happens automatically via `user_version`.
2. Add a repository method (parameterized queries only) and a row→domain mapper in `rows.ts`.
3. Add a migration test in `tests/integration/migrations.test.ts`.

### Add a cloud provider / capability
1. Define the seam in `core/<domain>/<domain>-provider.ts` (a pure interface).
2. Implement it in `electron/providers/`.
3. Add a factory to `electron/providers/registry.ts` that gates on enable + key + consent (+ a fallback).
4. Wire it into the consumer with a live-rebind closure (re-created per operation).

### Add a conversation intent / tool
1. It's already in the closed taxonomy (`core/conversation/intent.ts`) — add an executor if it's an action intent.
2. For a **tool** (like search), gate it behind a seam, pair the model flag with a **reply-text heuristic backstop** and logging (gpt-4o-mini's flags are unreliable). See [WEB_SEARCH](./WEB_SEARCH.md).

### Add a reminder capability (AI-task)
1. Extend `core/parsing/classify-execution.ts` to emit the capability.
2. Handle it in `electron/reminders/reminder-executor.ts` (read-only auto-runs; writes must return `needs_confirmation`).

## 7. Testing conventions

See [TESTING](./TESTING.md). Inject the clock/providers/windows so logic is deterministic; prefer real objects on a real SQLite DB for integration; add a regression test with every fix.

## 8. Packaging & release

- `electron-builder.yml`: `appId: com.dreamnotion.lifeos`, `productName: LifeOS`, `executableName: LifeOS`. Windows targets **NSIS** (per-user, no UAC) + **portable**. The STT model + icons ship as `extraResources`; `sherpa-onnx-node` is `asarUnpack`ed (native `.node` can't load from a compressed asar). `node:sqlite` is built into Electron — no unpack.
- `npm run build:win` produces the installer + portable exe under `release/` and can publish to GitHub (owner `dreamnotion`, repo `lifeos`).
- **Auto-update** (`electron-updater`) is not wired yet, though `latest.yml` is produced — a **Planned** item.

## 9. Release checklist (recommended)

1. `npm run typecheck && npm run lint && npm test` — all green.
2. `npm run build` — confirm `out/preload/chunks` is **absent** (the sandboxed-preload invariant; currently a manual check — no automated gate).
3. `npm run build:win` — smoke-test the NSIS install + portable exe on a clean Windows VM (per-user install, no-admin, no-network-with-cloud-off, model loads from `resourcesPath`).
4. Bump `version` in `package.json`.

> The v1 (0.1.0) surface was packaged; the **full v2 surface (conversation/popup/launcher/Gmail) has not been re-packaged or fresh-VM QA'd** — this is the top release-readiness gap. See [ROADMAP](./ROADMAP.md).

## 10. Scripts folder

- `scripts/fetch-stt-model.mjs` — downloads/flattens the STT model.
- `scripts/gen-icons.mjs` — generates placeholder tray/app icons (not wired to an npm script).
