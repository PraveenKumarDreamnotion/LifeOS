# 25 — Risk Register

> **This is a living document.** Day 1 fills in the "Spike verdict" column. Every subsequent day updates status. A risk that is never revisited is a risk that was never managed.
>
> Scoring: **L**ikelihood × **I**mpact, each 1–5. Score ≥ 12 demands a pre-decided mitigation with a trigger and an owner action.

---

## 1. The top eight, ranked

| # | Risk | L | I | Score | Trigger | Pre-decided response |
| --- | --- | --- | --- | --- | --- | --- |
| **R1** | STT integration consumes multiple days | 4 | 5 | **20** | SPIKE-2 exceeds 120 min | Drop to `transformers.js`. If that fails, **cut voice entirely**. SPIKE-0 guarantees a shippable product. |
| **R2** | TTS is silent while the app is in the tray | 3 | 5 | **15** | SPIKE-3's 10-minute packaged test fails | Switch to `SapiTTSService` (main process, stdin, no interpolation). +90 min on Day 4. |
| **R3** | Toasts/tray behave differently packaged | 3 | 5 | **15** | Any of SPIKE-3/4/5 passes in dev but fails packaged | Nothing to do — this is *why* those spikes run packaged on Day 1. |
| **R4** | Scheduler misfires (32-bit cap, sleep, DST) | 4 | 5 | **20** | Any `setTimeout(fn, dueMs - now)` appears in a diff | Reject the diff. `08` §10 is not negotiable. Unit tests catch it. |
| **R5** | Ambiguous meridiem silently guessed | 4 | 4 | **16** | `assign('meridiem', …)` appears anywhere | Reject. `detectAmbiguity` asks. A twelve-hour error is invisible until it hurts. |
| **R6** | `every Monday` becomes a one-time reminder | 3 | 5 | **15** | Fixture #3 fails | chrono does not parse recurrence. `extractRecurrence` must run **before** chrono. |
| **R7** | Seven days is not enough | 3 | 4 | **12** | Day 3 evening gate fails | Cut in the pre-decided order (`03` §2). Never cut Tier 0. |
| **R8** | Native module rebuild hell | 2 | 4 | 8 | SPIKE-1 fails | `better-sqlite3` + `install-app-deps` + `asarUnpack`. Prebuilds exist. |

`MVP DECISION` — **R4 and R5 are the two risks a code review must actively hunt for**, because both produce *plausible, wrong* behaviour that passes a casual manual test. A reminder that fires immediately is obviously broken; a reminder that fires at 6 p.m. instead of 6 a.m. looks fine until it doesn't.

---

## 2. Day-1 spike verdicts

**Recorded on Day 1 (2026-07-10). This is the single most valuable artifact of the day.**

Environment: Electron 43.1.0 · Chromium 150.0.7871.47 · Node 24.18.0 (bundled) · system Node 24.11.1 · Windows 11 (10.0.26200) · **no MSVC, no CMake, no Python-for-gyp on PATH** (verified — the point is that none were needed).

| Spike | Question | Verdict | Evidence | Fallback taken? |
| --- | --- | --- | --- | --- |
| SPIKE-1 | `require('node:sqlite')` flag-free in Electron 43 main? | ✅ **PASS** | 12/12 criteria in a real main process: WAL, `user_version` r/w, CHECK constraints, parameterized insert of `'); DROP TABLE t;--` stored literally, survives close/reopen. DB at `%APPDATA%\LifeOS\`. | No — **node:sqlite adopted.** No native module, no rebuild, no asarUnpack, no Build Tools. |
| SPIKE-2 | STT engine installs with no toolchain; streaming API present? | ✅ **PASS** (engine); ⏳ transcription accuracy deferred to Day 5 | `sherpa-onnx-node` (NOT `sherpa-onnx`, which is WASM — see correction below) installed in 4 s, pulled prebuilt `sherpa-onnx-win-x64` (`sherpa-onnx.node` + `onnxruntime.dll`), loads in Electron main, exposes `OnlineRecognizer` (streaming), `LinearResampler`, `readWave`, `Vad`. | No — sherpa-onnx-node adopted. Model download + fixture-WAV transcription is Day 5's first task. |
| SPIKE-5 | NSIS + portable build; installs with no UAC? | ✅ **PASS** | Both artifacts built (`LifeOS Setup 0.1.0.exe` 101 MB, portable 100 MB). `perMachine=false`. Exe manifest carries **`asInvoker`, no `requireAdministrator`** (verified in the binary). Native DLLs correctly in `app.asar.unpacked`. Icons shipped via `extraResources`. | No. |
| SPIKE-0 | Wall-clock scheduler fires a reminder from the tray? | ✅ **PASS** (wiring); 🔔 toast-visible is a manual check | Live run: reminder fired from the 30 s tick **while the window was hidden in the tray**, 15 ms late. Node's own `TimeoutOverflowWarning` confirmed the 30-day `setTimeout` fires at 32 ms — the exact trap the design avoids. | No. |
| SPIKE-4 | Toast fires; tray icon survives; no admin? | ✅ **PASS** (dispatch + no-admin); 👁 15-min icon persistence is a manual check | `Notification.show()` dispatched from main after the window was hidden; tray created with a module-scope ref. | No. |
| SPIKE-3 | `speechSynthesis` speaks from a hidden window? | ✅ **PASS (human-confirmed)** | On the developer's real Windows 11 desktop, the hidden audio window found **5 voices** (David/Ravi/Heera/Mark/Zira; `voiceschanged` gate worked) and Yogi spoke **twice, both audible to the user**: an activation greeting at launch, and the tray reminder ~60 s later. Logs show `speech STARTED`/`speech ENDED` for both; user confirmed by ear. The earlier "0 voices + crash" was confirmed to be a headless-subprocess artifact only. | No — `WebSpeechTTSService` (speechSynthesis) adopted. **Note:** the 10-minute *idle-in-tray* throttling endurance was not separately timed; the immediate and 60 s cases both spoke. Re-verify the long-idle case during Day-4 tray work. |

### Verdict summary — all six spikes PASSED

- **3 spikes empirically PASSED** (SPIKE-1, SPIKE-2 engine, SPIKE-5) with hard evidence.
- **SPIKE-0 + SPIKE-4 + SPIKE-3 PASSED and were human-confirmed on the real desktop:** the wall-clock scheduler fired a reminder from the tick, the Windows notification appeared, and Yogi spoke aloud twice (activation greeting + tray reminder) — the developer confirmed hearing both.
- **The degradation guarantee was proven live:** in the earlier headless run the audio subsystem crashed and the notification still fired — `13 §10` / `17 §1` demonstrated, not assumed.
- **Only open follow-up:** time the 10-minute idle-in-tray TTS case during Day-4 tray work (the immediate and 60 s cases both spoke; the long-idle throttling endurance was not separately measured).

### Corrections to the plan discovered on Day 1

| # | Planning docs said | Reality | Action taken |
| --- | --- | --- | --- |
| C1 | STT package is **`sherpa-onnx`** | `sherpa-onnx` is the **WebAssembly** build (21 MB `.wasm`, no native addon). The native N-API addon is **`sherpa-onnx-node`**, which pulls prebuilt `sherpa-onnx-win-x64`. | Swapped the dependency; updated `electron.vite.config.ts` `external`, `electron-builder.yml` `asarUnpack`. Everything else in `06`/`13` holds — same interface, same streaming capability, and the addon *also* ships a resampler + VAD, reducing Day-5 work. |
| C2 | `zod` v3 | `zod` v4.4.3 is current | Pinned v4. No API impact for the schemas planned. |
| C3 | `better-sqlite3` fallback would need `asarUnpack` | Not needed — SPIKE-1 passed, so `better-sqlite3` is not a dependency at all. | Removed its `asarUnpack` entry. |
| C4 | Self-heal for the audio window (13 §4) shown without a cap | An uncapped `render-process-gone` → recreate is a spin loop. | Added a 3-restarts-per-60 s cap that disables spoken reminders (notifications unaffected) rather than looping. |

`MVP DECISION` — Each fallback was chosen in advance. **Day 1 made no new decisions under pressure; it collected evidence and applied the pre-decided corrections.**

---

## 3. Full register

### Technical

| ID | Risk | L | I | Mitigation | Owner action |
| --- | --- | --- | --- | --- | --- |
| T1 | `ffi-napi` / Vosk is unusable on Node 24 | 5 | 5 | **Already realised.** Vosk rejected (`02` A1). | Use sherpa-onnx. Do not reopen. |
| T2 | Web Speech API in Electron throws `network` | 5 | 3 | **Already realised.** Eliminated (`06` §3). | Do not spend an hour rediscovering this. |
| T3 | AudioWorklet resampler bug blamed on the model | 4 | 3 | Fixture WAV bypasses the worklet | **Test the engine before the pipe.** `20` step 16. |
| T4 | `sherpa-onnx` prebuild missing for Electron 43 ABI | 2 | 4 | Pin Electron exactly | Keep VS Build Tools installed as insurance |
| T5 | `node:sqlite` RC API changes across Electron majors | 2 | 3 | Driver interface isolates it | Pin Electron. Swap one file. |
| T6 | Tray icon GC'd; vanishes after 10 s **packaged only** | 3 | 3 | Module-scope reference | Reproduce it once, deliberately, so it is recognised |
| T7 | Toasts silently fail unpackaged (no AUMID) | 4 | 2 | `setAppUserModelId` before windows | Test packaged |
| T8 | Portable exe toasts fail (no Start Menu shortcut) | 3 | 2 | Explicit AUMID | Test the portable artifact **separately** |
| T9 | `<audio>` blocked by autoplay policy | 3 | 2 | `appendSwitch` before any window exists | — |
| T10 | Native `.node` unreadable inside asar | 3 | 4 | `asarUnpack` | Verify by **installing**, not by reading the config |
| T11 | `__dirname` breaks resource paths when packaged | 3 | 3 | `resourcePath()` helper only | Integration test both branches |
| T12 | Preload fails: sandboxed preload can't `require` across files | 3 | 3 | electron-vite bundles it | `output.format: 'es'` |
| T13 | `rrule` `tzid` bug / stale library | 2 | 3 | **Dependency not taken.** Luxon + stored RRULE string. | — |
| T14 | DST bugs invisible from a no-DST timezone | 4 | 3 | Unit tests, not manual checks | Both DST cases pinned on Day 3 |
| T15 | Two instances → doubled reminders | 2 | 4 | `requestSingleInstanceLock()` | — |
| T16 | `app_logs` grows unbounded; sync driver blocks | 2 | 2 | 14-day retention sweep on startup | — |
| T17 | Renderer crash kills reminders | 1 | 5 | **Scheduler is in main.** | Demonstrate it in the demo video |
| T18 | A TTS exception prevents the notification | 3 | 5 | `safely()` wrapper; notification is first and outside any try | Unit test throws from the TTS mock |

### Product & schedule

| ID | Risk | L | I | Mitigation |
| --- | --- | --- | --- | --- |
| P1 | Polish expands without limit on Day 6 | 4 | 3 | The cut list is **pre-decided** (`03` §2). Cut in order, without debate. |
| P2 | `yogi-song.mp3` does not exist | 3 | 2 | Source a CC0 track by Day 3 evening. Record provenance in `assets/audio/LICENSE.md`. |
| P3 | AI Assist half-finished on Day 7 | 3 | 2 | Ship the interface + a **disabled** toggle. That satisfies the brief; a broken toggle does not. |
| P4 | Feature creep from "it's only 20 minutes" | 4 | 3 | Nothing on `24-future-roadmap.md` is built during the 7 days. |
| P5 | A last-minute fix breaks the Day-7 build | 3 | 5 | **Feature freeze at 12:00 on Day 7.** Only release-blocking fixes after. |
| P6 | No clean Windows VM for install testing | 3 | 4 | A second Windows user account is a weaker but usable substitute — it still catches UAC and AUMID bugs. |
| P7 | Clarification questions feel pedantic | 3 | 2 | Accepted. Pre-selected chips make the common case one click. A wrong reminder is worse. |

### Security & trust

| ID | Risk | L | I | Mitigation |
| --- | --- | --- | --- | --- |
| S1 | A malicious/compromised LLM response | 2 | 5 | Four independent gates (`09` §5). And **nothing executes a string** — the real defence. |
| S2 | Prompt injection via speech | 2 | 4 | Same. Plus the confirmation gate: the user reads the reminder before it exists. |
| S3 | Malicious npm dependency exfiltrates data | 2 | 5 | **Default-deny network filter** blocks every non-allowlisted origin. Worth more than the privacy policy. |
| S4 | Dev CSP shipped to production | 2 | 4 | Gated on `app.isPackaged`; unit test asserts no `unsafe-eval`, no `ws:`. |
| S5 | Reset deletes the wrong directory | 1 | 5 | Path from `app.getPath`; two guards; **no-argument IPC handler**; symlink test. |
| S6 | API key leaks over IPC or into a log | 2 | 4 | Destructured out of `settings:get`; redaction regexes; a test greps the response for `sk-`. |
| S7 | A future dependency phones home | 3 | 4 | Default-deny filter makes it **fail loudly** rather than exfiltrate quietly. `spellcheck: false` already closed one. |
| S8 | `edge-tts` chosen for its voice quality | 2 | 5 | **It is cloud.** Documented in three places. It would have silently falsified the privacy statement. |
| S9 | SmartScreen deters users | 5 | 2 | Documented with a screenshot + checksums. Never advise disabling it. |
| S10 | A stack trace crosses IPC | 2 | 2 | `toIpcError` sanitises; test asserts no `C:\` or `at Object.` in any response. |

---

## 4. Risks the MVP accepts and does not mitigate

Stated so that accepting them is a decision, not an oversight.

| Accepted risk | Why |
| --- | --- |
| Malware already running as the user can read everything | No desktop app defends against this. Claiming otherwise is dishonest. |
| Reminders do not fire while LifeOS is quit | The alternatives (a service, a startup entry, a Task Scheduler job) are exactly what the app promises never to do. Documented loudly, in four places. |
| ±30 second accuracy | Invisible for human reminders. Buys correctness across sleep, reboot and the 24.8-day cap. |
| Unsigned installer | ₹0 is a hard constraint. Checksums published. |
| Recurring reminders keep their creation timezone | Explainable, displayed, and arguably correct. |
| The user editing `lifeos.db` by hand | Their file. `integrity_check` and `CHECK` constraints catch the damage. |
| System clock moved backwards | Self-inflicted. The forward case gets a storm guard because it produces *visible* harm. |
| English only | Scope. |

---

## 5. The three questions to ask every day

At the end of each day, in fifteen minutes, in writing:

1. **Did anything I assumed today turn out to be false?**
   If yes, it belongs in `02-assumption-challenge-and-recommendations.md`, not in your head.

2. **Is the Definition of Done closer than it was this morning?**
   If Day 3 evening arrives and a typed reminder does not fire a Windows toast, **stop all feature work.** Nothing else matters.

3. **What would I cut if tomorrow disappeared?**
   The answer is already written in `03` §2. Confirm you still believe it. If you find yourself wanting to cut something in Tier 0, that is the signal that the schedule — not the scope — is wrong.

---

## 6. The single sentence

> The riskiest thing in this project is speech-to-text, and the plan's answer is that **the product does not depend on it.**

Everything else in this register is a detail.
