# 02 — Assumption Challenge and Recommendations

> **Purpose:** The brief contains several technical directions stated as "current direction". Two of them are falsified by current evidence, and three more are load-bearing assumptions that will silently break the build if unexamined. This document challenges them with citations and gives a decision for each.
>
> **Label key** (per brief §29): `VERIFIED FACT` · `ASSUMPTION` · `RISK` · `RECOMMENDATION` · `MVP DECISION` · `FUTURE OPTION`

---

## Summary table

| # | Assumption in the brief | Verdict | Action |
| --- | --- | --- | --- |
| A1 | "Use Vosk as the default local/offline STT engine" | ❌ **Falsified** | Replace with `sherpa-onnx`. Keep the provider interface. |
| A2 | "Use Windows native TTS or Windows SAPI" | ⚠️ **Half right** | Use `speechSynthesis`; SAPI is the *fallback*, not the default. Gated by a spike. |
| A3 | "Create a timer for the nearest reminder" | ❌ **Falsified** | A single `setTimeout` is incorrect. Use a persisted `next_fire_at` + 30 s reconcile tick. |
| A4 | "Use iCalendar RRULE-compatible recurrence storage" via the `rrule` lib | ⚠️ **Store the string, skip the library** | `rrule` is stale and has a `tzid` bug. Hand-roll weekly with Luxon. |
| A5 | "SQLite" (implicitly `better-sqlite3`) | ⚠️ **Better option exists** | Spike `node:sqlite` (built into Electron). Falls back to better-sqlite3. |
| A6 | "Do not rely on browser speech recognition… unless tested" | ✅ **Correct, and it fails the test** | Web Speech API is *broken* in Electron. Eliminated. |
| A7 | Electron over Tauri/Flutter | ✅ **Correct** | Confirmed. Not re-litigated. See `05`. |
| A8 | "7 days is enough" | ⚠️ **Only with a backstop** | Build the typed-text path first. Voice is the slip risk. |
| A9 | Day-1 spikes run in `npm run dev` | ❌ **Dangerous** | Notification/tray/TTS spikes must run against a **packaged** build. |
| A10 | "Chrono-node + custom rules" handles recurrence | ⚠️ **Chrono does not do recurrence at all** | An explicit keyword layer must be built. |
| A11 | Confirmation card can show "Tomorrow" | ⚠️ **Ambiguous** | Must show the resolved absolute datetime. |
| A12 | The MP3 asset exists | ❌ **It does not** | `yogi-song.mp3` must be sourced (royalty-free) before Day 5. |

---

## A1 — "Use Vosk as the default STT engine" — **FALSIFIED**

This is the single largest deviation from the literal brief. The brief anticipated it: *"If Vosk packaging is too difficult or recognition quality is poor, recommend a fallback architecture."* The evidence is that it is not merely difficult — the published package **cannot install on the developer's runtime**.

### Evidence

- `VERIFIED FACT` — The official `vosk` npm package is at **0.3.39, last published roughly four years ago**. (https://www.npmjs.com/package/vosk)
- `VERIFIED FACT` — `vosk` depends on **`ffi-napi`**, which is itself **unmaintained** (4.0.3, last published ~5 years ago) and **does not build or run on Node ≥ 18.7**, and breaks under **Electron 22+**. (https://github.com/alphacep/vosk-api/issues/1613, https://github.com/alphacep/vosk-api/issues/1962, https://github.com/node-ffi-napi/node-ffi-napi/issues/238)
- `VERIFIED FACT` — A request for native Electron support (alphacep/vosk-api#598) remains unresolved. Windows build failures are widespread: issues #1227, #1249, #1600.
- `VERIFIED FACT` — The developer's environment is **Node 24.11.1**; Electron 43 bundles **Node 24**. Both are far past the ffi-napi ceiling.

### Verdict

`RISK (critical)` — Following the brief literally means Day 1 is spent fighting a dead FFI binding, and the most likely outcome is that STT does not work at all by Day 7.

### Recommendation

`RECOMMENDATION` — Adopt **`sherpa-onnx`** (`sherpa-onnx-node`) as the default local STT provider.

- `VERIFIED FACT` — `sherpa-onnx` npm **1.13.4, published within days of this research** — actively maintained. (https://www.npmjs.com/package/sherpa-onnx)
- `VERIFIED FACT` — It is an **N-API node-addon, not ffi-napi**. Official docs state you *"don't need to pre-install anything including a C/C++ compiler, Python, or CMake"*, and on Windows the DLLs live inside `node_modules` and are found automatically. (https://k2-fsa.github.io/sherpa/onnx/javascript-api/index.html)
- `VERIFIED FACT` — It ships **streaming Zipformer transducer** models that perform genuine incremental decoding — i.e. real word-by-word partials, which is exactly what §11 of the brief ("Live Voice Transcript Experience") requires. Vosk's partials are no better.
- `VERIFIED FACT` — Models are permissively licensed and bundleable in the installer.

### `MVP DECISION`

```text
SpeechService (interface, exactly as the brief specifies)
├── SherpaOnnxSpeechService   ← implemented in MVP  (was: VoskSpeechService)
├── TransformersJsSpeechService ← fallback A, stubbed
├── OpenAISpeechService       ← future, stubbed
└── DeepgramSpeechService     ← future, stubbed
```

The **architecture in the brief is preserved unchanged.** Only the concrete default provider swaps. If the developer still wants Vosk specifically (for its grammar-restricted command mode, which genuinely helps a fixed command vocabulary), use the community fork **`vosk-koffi`** — it replaces `ffi-napi` with `koffi` (maintained, ships prebuilts) and explicitly targets Node 18.7+/Electron on Windows. `RISK (medium)` — single maintainer, ~1 year since last publish.

### Fallback ladder (pre-decided, so Day 1 never stalls)

| Rank | Provider | Native build? | Partials | Offline | Risk |
| --- | --- | --- | --- | --- | --- |
| 1 | **sherpa-onnx** | Prebuilt N-API, no toolchain | True streaming | ✅ | **Low** |
| 2 | transformers.js (Whisper-base ONNX, renderer) | **None at all** | Pseudo, 1–3 s | ✅ | Low install / medium latency |
| 3 | vosk-koffi | Prebuilt koffi | True streaming | ✅ | Medium (solo maintainer) |
| 4 | Deepgram Nova-3 / OpenAI realtime | None | True streaming | ❌ | Low tech / cost + network |
| — | ~~`vosk` npm~~ | ffi-napi, won't install | — | — | **Eliminated** |
| — | ~~Web Speech API~~ | — | — | — | **Eliminated (A6)** |

> Note the architectural gift: ranks 1 and 3 share the *identical* renderer→main audio pipe. Build the pipe once and the engine is swappable. Rank 2 needs **no** IPC audio pipe at all — that is its one large advantage, and the reason it is the fallback rather than something further down.

---

## A2 — "Use Windows native TTS or Windows SAPI" — **HALF RIGHT**

The brief's reasoning (free, offline, fast, no model download, good enough) is sound. Its *implementation* suggestion is the worse of the two options — and it collides with the brief's own safety rules.

### Evidence

- `VERIFIED FACT` — `window.speechSynthesis` in an Electron renderer on Windows is backed by the OS TTS engine (Chromium's `tts_win.cc`). It is **fully offline** — no network. (https://github.com/electron/electron/pull/14070)
- `VERIFIED FACT` — `getVoices()` is asynchronously populated and commonly returns `[]` on the first synchronous call. **The only reliable pattern is to wait for the `voiceschanged` event.** (electron#22844, electron#11585)
- `VERIFIED FACT` — `System.Speech.Synthesis` exists in **Windows PowerShell 5.1 only**, not PowerShell 6/7. You must spawn `powershell.exe`, never `pwsh`.
- `ASSUMPTION (well supported)` — Chromium exposes modern WinRT/OneCore voices; the PowerShell/SAPI5 path sees only the older desktop voices (David/Zira/Hazel). speechSynthesis therefore sounds *better*.

### The wrinkle that decides it

`RISK (high)` — **Chromium throttles hidden renderers.** The reminder must speak while the window is hidden in the tray. `backgroundThrottling: false` is documented to disable timer throttling, but it is **buggy specifically for the `hide()` case on Windows**: electron#31016 ("Disabling backgroundThrottling not working with hide() on Windows"), #20974, #9567, #50250, #42378.

So neither option is a slam dunk:

| | speechSynthesis (renderer) | PowerShell SAPI (main) |
| --- | --- | --- |
| Offline | ✅ | ✅ |
| Cost | ₹0 | ₹0 |
| Voice quality | Better (WinRT voices) | Older SAPI5 voices |
| Works while in tray | **⚠️ Must be proven** | ✅ Immune to throttling |
| Latency | Instant | ~1–2 s cold spawn |
| Collides with safety policy | No | **Arguably** |

### On the safety collision

The brief says Yogi must never *"Run PowerShell commands based on user voice input"* and never *"Run scripts from AI responses."* Read precisely, those forbid **user- or LLM-controlled command construction**. A hardcoded, constant, app-authored script invoked with a fixed argv array — where the reminder text is passed as **data over stdin**, never interpolated into the command string — is a categorically different thing.

That said: `RECOMMENDATION` — prefer `speechSynthesis` precisely so this argument never has to be had.

### `MVP DECISION`

```text
Primary:  speechSynthesis, hosted in a dedicated always-alive hidden BrowserWindow
          ({ show: false, webPreferences: { backgroundThrottling: false } }),
          gated on the `voiceschanged` event, commanded by the main process over IPC.

Gate:     SPIKE-3 must prove it speaks while the app sits in the tray for 10 minutes.

Fallback: main-process spawn('powershell.exe',
            ['-NoProfile','-NonInteractive','-Command', CONSTANT_SCRIPT])
          with reminder text written to stdin. Never interpolated. Allowlisted and
          documented in 11-electron-security-architecture.md §7.
```

The `TTSService` interface from the brief is preserved:

```text
TTSService
├── WebSpeechTTSService    ← implemented in MVP (was: WindowsTTSService)
├── SapiTTSService         ← implemented as fallback
├── PiperTTSService        ← future
├── ElevenLabsTTSService   ← future
└── OpenAITTSService       ← future
```

### Options eliminated

- `VERIFIED FACT` — **`edge-tts` is not offline.** It connects to Microsoft Edge's **online** TTS WebSocket endpoint. Using it as a default would silently break the privacy-first promise. **Disqualified.**
- `VERIFIED FACT` — **Piper** is genuinely offline and higher quality, but each voice is a tens-of-MB ONNX file plus an espeak-ng phonemizer, with no first-class Node wrapper. It violates the brief's own "no additional model download" criterion. `FUTURE OPTION` — v0.3.
- `VERIFIED FACT` — ElevenLabs ≈ $0.10 / 1k chars; OpenAI `tts-1` = $15 / 1M chars. Cloud, paid. `FUTURE OPTION`.

---

## A3 — "Calculate the nearest upcoming reminder / Create a timer for the nearest reminder" — **FALSIFIED**

The brief's §15 scheduler description implies one `setTimeout` aimed at the nearest reminder. This is a correctness bug, not a style preference.

### Evidence

- `VERIFIED FACT` — `setTimeout`'s delay is coerced to a **signed 32-bit integer: max 2,147,483,647 ms ≈ 24.8 days**. Exceeding the maximum causes the delay to be **set to 1**, so the callback **fires almost immediately**. (https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout, https://nodejs.org/api/timers.html)
  → *"Remind me on 25 December"* naively scheduled with one `setTimeout` would fire **right now**.
- `VERIFIED FACT` — Across Windows sleep/hibernate, a timer's clock **pauses**. On resume it fires *late* — at `originalDelay + timeAsleep` — not at the correct wall-clock moment. There are also documented cases of timers **never firing** across sleep/wake. (nodejs/node#6763, #13168, #38108)
- `VERIFIED FACT` — Electron's `powerMonitor` emits `suspend`, `resume`, `lock-screen`, `unlock-screen`, all supported on Windows. (https://www.electronjs.org/docs/api/power-monitor)

### `MVP DECISION` — wall-clock-authoritative scheduler

```ts
// Source of truth is the PERSISTED next_fire_at column, never an in-memory timer.
const TICK_MS = 30_000;

app.whenReady().then(reconcile);              // startup catch-up (app was closed)
setInterval(reconcile, TICK_MS);              // self-healing backstop
powerMonitor.on('resume', reconcile);         // corrects the sleep-lateness bug
powerMonitor.on('unlock-screen', reconcile);
```

An optional short `setTimeout` may be used *only* for second-accuracy on the single imminent reminder, and only when the delay is under ~24 days. The interval tick remains the backstop. This sidesteps both the 32-bit cap and the sleep anomalies. Worst-case lateness becomes the tick interval (≤ 30 s), which satisfies NFR-3.

`RISK (accepted)` — reminders are accurate to ±30 s, not ±1 s. For a human reminders app this is invisible. Documented in `23-known-limitations.md`.

---

## A4 — "Use iCalendar RRULE-compatible recurrence storage" — **STORE THE STRING, SKIP THE LIBRARY**

The brief's instinct is right (RRULE is the correct interchange format). The obvious library is not.

- `VERIFIED FACT` — `rrule` npm is at **2.8.1, published ~2023, with no release in over 12 months**.
- `VERIFIED FACT` — Setting a `tzid` **breaks `after()` and `all()`** on versions after 2.7.2. (jkbrzt/rrule#608)
- `VERIFIED FACT` — RRule returns "floating" zero-offset dates that *"are always meant to be interpreted as dates in your local timezone"* — you must convert yourself. Chrome returns dates with an offset while other engines return zero-offset, so behaviour differs between Electron's renderer and main.

`RISK` — Importing a stale library with a known timezone bug, to compute a rule as simple as *"every Monday at 7 AM"*, is a bad trade. The MVP supports exactly two frequencies.

### `MVP DECISION`

- **Store** the RRULE string in the `recurrence_rule` column (`FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0`) — for interop, forward-compat, and because the brief asks for it.
- **Compute** the next occurrence with ~15 lines of Luxon, which is DST-correct by construction.
- `FUTURE OPTION` — adopt **`rrule-temporal`** (RFC-5545 + RFC-7529, built on the Temporal API, DST-correct) when arbitrary rules (monthly-by-position, COUNT, EXDATE) are needed.

```ts
import { DateTime } from 'luxon';
function nextWeekly(weekday: number, hour: number, minute: number, zone: string, from = DateTime.now().setZone(zone)) {
  let d = from.set({ weekday, hour, minute, second: 0, millisecond: 0 });
  if (d <= from) d = d.plus({ weeks: 1 });
  return d;   // Luxon handles the DST arithmetic
}
```

---

## A5 — "SQLite" — **A BETTER OPTION MAY REMOVE THE ENTIRE NATIVE-MODULE PROBLEM**

The brief says SQLite without naming a binding. The reflexive choice is `better-sqlite3`, a native module requiring an ABI rebuild.

- `VERIFIED FACT` — `node:sqlite` no longer requires `--experimental-sqlite` as of **Node 22.13.0 / 23.4.0**; it is a Release Candidate (stability 1.2) with on-disk file DBs, ACID transactions, and a synchronous `DatabaseSync` API. (https://nodejs.org/api/sqlite.html)
- `VERIFIED FACT` — Electron 43 bundles **Node 24**, which is past that gate. The module is compiled into Electron's Node.
- `ASSUMPTION (strongly grounded, not doc-confirmed)` — Therefore `require('node:sqlite')` should work **flag-free in the Electron 43 main process**. No authoritative doc states this explicitly. **SPIKE-1 must verify empirically.**
- `VERIFIED FACT` — If it doesn't: `better-sqlite3` **12.11.2 does ship Electron prebuilds**, including `...-electron-v133-win32-x64.tar.gz` across ABI v121→v136+. This contradicts stale 2022-era advice. The path is `postinstall: electron-builder install-app-deps` + `asarUnpack`.

### `MVP DECISION`

```text
1. node:sqlite         ← 30-minute spike. If green, ship it.
                          Removes: native rebuild, VS Build Tools, Python,
                          asarUnpack, and an entire class of packaging failure.
2. better-sqlite3      ← proven fallback. Prebuilds exist. Richer API.
3. node-sqlite3-wasm   ← if both disappoint. Durable file writes, no compile, slower.
✗  sql.js              ← DISQUALIFIED. In-memory only; persistence means exporting the
                          whole DB and rewriting the file. A crash between exports loses
                          reminders. Unacceptable for this product.
```

`RISK (low)` — `node:sqlite` is an RC API; minor breaking changes are possible when Electron jumps Node majors. Mitigation: pin the Electron major, and keep the repository's data-access behind a `Database` interface so swapping bindings is a one-file change.

---

## A6 — "Do not rely on browser speech recognition" — **CORRECT, AND IT FAILS OUTRIGHT**

The brief hedges. The evidence does not.

- `VERIFIED FACT` — `webkitSpeechRecognition` in Electron throws a **`network` error**. Electron ships **no Google Speech API key** and cannot use one via `process.env.GOOGLE_API_KEY`. Confirmed still failing in March 2025 in both dev and packaged builds. (electron#46143, #7749, #24278)

`MVP DECISION` — **Eliminated.** Not a fallback, not an option. Do not spend an hour discovering this.

---

## A7 — Electron over Tauri and Flutter — **CONFIRMED, NOT RE-LITIGATED**

The brief's reasoning holds. Detail in `05-framework-decision.md`. Summary: the developer has JavaScript experience and 7 days; Tauri would force Rust for every main-process concern (SQLite, scheduler, tray, TTS, the STT audio pipe), and Flutter would force Dart plus FFI plugin work for the same. Electron's larger binary is a cost the brief has explicitly accepted (`Working polished MVP in 7 days > smallest app size`).

---

## A8 — "A polished MVP in 7 days" — **ACHIEVABLE ONLY WITH A BACKSTOP**

`RISK (high)` — The brief's Day-1 loads six spikes (project setup, security, SQLite, microphone, STT, TTS) into one day, and places the natural-language parser on Day 3 and the scheduler on Day 5. If STT consumes Day 1 and half of Day 2 — the single most likely outcome — the core loop is not proven until Day 5, leaving no recovery room.

The scheduling *pipeline* and the *speech* are independent. Voice is an input adapter. Building it first inverts the risk.

### `RECOMMENDATION` — invert the order

> **Build the entire `intent → confirm → schedule → trigger` pipeline on typed text input first.** Layer voice on top once it demonstrably works.

Consequences:

1. The 23-point Definition of Done is demonstrable from **Day 4**, with typed input, even if voice never lands.
2. STT becomes a *bounded, cancellable* work item with a pre-decided fallback ladder (A1), rather than a dependency the whole product waits on.
3. The parser — the highest-value, most-testable, most-differentiating component — gets built while the developer is freshest, and is unit-testable without a microphone.

This is reflected in `19-seven-day-roadmap.md`, which resequences the brief's suggested order and states the reasoning. The brief invited exactly this: *"Claude must challenge this sequence if a better order is safer."*

`MVP DECISION` — **SPIKE-0 (typed text → parse → confirm → persist → tick → notify) runs before any voice work.** It is the definition of "the product exists".

---

## A9 — Spikes can be validated in `npm run dev` — **DANGEROUS**

`RISK (high)` — Three of the riskiest behaviours are **packaging-dependent** and behave differently under `npm run dev`:

- `VERIFIED FACT` — Windows toasts require a Start Menu shortcut carrying an AppUserModelID. When packaged by NSIS, Electron sets this automatically. **Unpackaged, you must call `app.setAppUserModelId(...)` yourself or toasts silently fail.**
- `VERIFIED FACT` — The Tray garbage-collection bug (a `Tray` held in function scope) manifests as *"works in dev, icon vanishes after ~10 s in the packaged app."*
- `RISK` — Hidden-renderer throttling behaviour (A2) differs between a dev window and a packaged, tray-resident app.

`MVP DECISION` — **SPIKE-3 (TTS in tray), SPIKE-4 (notifications + tray) and SPIKE-5 (packaging) must be exercised against a packaged build on Day 1.** Produce an installer on Day 1, not Day 7. This is the single change most likely to prevent a Day-7 disaster.

---

## A10 — "Chrono-node for date and time parsing" handles the commands — **PARTIALLY**

- `VERIFIED FACT` — chrono-node **2.9.1** (released 2026-05-06), actively maintained, 100% TypeScript.
- `VERIFIED FACT` — chrono **does not parse recurrence at all.** Its README says so explicitly. Given `every Monday at 7 AM`, it extracts `Monday` and `7 AM` and silently ignores `every`. A recurrence keyword layer must be built before chrono runs.
- `VERIFIED FACT` — Without `{ forwardDate: true }`, parsing `"Friday"` on a Saturday resolves to **last Friday** — a reminder in the past.
- `VERIFIED FACT` — chrono exposes `result.start.isCertain(component)`, which distinguishes values the **user actually said** (`knownValues`) from values chrono **defaulted** (`impliedValues`).

That last fact is the mechanism that makes the brief's entire §10 Ambiguity Handling table implementable:

```ts
const [r] = chrono.parse('next Friday', refDate, { forwardDate: true });
r.start.isCertain('hour');      // false → user gave a date but NO time → ASK
r.start.isCertain('meridiem');  // false → "at 6" → ASK AM or PM
```

`MVP DECISION` — Ambiguity is detected structurally via `isCertain()`, not by regex-guessing. Never auto-assign an ambiguous meridiem: a wrong-half-of-day reminder is worse than a question. Full design in `08-smart-scheduling-architecture.md`.

---

## A11 — The confirmation card may show "Tomorrow" — **INSUFFICIENT**

The brief's §11 example card reads `When: Tomorrow, 9:00 AM`. The brief also says, correctly, *"The user must always see the exact interpreted date and time before confirming."* These conflict.

`MVP DECISION` — The **When** row always renders two lines:

```text
When
Tomorrow — Saturday, 11 July 2026, 9:00 AM
in 15 hours 20 minutes
```

The absolute form is what was stored. The relative form is the sanity check. Both, always. A user who is about to trust a machine with their memory deserves to see what the machine actually wrote down.

---

## A12 — The bundled MP3 exists — **IT DOES NOT**

`RISK (low, but blocking on Day 5)` — The repository is empty. The "sing" demo requires `assets/audio/yogi-song.mp3`, and the brief never says where it comes from.

`MVP DECISION` — Source a **royalty-free, redistributable** track before Day 5 and record its licence in `assets/audio/LICENSE.md` and the repo README. Acceptable sources: a CC0 track (e.g. Pixabay Music, Incompetech with attribution), or something the developer records themselves. Keep it **under 15 seconds and under 500 KB** — it is a demo flourish, not a music player. Do **not** ship a copyrighted song in a public GitHub Release.

---

## Assumptions that must be validated before coding

These are the things this plan cannot prove from a desk. Each has a spike, a binary pass/fail, and a pre-decided fallback. See `19-seven-day-roadmap.md` Day 1.

| # | Assumption | Spike | If it fails |
| --- | --- | --- | --- |
| V1 | `node:sqlite` works flag-free in Electron 43 main | SPIKE-1 (60 m) | `better-sqlite3` + `install-app-deps` + `asarUnpack` |
| V2 | `sherpa-onnx` installs with no toolchain and streams partials < 500 ms | SPIKE-2 (180 m) | transformers.js Whisper in renderer (accept 1–3 s partials) |
| V3 | `speechSynthesis` speaks from a hidden window while in tray | SPIKE-3 (60 m, **packaged**) | PowerShell SAPI via stdin |
| V4 | Toasts fire from the tray; tray icon survives packaging | SPIKE-4 (30 m, **packaged**) | `electron-windows-notifications` |
| V5 | `electron-builder` produces NSIS + portable, installs **without admin** | SPIKE-5 (45 m) | portable-only release |
| V6 | AudioWorklet 48k→16k PCM16 resampling is correct | Inside SPIKE-2 | Bench against a known WAV before blaming the model |
| V7 | The developer's Windows exposes usable TTS voices | Inside SPIKE-3 | Enumerate voices at runtime on both paths |

> **The most important sentence in this document:** if V2 and V3 both fail, LifeOS still ships — typed input, notifications, and a silent reminder modal. That is why SPIKE-0 comes first. Everything else is an upgrade to a product that already works.

---

## What this document did *not* change

For the avoidance of doubt, the following from the brief are **accepted without modification**:

- Local-first, privacy-first, no backend, no account, no telemetry.
- The mandatory confirmation gate; the LLM may never create, edit, delete or trigger a reminder.
- All the hard safety prohibitions in §3 of the brief (no admin, no registry, no drivers, no Task Scheduler, no shell from user input, no code execution from LLM output).
- Electron + React + TypeScript + Vite + SQLite + Node.
- Windows 10/11 only; GitHub Releases distribution; ₹0 operating cost; OpenAI optional and off by default.
- The `SpeechService` / `TTSService` / `ResearchProvider` provider-interface architecture.
- The UI vocabulary rule: "Active Schedules", never "Cron Jobs".
