# 04 — Technology Research

> **Research date:** July 2026. All version numbers verified at that time.
> **Label key:** `VERIFIED FACT` (with source) · `ASSUMPTION` · `RISK` · `RECOMMENDATION` · `MVP DECISION` · `FUTURE OPTION`
>
> This document is the consolidated research index. Deep dives live in `05`–`11`.

---

## 1. Locked stack

| Layer | Choice | Version (Jul 2026) | Confidence |
| --- | --- | --- | --- |
| Shell | Electron | **43.1.0** | `VERIFIED FACT` |
| Chromium | (bundled) | 150 | `VERIFIED FACT` |
| Node (in Electron) | (bundled) | 24 | `VERIFIED FACT` |
| UI | React + TypeScript | 19.x / 5.x | `MVP DECISION` |
| Build | electron-vite (Vite 6) | latest | `MVP DECISION` |
| Database | `node:sqlite` → `better-sqlite3` | built-in / 12.11.2 | `ASSUMPTION` → spike |
| Date parsing | chrono-node | **2.9.1** (2026-05-06) | `VERIFIED FACT` |
| Date math | Luxon | 3.x | `MVP DECISION` |
| Recurrence | hand-rolled + RRULE string | — | `MVP DECISION` |
| STT | sherpa-onnx | **1.13.4** | `VERIFIED FACT` |
| TTS | Web Speech `speechSynthesis` | built-in | `MVP DECISION` |
| Validation | Zod | 3.x | `MVP DECISION` |
| Packaging | electron-builder | latest | `MVP DECISION` |
| Tests | Vitest + Playwright(Electron) | latest | `MVP DECISION` |

## 2. Electron

- `VERIFIED FACT` — Latest stable major is **Electron 43** (released 2026-06-30; latest patch 43.1.0, 2026-07-07). Ships Chromium M150 and Node 24. (https://endoflife.date/electron)
- `VERIFIED FACT` — Electron supports **only the latest three majors**: 43, 42 (EOL 2026-10-20), 41 (EOL 2026-08-25). A new major lands every 8 weeks.
- `RISK (low)` — An 8-week major cadence means the pinned Electron falls out of support in ~6 months. For a hobby MVP this is acceptable; for a maintained product, budget a quarterly bump.
- `MVP DECISION` — Pin **Electron 43.x** exactly (`"electron": "43.1.0"`, not `^43`). Native-module prebuild availability is keyed to the Electron ABI; a silent minor bump can break `better-sqlite3` if that fallback is in play.

### Secure defaults (all already default — do not disable)

| Setting | Default since | `VERIFIED FACT` |
| --- | --- | --- |
| `nodeIntegration: false` | Electron 5 | https://www.electronjs.org/docs/latest/tutorial/security |
| `contextIsolation: true` | Electron 12 | ibid. |
| `sandbox: true` | Electron 20 | https://www.electronjs.org/docs/latest/tutorial/sandbox |

- `VERIFIED FACT` — **`sandbox: true` is fully compatible with `contextBridge` + `ipcRenderer`.** This is the intended architecture; sandboxing does not break the bridge.
- `VERIFIED FACT` — A sandboxed preload gets only a polyfilled Node subset. It can `require` **only** `electron` (and only `contextBridge`, `crashReporter`, `ipcRenderer`, `nativeImage`, `webFrame`, `webUtils`), plus `events`, `timers`, `url`. **No `fs`, no `path`, no `child_process`, no npm packages, no native addons.**
- `VERIFIED FACT` — A sandboxed preload **cannot use CommonJS `require` to split itself across files**. It must be bundled into one file.
  → `MVP DECISION` — use **electron-vite**, which bundles the preload by default. This is not a preference; it is a requirement of the sandbox.

## 3. Database

Full analysis in `10-local-database-and-memory-architecture.md`.

- `VERIFIED FACT` — `node:sqlite` dropped its `--experimental-sqlite` flag requirement at **Node 22.13.0 / 23.4.0**. It is a Release Candidate (stability 1.2) with on-disk databases, ACID transactions, and a synchronous `DatabaseSync` API. (https://nodejs.org/api/sqlite.html)
- `ASSUMPTION (strongly grounded)` — Since Electron 43 bundles Node 24, `require('node:sqlite')` should work flag-free in the main process. No official Electron doc states this. **SPIKE-1 verifies it.**
- `VERIFIED FACT` — Historically, Electron 35 (Node 22.9) exposed `node:sqlite` only behind the flag, and passing `--experimental-sqlite` via `appendSwitch` did **not** work. (electron/electron#45532 — closed.) That pain was specific to the pre-22.13 Node bundled then.
- `VERIFIED FACT` — `better-sqlite3` **12.11.2** (2026-07-03) ships **137 release assets including Electron prebuilds** for win32-x64 across ABI v121→v136+. Stale advice that "better-sqlite3 has no Electron prebuilds" is wrong as of 2026.
- `RISK (medium)` — Prebuild coverage lags the newest Electron by weeks (see WiseLibs/better-sqlite3#1384). Mitigation: pin to an Electron major that already has a matching prebuild asset, or keep VS Build Tools installed so the source-build fallback works.
- `VERIFIED FACT` — Native `.node` binaries **cannot be loaded from inside a compressed asar** and must be unpacked: `"asarUnpack": ["**/node_modules/better-sqlite3/**"]`. `node:sqlite` needs no `asarUnpack` — it lives inside the Electron binary.
- `VERIFIED FACT` — `app.getPath('userData')` = appData + app name, preferring `productName`. On Windows → `C:\Users\<user>\AppData\Roaming\<productName>`. Call it only after `ready`.
- `MVP DECISION` — Ranked: `node:sqlite` → `better-sqlite3` → `node-sqlite3-wasm`. **`sql.js` is disqualified**: it is in-memory only; persistence means exporting and rewriting the whole file, so a crash between exports loses reminders.

## 4. Natural-language date parsing

Full analysis in `08-smart-scheduling-architecture.md`.

- `VERIFIED FACT` — chrono-node **2.9.1**, released 2026-05-06, 66 releases, actively maintained, 100% TypeScript with bundled types. Locale sub-imports need `moduleResolution: node16`/`nodeNext`.
- `VERIFIED FACT` — `chrono.parse()` returns `ParsedResult[]` with `.start` / `.end` of type `ParsedComponents`. `ParsedComponents.isCertain(component)` returns `true` only when the value came from the user's input (`knownValues`) rather than being defaulted (`impliedValues`). Components: `year, month, day, hour, minute, second, meridiem, weekday, timezoneOffset`.
- `VERIFIED FACT` — `{ forwardDate: true }` forces results into the future. Without it, `"Friday"` parsed on a Saturday yields **last** Friday.
- `VERIFIED FACT` — chrono **does not parse recurrence**. `"every Monday at 7 AM"` yields Monday + 7 AM; `every` is ignored.
- `VERIFIED FACT` — chrono does not guess AM/PM for `"at 6"`; it leaves `meridiem` uncertain and implies hour 6 (i.e. 6 AM).
- `RISK (high)` — Silently defaulting an ambiguous meridiem produces wrong-half-of-day reminders. `MVP DECISION` — always clarify, never assign.

## 5. Recurrence

- `VERIFIED FACT` — `rrule` npm **2.8.1**, published ~2023, no release in 12+ months. ~1.7M weekly downloads; Snyk maintenance "Sustainable" but effectively dormant.
- `VERIFIED FACT` — Setting `tzid` breaks `after()` / `all()` on versions after 2.7.2 (jkbrzt/rrule#608). RRule returns floating zero-offset dates meant to be read as local; **Chrome returns offset dates while other engines return zero-offset** — so behaviour differs between Electron's renderer and its main process.
- `MVP DECISION` — Store the RRULE **string** for interop; compute next-run with Luxon. Do not take the dependency.
- `FUTURE OPTION` — `rrule-temporal` (RFC-5545 + RFC-7529 on the Temporal API, DST-correct by construction) when arbitrary rules are needed.

## 6. Date/time library

- `VERIFIED FACT` — **Temporal is enabled by default in Node 26** (V8 14.6) and shipped in **Chrome 144**. It is ES2026. In **Node 24 it remains behind `--harmony-temporal`.**
- `ASSUMPTION` — Electron 43 ships Chromium 150 (> 144), so Temporal is likely available in the **renderer**; the **main** process runs Node 24, where it is flagged. Mixing would mean two different date APIs across the IPC boundary.
- `MVP DECISION` — Use **Luxon** everywhere. Mature, IANA-zone aware, DST-correct, immutable, first-class TypeScript, identical in main and renderer. It removes a runtime gamble for ~20 KB.
- `FUTURE OPTION` — Migrate to Temporal once the pinned Electron's main process has it unflagged.
- `MVP DECISION` — **Storage rule:** one-shot reminders store an absolute **UTC epoch-ms** instant. Recurring reminders store the **rule + IANA zone name** and recompute in that zone, so DST transitions stay correct even if the machine's offset changes.

## 7. Timers and system sleep

- `VERIFIED FACT` — `setTimeout` delay is coerced to a signed 32-bit int → **max 2,147,483,647 ms (~24.8 days)**. Exceeding it (or `< 1`, or `NaN`) sets the delay to 1, so the callback **fires almost immediately**. (MDN; Node timers docs)
- `VERIFIED FACT` — A timer's clock **pauses during machine sleep**. On resume it fires late (`originalDelay + timeAsleep`), not at the intended wall-clock moment. (nodejs/node#6763)
- `RISK (high)` — There are reported cases of timers **failing to fire at all** across sleep/wake. (nodejs/node#13168, #38108) **Never trust `setTimeout` alone for due-time correctness.**
- `VERIFIED FACT` — Electron `powerMonitor` emits `suspend`, `resume` (Windows + macOS) and `lock-screen`, `unlock-screen` (Windows + macOS). `shutdown` is **not** Windows. (https://www.electronjs.org/docs/api/power-monitor)
- `MVP DECISION` — Persisted `next_fire_at` is the source of truth; a 30 s `setInterval` reconcile is the engine; `powerMonitor` resume and app-start both trigger the same reconcile. Timers are an optimisation, never the contract.

## 8. Speech-to-text

Full analysis in `06-speech-to-text-research.md`. Headlines:

- `VERIFIED FACT` — The official `vosk` npm (0.3.39) was last published ~4 years ago and depends on **`ffi-napi`**, which is unmaintained and **does not build/run on Node ≥ 18.7**, breaking under **Electron 22+**. (alphacep/vosk-api#1613, #1962; node-ffi-napi#238)
- `VERIFIED FACT` — **`webkitSpeechRecognition` is broken in Electron** — throws `network`; Electron ships no Google Speech key. Still failing as of March 2025. (electron#46143, #7749, #24278)
- `VERIFIED FACT` — **`sherpa-onnx` 1.13.4** is actively maintained, is an **N-API addon (not ffi)**, requires **no C/C++ compiler, Python or CMake**, finds its Windows DLLs inside `node_modules` automatically, and ships **streaming Zipformer** models with true incremental partials. (https://k2-fsa.github.io/sherpa/onnx/javascript-api/index.html)
- `VERIFIED FACT` — Recognisers expect **16 kHz mono PCM16**. `getUserMedia` yields Float32 at 48 kHz. Capture via **AudioWorkletProcessor** (`ScriptProcessorNode` is deprecated), downsample, convert to Int16.
- `RISK (medium)` — The browser may ignore a `sampleRate: 16000` constraint. **Always resample defensively.**
- `MVP DECISION` — sherpa-onnx primary; transformers.js Whisper fallback; vosk-koffi third; Deepgram/OpenAI as opt-in online tiers.

## 9. Text-to-speech

Full analysis in `07-text-to-speech-research.md`. Headlines:

- `VERIFIED FACT` — `speechSynthesis` in an Electron renderer on Windows is backed by the OS engine (`tts_win.cc`) and is **fully offline**. No flag required.
- `VERIFIED FACT` — `getVoices()` frequently returns `[]` on the first synchronous call. **Wait for `voiceschanged`.** (electron#22844, #11585)
- `RISK (high)` — Chromium throttles hidden renderers. `backgroundThrottling: false` is **buggy specifically for `hide()` on Windows**. (electron#31016, #20974, #9567, #50250, #42378) A reminder spoken from a throttled hidden renderer is unreliable → **SPIKE-3, packaged.**
- `VERIFIED FACT` — `System.Speech.Synthesis` exists in **Windows PowerShell 5.1 only** (not pwsh 6/7). Offline; immune to throttling; ~1–2 s cold-spawn; older SAPI5 voices.
- `VERIFIED FACT` — **`edge-tts` is cloud**, not offline — it opens a WebSocket to Microsoft's endpoint. Disqualified as a privacy-first default.
- `VERIFIED FACT` — Piper is offline and good, but each voice is a tens-of-MB ONNX plus an espeak-ng phonemizer, with no first-class Node wrapper. Violates "no additional model download". `FUTURE OPTION`.
- `VERIFIED FACT` — ElevenLabs ≈ $0.10/1k chars (Flash $0.05); OpenAI `tts-1` $15/1M chars, `tts-1-hd` $30/1M. `FUTURE OPTION`.

## 10. Notifications, tray, audio

- `VERIFIED FACT` — `Notification` is a **main-process** API. It fires regardless of window state, including hidden-to-tray. Prefer it over the renderer's HTML5 `Notification`. (https://www.electronjs.org/docs/latest/tutorial/notifications)
- `VERIFIED FACT` — Windows toasts need a Start Menu shortcut carrying an **AppUserModelID**. Packaged (NSIS/Squirrel) installs set it automatically. **Unpackaged, you must call `app.setAppUserModelId(process.execPath)` or toasts silently fail.**
- `RISK (medium)` — The **portable exe has no Start Menu shortcut**, so toast identity may be generic. Set the AUMID explicitly and test the portable artifact separately.
- `VERIFIED FACT` — `Notification` emits `click`; wire it to `win.show()` + `win.focus()`. It is not automatic.
- `VERIFIED FACT` — Toast **buttons / `toastXml`** require userland `electron-windows-notifications`. Built-in `actions` are limited on Windows. `FUTURE OPTION`.
- `VERIFIED FACT` — **Tray GC bug:** a `Tray` held in function scope is garbage-collected; the icon works in dev then **vanishes after ~10 s in packaged builds**. Keep a module-scope reference. (electron-react-boilerplate#2705)
- `VERIFIED FACT` — Use a **multi-resolution `.ico`** (16×16 @72dpi + 32×32 @144dpi). At 125% scaling Windows 11 wants 20×20 and upscales a lone 16×16 badly. (electron#2248, #33044)
- `VERIFIED FACT` — Chromium's autoplay policy rejects `audio.play()` without a user gesture. Fix before window creation: `app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')`. (electron#14323, #13525)
- `RISK (medium)` — `sound-play` reportedly shells out to PowerShell's MediaPlayer on Windows; the npm page returned 403 during research so this is **unverified**. Prefer a native N-API player if a main-process audio path is needed.
- `MVP DECISION` — One **always-alive hidden `BrowserWindow`** acts as the single audio output device for both `speechSynthesis` and `<audio>` MP3 playback, commanded from main over IPC. See `13-system-architecture.md` §4.

## 11. Packaging and distribution

Full analysis in `21-release-and-github-plan.md`.

- `ASSUMPTION (community consensus)` — For a solo dev wanting NSIS + portable on Windows, **electron-builder** is lower-friction than electron-forge: one dependency, NSIS is the default target, portable is first-class.
- `VERIFIED FACT` — electron-builder Windows targets: `nsis`, `nsis-web`, `portable`, `appx`, `msi`, `squirrel`. (https://www.electron.build/win/)
- `VERIFIED FACT` — Portable builds expose `PORTABLE_EXECUTABLE_FILE`, `PORTABLE_EXECUTABLE_DIR`, `PORTABLE_EXECUTABLE_APP_FILENAME`.
- `VERIFIED FACT` — With `GH_TOKEN` or `GITHUB_TOKEN` in the environment, publish defaults to `[{provider:"github"}]` and creates a **draft** release. (https://www.electron.build/publish.html)
- `VERIFIED FACT` — GitHub Releases limits: **2 GiB per asset**, up to **1000 assets per release**. Electron installers run 80–200 MB, so this only matters if large models are bundled.
- `VERIFIED FACT` — An **unsigned** NSIS installer downloaded from GitHub carries the Mark-of-the-Web and triggers **"Windows protected your PC … Publisher: Unknown"**, requiring *More info → Run anyway*. (electron-builder#8764)
- `VERIFIED FACT` — Cheapest legitimate signing in 2026 is **Azure Trusted Signing ≈ $9.99/month (~$120/yr)**. `RISK` — eligibility historically requires an organisation ≥ 3 years old; it issues short-lived certs. Traditional OV ≈ $200–400/yr (SmartScreen reputation accrues over downloads); EV ≈ $400–900/yr (**instant** SmartScreen trust, hardware token).
- `VERIFIED FACT` — Since **2026-03-01**, maximum code-signing certificate validity dropped to **~460 days (~15 months)** industry-wide.
- `VERIFIED FACT` — SmartScreen reputation is per-signing-identity **and** per-file-hash, and accrues as clean installs accumulate. EV bypasses the wait.
- `MVP DECISION` — **Ship unsigned.** ₹0 is a hard constraint. Document the warning prominently in the README with a screenshot and step-by-step "More info → Run anyway", and publish **SHA-256 checksums** so users can verify integrity independently.

## 12. Content Security Policy

- `VERIFIED FACT` — CSP is item #7 on Electron's security checklist. Set it via a `<meta>` tag or, more robustly, `session.defaultSession.webRequest.onHeadersReceived` (the header wins).
- `MVP DECISION` — Production CSP:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self' data:;
connect-src 'self';
object-src 'none';
base-uri 'self';
frame-src 'none'
```

- `ASSUMPTION` — `style-src` needs `'unsafe-inline'` because React and most UI libraries inject inline `style=` attributes at runtime. Inline **styles** are low-risk compared with inline **scripts**; `script-src 'self'` with no `unsafe-inline`/`unsafe-eval` is what actually blocks injected code.
- `RISK` — Dev mode needs a looser policy: `'unsafe-inline'` (and often `'unsafe-eval'` for React Fast Refresh) plus `ws://localhost:5173` in `connect-src` for the HMR socket. **Gate by environment.** Never ship the dev CSP.
- `MVP DECISION` — When AI Assist is enabled, `connect-src` gains exactly `https://api.openai.com` and nothing else.

## 13. Optional AI provider costs

Full analysis in `09-openai-ai-assist-architecture.md`.

| Service | Price (2026) | Notes |
| --- | --- | --- |
| OpenAI `gpt-4o-mini-transcribe` | $0.003/min | STT |
| OpenAI `gpt-4o-transcribe` | $0.006/min | STT |
| OpenAI realtime transcription | ~$0.017/min | STT, true streaming deltas |
| Deepgram Nova-3 streaming | $0.0077/min PAYG | Best cloud interim results; $200 free credit ≈ 433 h |
| OpenAI `tts-1` | $15 / 1M chars | TTS |
| ElevenLabs Multilingual v2 | $0.10 / 1k chars | TTS |

- `MVP DECISION` — All of these are **off by default**, require the user's own API key, and are billed to the user's own account. LifeOS never proxies. The only one wired in the MVP is the **text-only** AI Assist parse fallback, whose cost is fractions of a rupee per month.

## 14. Aggregate risk ranking

| Rank | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | STT integration consumes multiple days | High | High | Typed-first (SPIKE-0); pre-decided fallback ladder |
| 2 | TTS silent in tray (renderer throttling) | Medium | High | SPIKE-3 **packaged**; SAPI fallback ready |
| 3 | Toasts/tray behave differently packaged | Medium | High | SPIKE-4 **packaged** on Day 1 |
| 4 | Native module rebuild hell | Medium | Medium | `node:sqlite` first; prebuilds exist for the fallback |
| 5 | Scheduler misfires (32-bit cap, sleep) | High if naive | High | Persisted `next_fire_at` + reconcile tick |
| 6 | Ambiguous meridiem → wrong-half-of-day | High if naive | Medium | `isCertain('meridiem')` → clarify, never assign |
| 7 | SmartScreen scares users off | Certain | Medium | Documented + checksums; signing is a `FUTURE OPTION` |
| 8 | 7 days is not enough | Medium | High | Tiered scope with a pre-decided cut order |

Full register with owners and triggers: `25-risk-register.md`.
