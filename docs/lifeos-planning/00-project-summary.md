# 00 — Project Summary

> **Read this first.** It is the executive summary of 28 planning documents. Everything below links to the detail.

---

## 1. What we are building

**LifeOS**, with an assistant named **Yogi**: a privacy-first Windows desktop app that proves one workflow reliably.

```text
Voice → Understanding → Confirmation → Local Scheduling → Reminder → Action
```

Seven days. One developer. ₹0/month. Published on GitHub Releases. No backend, no account, no telemetry, and nothing leaves the device by default.

The MVP succeeds if a stranger can install it, say *"remind me in five minutes to call my mother,"* see exactly how Yogi understood it, confirm it, and be reminded — with a Windows notification and a spoken reminder — five minutes later, offline.

## 2. The three decisions that shape everything

### 2.1 The confirmation gate is the product

Nothing is written to the database without an explicit user Confirm press. Not from the parser, not from an LLM. There is one function that converts a parsed result into something persistable (`toCreateInput`), and it has exactly two call sites: the Confirm button and the Edit form's Save.

This is not a safety feature bolted on. It is the identity of the product. An assistant that acts without asking is a different product and deserves a different name.

### 2.2 The scheduler lives in the main process, and it is wall-clock authoritative

`VERIFIED FACT` — `setTimeout` coerces its delay to a signed 32-bit integer. Above **2,147,483,647 ms (~24.8 days)** the delay becomes 1 and the callback **fires immediately**. Timers also pause during sleep and are documented to occasionally never fire at all.

So the persisted `next_fire_at` column is the source of truth, and a 30-second reconcile tick is the engine. Timers are an optimisation, never a contract.

`VERIFIED FACT` — The Electron main process is a plain Node event loop and is never throttled by Chromium. The renderer is. A reminders app whose scheduler lives in the renderer is a reminders app that misses reminders.

### 2.3 Typed input is built before voice

Speech-to-text is the highest-risk item in the project. The scheduling pipeline and the speech pipeline are independent — voice is just an input adapter.

So the entire `parse → confirm → persist → tick → notify` loop is built on a text box first. **The product is demonstrable on Day 3.** Voice is layered on Day 5, with a hard timebox and a pre-decided fallback ladder. If every speech option fails, LifeOS still ships, and 20 of the 23 Definition-of-Done points still pass.

---

## 3. Where the brief was wrong

The brief invited challenge. Two of its stated technical directions are **falsified by current evidence**, and two more are load-bearing assumptions that would have silently broken the build. Full detail in `02-assumption-challenge-and-recommendations.md`.

| Brief said | Evidence | Decision |
| --- | --- | --- |
| *"Use Vosk as the default STT engine"* | The `vosk` npm package (0.3.39, ~4 years old) depends on **`ffi-napi`**, which is unmaintained and **does not build or run on Node ≥ 18.7**, breaking under Electron 22+. The developer's Node is 24.11.1; Electron 43 bundles Node 24. <br/>*(alphacep/vosk-api#1613, #1962; node-ffi-napi#238)* | **Replace with `sherpa-onnx`** (v1.13.4, actively maintained, N-API not ffi, no compiler/Python/CMake needed, prebuilt Windows DLLs, true streaming partials). The brief's `SpeechService` provider architecture is preserved unchanged — only the concrete default swaps. |
| *"Use Windows native TTS or Windows SAPI"* | `speechSynthesis` in Electron is offline, uses better (WinRT) voices, and needs no shell spawn — but Chromium throttles hidden renderers, and `backgroundThrottling:false` is **buggy for `hide()` on Windows** *(electron#31016, #20974)*. The reminder must speak from the tray. | **`speechSynthesis` in an always-alive hidden window**, gated by a Day-1 spike **against a packaged build**. Fallback: main-process SAPI with the text passed on **stdin**, never interpolated. |
| *"Create a timer for the nearest reminder"* | The 24.8-day `setTimeout` trap, plus sleep behaviour. | **Persisted `next_fire_at` + a 30 s reconcile tick + `powerMonitor` + startup catch-up.** |
| *"Use RRULE-compatible storage"* (implying the `rrule` lib) | `rrule@2.8.1` has had no release in 12+ months and setting `tzid` **breaks `after()`** *(jkbrzt/rrule#608)*. | **Store the RRULE string** (for interop and zero-migration future growth); **compute** with ~15 lines of Luxon. |

Also verified and eliminated before it could cost a day: **`webkitSpeechRecognition` throws a `network` error inside Electron** — Electron ships no Google Speech key. *(electron#46143, #7749)*

And a quiet one that would have falsified the privacy statement: **`edge-tts` is cloud**, not offline. It opens a WebSocket to Microsoft. Had it been chosen for its voice quality — a common recommendation — every spoken reminder would have silently transmitted its text.

---

## 4. The recommended architecture

```text
RENDERER (sandbox:true, no Node)          React 19. Chat, live transcript, cards, schedules.
    │                                     AudioWorklet: mic → PCM16 @16kHz.
    │ contextBridge: 14 named functions. Never ipcRenderer. Frozen.
PRELOAD (sandboxed, bundled to ONE file)
    │ validated IPC — Zod .strict() at every handler, Result<T> envelope
MAIN PROCESS (Node, never throttled)      SQLite · Scheduler · Tray · Notifications
    │                                     SpeechService · TTSService · secrets
    │ one-way commands
HIDDEN AUDIO WINDOW (backgroundThrottling:false)   speechSynthesis + <audio>

core/  ── PURE TYPESCRIPT, imports only luxon + chrono-node + zod ──
       Intelligence: intent, recurrence, chrono, ambiguity, confidence, clarification
       Scheduling:   RRULE, next-occurrence (Luxon, DST-correct), human formatting
       Safety:       Zod schemas, allowed-action validator, unsafe-content scanner
       Used by BOTH main and renderer. Unit-testable in 41 ms. Portable off Electron.
```

**Stack:** Electron 43.1.0 (Chromium 150, Node 24) · React 19 · TypeScript · electron-vite · `node:sqlite` (fallback `better-sqlite3` — prebuilds exist) · chrono-node 2.9.1 · Luxon · Zod · sherpa-onnx 1.13.4 · electron-builder → NSIS + portable.

**The trigger path, in order.** Read the annotations as the reliability argument:

```text
notifier.show()                    ← UNCONDITIONAL. Main process. Always works.
history.record()                   ← UNCONDITIONAL.
safely(() => tts.speak())          ← best effort. May be throttled.
safely(() => audio.play())         ← best effort. Only if action = sing.
safely(() => mainWindow?.send())   ← only if a window exists.
```

Nothing below a line can prevent anything above it. A silent reminder is still a reminder; a missed reminder is a bug.

Detail: `13-system-architecture.md`.

---

## 5. The biggest technical risks

| # | Risk | Why it's dangerous | Pre-decided response |
| --- | --- | --- | --- |
| **1** | **STT consumes multiple days** | It is unbounded work with a dead default (Vosk) and an audio pipe (renderer mic → main recogniser) that must be hand-built. | **The product doesn't depend on it.** Typed input first. Hard 120-min spike, then a fallback ladder: sherpa-onnx → transformers.js → cut voice entirely. |
| **2** | **The scheduler misfires silently** | `setTimeout` fires a 30-day reminder *immediately*. Sleep delays or drops timers. DST moves weekly reminders. All three produce *plausible* wrong behaviour. | Wall-clock reconcile tick. Every failure mode is a unit test with an injected clock — including both DST cases, which cannot be reproduced from a no-DST timezone. |
| **3** | **TTS is silent in the tray** | The one moment it must work is the one moment Chromium throttles it. `backgroundThrottling:false` is documented as buggy for `hide()` on Windows. | SPIKE-3, on Day 1, **against a packaged build.** SAPI fallback ready and specified. |
| **4** | **Packaged ≠ dev** | Toasts silently fail without an AUMID. The tray icon is GC'd after ~10 s *only when packaged*. Both look fine in `npm run dev`. | **Build an installer on Day 1**, not Day 7. Three spikes run against it. |
| **5** | **The parser guesses** | `"remind me at 6"` auto-assigned to 6 AM is a twelve-hour error nobody notices until they miss something. `"every Monday"` silently becoming one-time is worse. | `isCertain()` drives ambiguity structurally. Never auto-assign a meridiem. The recurrence keyword layer runs *before* chrono. 120 fixtures, written before the parser. |
| **6** | **Seven days is not enough** | It might not be. | Tiered scope with a **pre-decided cut order**. 16 hours of recoverable slack, all of it below Tier 0. Day 3 evening is the go/no-go gate. |

Full register with likelihood × impact scoring: `25-risk-register.md`.

---

## 6. Day 1 technical spikes

Every spike has a **timebox**, a **binary pass/fail**, and a **fallback chosen in advance** — so that a tired developer at 9 p.m. on Day 1 makes no decisions.

| Spike | Question | Box | If it fails |
| --- | --- | --- | --- |
| **SPIKE-0** | Does a hardcoded reminder fire a toast from the tray? *(No DB, no parser, no UI.)* | 60 m | **Stop everything.** This is the product. |
| **SPIKE-1** | `require('node:sqlite')` flag-free in Electron 43 main? | 60 m | `better-sqlite3` + `install-app-deps` + `asarUnpack`. Prebuilds exist. |
| **SPIKE-2** | `sherpa-onnx` installs with no C++ toolchain; transcribes a fixture WAV; partials < 500 ms? | **120 m hard** | `transformers.js` Whisper (zero native modules). Then: cut voice. |
| **SPIKE-3** | Does `speechSynthesis` speak from a hidden window after 10 min in the tray — **packaged**? | 60 m | `SapiTTSService`, text on stdin. |
| **SPIKE-4** | Toast fires and tray icon survives 15 min — **packaged**? | 30 m | `electron-windows-notifications`. |
| **SPIKE-5** | NSIS + portable build; installs with **no UAC**? | 45 m | Portable-only release. |

Three of these must run against a **packaged, installed build.** Discovering on Day 7 that toasts only work when packaged is the classic Electron disaster, and it is entirely avoidable.

Note that SPIKE-2 runs **last**, and touches no microphone. It feeds a known-good 16 kHz WAV straight to the recogniser. Testing the engine before the pipe is what separates a two-hour resampler bug from a lost day.

---

## 7. Assumptions that must be validated before coding

| # | Assumption | How | If false |
| --- | --- | --- | --- |
| V1 | `node:sqlite` works flag-free in Electron 43 | SPIKE-1 | `better-sqlite3` |
| V2 | `sherpa-onnx` needs no toolchain and streams partials | SPIKE-2 | transformers.js, then cut voice |
| V3 | `speechSynthesis` survives `hide()` on Windows | SPIKE-3, **packaged** | PowerShell SAPI |
| V4 | Toasts fire and the tray icon persists when packaged | SPIKE-4, **packaged** | userland toast library |
| V5 | electron-builder installs without admin | SPIKE-5 | portable-only |
| V6 | The 48k→16k resampler is correct | Fixture WAV, inside SPIKE-2 | Bench before blaming the model |
| V7 | The developer's Windows exposes usable TTS voices | Inside SPIKE-3 | Enumerate at runtime; degrade to silent + toast |
| V8 | `yogi-song.mp3` exists | **It does not.** The repo is empty. | Source a CC0 track by Day 3. Record provenance in `assets/audio/LICENSE.md`. |

> **The most important sentence in this plan:** if V2 and V3 both fail, LifeOS still ships — typed input, notifications, a silent reminder modal, and every safety guarantee intact. That is why SPIKE-0 comes first, and it is the reason the seven days are survivable.

---

## 8. The seven days

The brief's sequence was challenged and resequenced (`19` §1). Three inversions: **typed before voice**, **package on Day 1**, **scheduler on Day 3 rather than Day 5**.

| Day | Goal | Evening state |
| --- | --- | --- |
| **1** | Foundation, five spikes, **an installer** | An installed app that fires a toast from the tray, with no features |
| **2** | SQLite, migrations, repository, IPC, throwaway dev form | A reminder survives an app restart |
| **3** | Parser (120 fixtures first), scheduler, notifications | **A typed reminder fires a Windows toast.** ← go/no-go |
| **4** | Tray, TTS, MP3, trigger modal, overdue catch-up | Yogi speaks the reminder aloud from the tray |
| **5** | Speech-to-text — timeboxed, cuttable | Words appear as you speak them |
| **6** | Onboarding, real cards, schedules, history, settings, reset | A stranger can use it |
| **7** | Package, QA on a fresh VM, README, screenshots, Release | A stranger can install it |

**Feature freeze at 12:00 on Day 7.** Slack is distributed, not reserved: 16 recoverable hours, all of it in Tier 1 and Tier 2, cut in a pre-decided order (`03` §2). Nothing in Tier 0 is ever cut.

---

## 9. Definition of Done

The MVP is complete only when all 23 pass **from the published GitHub artifact, on a fresh Windows machine** — not from `npm run dev`.

```text
 1 □ User installs LifeOS on Windows.
 2 □ User opens the app.
 3 □ User sees onboarding and a privacy explanation.
 4 □ User can click the microphone.
 5 □ User speaks a supported reminder command.
 6 □ User sees a live or final transcript.
 7 □ Yogi correctly extracts the reminder information.
 8 □ User sees the exact date and time.               ← absolute, never only "tomorrow"
 9 □ Yogi speaks a confirmation response.
10 □ User can confirm, edit, or cancel.
11 □ The reminder is stored locally in SQLite.
12 □ The reminder appears in Active Schedules.        ← never called "Cron Jobs"
13 □ The reminder survives an app restart.
14 □ The app minimises to tray instead of fully closing.
15 □ The reminder triggers while the app is running in the tray.
16 □ A Windows notification appears.
17 □ Yogi speaks the reminder.
18 □ The sing command plays the bundled MP3.
19 □ The user can delete an upcoming reminder.
20 □ The app does not require administrator access.
21 □ The app does not run arbitrary commands.
22 □ The GitHub Release includes a working Windows installer.
23 □ The README explains privacy behaviour and known limitations.
```

Plus two measurements that test the *product's claims* rather than its code, and which belong in the demo video:

```text
□ Procmon:   zero writes outside %APPDATA%\LifeOS\ and %LOCALAPPDATA%\Programs\LifeOS\.
□ Wireshark: AI Assist off, 30-minute session including a fired reminder → ZERO packets.
```

---

## 10. What is deliberately not built

Wake word · continuous listening · computer control · Gmail/WhatsApp/Calendar/Drive · cloud sync · accounts · medical, legal or financial advice · open-ended chat · autonomous agents · web browsing · purchases · vector search · semantic memory recall · macOS/Linux/mobile/web.

And a shorter list of things that are not deferred but **prohibited**, permanently: administrator privileges, registry modification, drivers, services, Windows Task Scheduler jobs, shell commands built from user or model output, executing anything an LLM returns, deleting files outside the app's own data folder, silent startup registration, and uploading user data by default.

`24-future-roadmap.md` gives every deferred item a home and a precondition. Nothing on it is built during the seven days — not the small ones, not the "it's only twenty minutes" ones.

---

## 11. Document index

| # | Document | Read it when |
| --- | --- | --- |
| 00 | **Project Summary** | Now |
| 01 | Product Requirements | Before writing any code |
| 02 | **Assumption Challenge** | Before trusting the brief |
| 03 | MVP Scope and Non-Goals | When tempted to add something |
| 04 | Technology Research | For a citation |
| 05 | Framework Decision | If someone says "why not Tauri" |
| 06 | **Speech-to-Text Research** | Day 1 and Day 5 |
| 07 | **Text-to-Speech Research** | Day 1 and Day 4 |
| 08 | **Smart Scheduling Architecture** | Day 3. Twice. |
| 09 | OpenAI AI Assist Architecture | Day 6, if it survives the cut |
| 10 | Local Database and Memory | Day 2 |
| 11 | **Electron Security Architecture** | Day 1, and before every PR |
| 12 | UI/UX Specification | Days 4–6 |
| 13 | **System Architecture** | Before any structural decision |
| 14 | Folder Structure | Day 1 |
| 15 | Data Models and Schemas | Day 2 |
| 16 | API and IPC Contracts | Day 2 |
| 17 | Error Handling and Edge Cases | Every day |
| 18 | Testing Strategy | Day 3, before the parser |
| 19 | **Seven-Day Roadmap** | Every morning |
| 20 | **Daily Implementation Checklists** | Every step |
| 21 | Release and GitHub Plan | Day 7 |
| 22 | Privacy Policy and Disclosures | Day 7 (Part A ships verbatim) |
| 23 | Known Limitations | Day 7 (ships) |
| 24 | Future Roadmap | When closing an issue |
| 25 | **Risk Register** | Day 1 evening, and every evening |
| 26 | Claude Code Implementation Prompts | While implementing |

---

## 12. The one sentence

> Prove it can be installed on Day 1, prove it can remind you on Day 3, make it hear you on Day 5, and spend the last two days making sure a stranger can trust it.
