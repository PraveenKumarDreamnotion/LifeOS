# 05 — Framework Decision

> **Decision:** Electron 43 + React 19 + TypeScript + Vite (via electron-vite).
> **Status:** `MVP DECISION` — final. Not to be revisited during the 7 days.

---

## 1. The decision rule

The brief states the priority explicitly, and it is the right one:

```text
Working polished MVP in 7 days  >  smallest app size  >  theoretical architecture perfection
```

Every argument below is scored against **"does this get a working, safe, polished Windows app onto GitHub Releases within 7 days, built by one person who knows JavaScript?"** Binary size, memory footprint, and elegance are tie-breakers, not criteria.

## 2. Candidates

| | Electron | Tauri 2 | Flutter |
| --- | --- | --- | --- |
| UI language | TypeScript/React | TypeScript/React | Dart |
| Backend language | **JavaScript/TypeScript** | **Rust** | **Dart** |
| Installer size | ~90–160 MB | ~10–20 MB | ~30–50 MB |
| Idle RAM | ~180–250 MB | ~80–120 MB | ~90–140 MB |
| Renderer | Bundled Chromium | System WebView2 | Skia/Impeller |

## 3. Why Electron wins for *this* build

### 3.1 The developer already knows the backend language

This is decisive and everything else is commentary. In this app, the *interesting* code is not the UI — it is:

- SQLite access and migrations
- The reminder scheduler (timers, `powerMonitor`, reconcile loop)
- The STT native binding and the PCM audio pipe
- System tray, Windows toasts, MP3 playback
- The natural-language parser

In Electron **all of that is TypeScript**. In Tauri, **all of that is Rust**. In Flutter, all of it is Dart plus FFI plugins. A developer with JavaScript experience and a 7-day clock cannot absorb Rust's ownership model *while* debugging an audio-resampling bug at 1 a.m. on Day 3.

`RISK` — This is the highest-magnitude risk in the whole project, and framework choice is the only lever that removes it entirely.

### 3.2 The ecosystem for the hard parts is Node-shaped

Every library this plan depends on has a first-class Node binding and a weaker or absent Rust/Dart equivalent:

| Need | Node (Electron) | Tauri (Rust) | Flutter (Dart) |
| --- | --- | --- | --- |
| NL date parsing | `chrono-node` 2.9.1, maintained, TS types | Rust `chrono` is a *date library*, not an NL parser. Would need to hand-write or FFI out. | Weak |
| Streaming offline STT | `sherpa-onnx` N-API, prebuilt Windows DLLs | sherpa-onnx has Rust bindings, but you'd wire the audio pipe across the WebView boundary yourself | Plugin work |
| SQLite | `node:sqlite` built in; `better-sqlite3` prebuilt | `rusqlite` (good) | `sqflite`/`drift` (good) |
| Offline TTS | `speechSynthesis` in Chromium | WebView2 speech support is inconsistent | `flutter_tts` → SAPI |
| Windows toasts | `Notification` in main | `tauri-plugin-notification` (good) | plugin |
| Tray | `Tray` API | good | plugin |

Tauri is genuinely strong on SQLite, notifications and tray. It is weak precisely where this product's differentiation lives: **the natural-language parser and the streaming speech pipeline.**

### 3.3 The costs of Electron are the ones this brief has already accepted

- **Size.** A ~150 MB installer (Electron + a ~40 MB STT model) against Tauri's ~20 MB. `RISK (accepted)` — the brief explicitly ranks 7-day delivery above app size. GitHub Releases caps assets at 2 GiB, so there is no distribution problem.
- **RAM.** ~200 MB idle in the tray. `RISK (accepted)` — NFR-4 sets the budget at 250 MB. Acceptable for a companion app on a modern Windows machine; worth revisiting if it ever ships on low-end hardware.

### 3.4 Electron's specific advantage for the scheduler

`VERIFIED FACT` — The Electron **main process is a plain Node event loop and is never subject to Chromium's renderer throttling.** The reminder scheduler lives there. This is exactly the architecture a reminders app wants, and it comes for free.

## 4. Why not Tauri

The brief says: *"Do not choose Tauri unless research proves it will reduce delivery risk for a solo developer with JavaScript experience."*

`VERDICT` — Research does not prove that. It proves the opposite.

**Arguments for Tauri, taken seriously:**
- 10× smaller installer, ~2× lower RAM.
- Rust's type system would genuinely prevent a class of scheduler bugs.
- `tauri-plugin-sql` removes the native-rebuild problem cleanly.
- Uses the system WebView2 (present on all Windows 11 and updated Windows 10), so no Chromium to ship.

**Why they lose:**
1. **Rust is not optional in Tauri for this app.** The scheduler must run outside the WebView (same throttling logic applies to WebView2). The STT native binding must be invoked from Rust. Two of the three hardest components are therefore Rust components. `RISK (critical)` for a JS developer on a 7-day clock.
2. **The STT audio pipe would have to be rebuilt.** sherpa-onnx's Rust bindings exist but the prebuilt-DLL, zero-toolchain ergonomics that make the Node addon a one-day integration are a Node-ecosystem property.
3. **WebView2's `speechSynthesis` support is inconsistent** across Windows builds. `RISK` — the TTS path, already the second-riskiest item, gets riskier.
4. **`chrono-node` has no Rust equivalent.** The parser would move to the TS frontend and then have to marshal results into Rust for persistence — an awkward split for the app's most-tested component.
5. Debugging a Rust panic in a WebView2 IPC handler is not a Day-5 activity for someone learning Rust.

`FUTURE OPTION` — Tauri is the right target for a v2 rewrite once the product is validated, the parser is a well-specified pure function, and size/RAM start mattering. Keeping the parser as **dependency-free TypeScript** (see §6) preserves that option.

## 5. Why not Flutter

The brief says: *"Do not choose Flutter unless research proves there is a major advantage that outweighs the learning and plugin risks."*

`VERDICT` — There is no such advantage for a Windows-only MVP.

1. **Dart is a new language** for this developer. Same objection as Rust, without Rust's compensating safety.
2. **Flutter's Windows desktop embedding is the least mature of its targets.** System tray, native toasts, and background execution all rely on community plugins of varying quality. `RISK (high)`.
3. **No `chrono-node`.** The parser gets hand-written from scratch in Dart. That is the single highest-value component in the app, rewritten under time pressure, untested.
4. **Streaming offline STT means writing an FFI plugin** around sherpa-onnx or whisper.cpp by hand.
5. Flutter's real advantage is a single codebase across mobile + desktop. **The brief explicitly forbids mobile in the MVP.** Paying Flutter's desktop cost to buy a mobile benefit that is out of scope is a bad trade.

`FUTURE OPTION` — If LifeOS ever targets Android/iOS as first-class, Flutter becomes a serious contender for a rewrite. Not now.

## 6. Consequences of choosing Electron

### 6.1 What we take on

| Obligation | Because | Where it's handled |
| --- | --- | --- |
| Electron security is now *our* job | Chromium + Node in one process tree is a real attack surface | `11-electron-security-architecture.md` |
| Preload **must** be bundled to one file | `VERIFIED FACT` — sandboxed preloads cannot `require` across files | electron-vite |
| Renderer must never touch Node/fs/SQLite | contextIsolation + sandbox | `16-api-and-ipc-contracts.md` |
| CSP must be authored, not defaulted | Electron ships none | `11` §5 |
| Scheduler must live in main | Renderer throttling | `08` §6 |
| Pin the Electron patch version | Native-module ABI, if `better-sqlite3` is used | `package.json` |

### 6.2 What we preserve for the future

The point of the layered architecture in `13-system-architecture.md` is that **the valuable code is portable**.

```text
electron/     ← Electron-specific. Would be rewritten for Tauri.
src/          ← React. Ports to Tauri unchanged.
core/         ← Parser, validators, recurrence math, formatting.
              ← PURE TYPESCRIPT. Zero Electron imports. Zero Node imports.
              ← Unit-testable with Vitest, no Electron harness.
              ← Portable to Tauri, to a web build, or to a Node CLI, untouched.
```

`MVP DECISION` — **The `core/` layer must not import from `electron`, `fs`, `path`, or any Node builtin.** Enforce with an ESLint `no-restricted-imports` rule. This one rule is what keeps the framework decision reversible.

### 6.3 Build tooling

`MVP DECISION` — **electron-vite**, not raw Vite + a hand-rolled Electron config, and not electron-forge.

- It bundles main, preload and renderer with correct defaults for each target.
- It bundles the preload into a single file — a hard requirement of `sandbox: true`.
- It gives HMR for the renderer and a fast restart for main.
- It composes with electron-builder for packaging without argument.

`ASSUMPTION (community consensus)` — For a solo dev producing NSIS + portable, **electron-builder** beats electron-forge on friction: one dependency, NSIS is the default Windows target, portable is first-class, and GitHub publishing works from an env var.

## 7. Decision record

```text
ID:        ADR-001
Title:     Desktop framework
Status:    Accepted
Date:      2026-07-10
Context:   Solo JS developer. 7-day deadline. Windows-only MVP. Offline STT with
           streaming partials, a natural-language date parser, a background
           scheduler, system tray and native toasts. ₹0 operating cost.
Decision:  Electron 43 + React 19 + TypeScript + Vite (electron-vite) + electron-builder.
Rejected:  Tauri 2  — forces Rust for the scheduler, the STT pipe and persistence;
                      no chrono-node equivalent; WebView2 speechSynthesis inconsistent.
           Flutter  — new language; least-mature desktop embedding; parser rewritten
                      from scratch; its cross-platform benefit is explicitly out of scope.
Accepted
costs:     ~150 MB installer; ~200 MB idle RAM; Electron security is our responsibility.
Reversal
plan:      Keep core/ as pure TypeScript with no Electron or Node imports, enforced by
           ESLint. A Tauri port then replaces only electron/ and rewires the IPC layer.
```
