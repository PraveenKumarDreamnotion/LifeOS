# Current Project Status

> **Snapshot date:** 2026-07-15 · **Source of truth:** the actual codebase (verified against source by a full three-part survey — conversation/AI, database/main/tests, and renderer/UI — not assumed).
> **Regenerate this file** whenever the project state changes materially.
>
> **Latest change (2026-07-15):** AI replies now **render Markdown** (headings/lists/bold/code — no literal `**`) consistently in the main chat and launcher, and the launcher's **STT flow is provider-specific** (offline keeps the editable draft + Send; OpenAI STT auto-submits hands-free). Installer `release/LifeOS Setup 0.1.0.exe` rebuilt. See the top Progress-log entry.

## Documentation audit (2026-07-15)

> A full end-to-end documentation pass was completed on **2026-07-15**. A structured, source-verified engineering documentation site now lives at **`docs/`** (26 pages: [README index](../README.md), plus PROJECT_OVERVIEW, PRODUCT_VISION, ARCHITECTURE, PROJECT_STRUCTURE, TECHNOLOGY_STACK, FRONTEND, BACKEND, DATABASE, IPC, VOICE_PIPELINE, AI_INTEGRATIONS, REMINDER_SYSTEM, LAUNCHER, SETTINGS, WEB_SEARCH, MEMORY, USER_FLOWS, FEATURE_GUIDE, LIVE_DEMO, TESTING, DEVELOPMENT_GUIDE, PERFORMANCE, ROADMAP, TROUBLESHOOTING, GLOSSARY). Every page was written against the actual source tree (each subsystem read file-by-file), with Mermaid diagrams, cross-links, and `path:line` references.

**Discrepancies found — this changelog's dated entries are accurate, but several *summary tables* had drifted from source. Corrected figures (verified from source):**

| Claim (in this file's summary sections) | Source truth | Where verified |
| --- | --- | --- |
| Schema "version 4", "8 tables" | **`user_version` 8**, **18 tables** (M001–M008; Gmail added 10) | `electron/database/migrations.ts` |
| "34 settings keys" | **50 keys** | `electron/database/settings-repository.ts:6-86` |
| Conclusion "252 passing tests"; folder-tree "unit 22 · integration 5 · renderer 1" | **523 tests across 55 files** (40 unit + 14 integration + 1 renderer) — the "523 / 55" header figure is the current one | `tests/` (static 437 → 523 with parameterized fixtures) |
| Cloud STT model `gpt-4o-mini-transcribe` | Seeded default is **`gpt-4o-transcribe`** (`gpt-4o-mini-transcribe` is only the empty-value fallback) | `settings-repository.ts:32` |
| STT = sherpa + OpenAI (2) | **4 registered** seams (sherpa, openai wired + UI; whisper-cpp, deepgram optional) | `electron/providers/registry.ts` |
| Channels (unstated) | **62** `CH` constants + ~11 inlined audio channels | `core/types/channels.ts` |
| "no preload chunks" enforced by a build-check | No automated gate exists — it's the electron-vite Rollup `cjs`/`[name].js` output config + a manual `out/preload/chunks`-absent check | `electron.vite.config.ts`; `tests/`, `scripts/` searched |
| Launcher absent from the architecture diagram | Now documented in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and [`docs/LAUNCHER.md`](../LAUNCHER.md) | — |

No application code was changed during the audit (documentation-only). The inline figures below were corrected where most misleading; this file's *dated changelog entries are left intact* as the historical record.

## Introduction

**LifeOS** is a privacy-first desktop companion for Windows whose assistant is named **Yogi**. It began as a natural-language reminder app and has since **pivoted to a conversation-first AI companion**: the user speaks or types in plain language, and Yogi holds a real, persistent conversation — answering questions, searching the web when it needs live facts, and creating/confirming reminders inside that same chat. Reminders still fire as a Windows notification **and** a spoken line, and can now be delivered into an always-on-top **reminder popup** that is itself a chat client.

The privacy posture is unchanged and central: **everything runs on-device by default** — local SQLite, a local speech-to-text model, and offline OS voices — with **no server, account, sync, or telemetry**. Cloud intelligence (OpenAI) is strictly **opt-in, per-capability, consent-gated, and keyed to the user's own API key**, which is encrypted at rest with Windows DPAPI and never crosses the IPC boundary in readable form.

## Current product objective

The original MVP loop is complete and remains the reliability spine:

```text
Voice / Text → Understanding → Confirmation → Local Scheduling → Reminder (notify + speak)
```

The v2 objective builds a conversation around that spine:

```text
Persistent chat  →  Yogi understands & replies (local or OpenAI)
                 →  needs live info?  → web search (tool-calling layer) → answer with sources
                 →  wants a reminder? → Action Dispatcher proposes → confirm (click OR voice) → schedule
                 →  reminder fires    → notify + speak + (optional) popup you can converse with
```

## Overall progress

| Track | State |
| --- | --- |
| **MVP reminder loop** (v1) | ✅ Complete & human-verified — voice/text → understand → confirm → schedule → notify + speak, plus tray, history, settings, onboarding, theming, guarded reset. **Now with full repeat scheduling** (daily/weekly/monthly/yearly + custom every-N, multi-weekday, end-date/occurrence-count) and a manual **create/edit reminder UI** on the Schedules screen |
| **Conversation-first pivot** (v2) | ✅ Core built & working — persistent chat sessions, ConversationEngine, OpenAI providers (LLM/STT/TTS/Search), Action Dispatcher, voice-confirm, reminder popup, streaming TTS, tool-calling/web-search, voice controls (stop/interrupt/searching) |
| **Personalization & memory** | ⛔ Schema-only — `memories` table exists and the context builder is wired for it, but there is no extraction/recall/UI yet |
| **Packaging & release** | ⚠️ Packaged (NSIS + portable) and **re-built 2026-07-15** (`release/LifeOS Setup 0.1.0.exe` + portable, both re-signed) after the Markdown-rendering + launcher-STT work (and the earlier recurrence + branding work); the packaged asar was confirmed to carry the new code (`Markdown` chunk + `sttAutoSubmit`). Still **no fresh-VM QA of the packaged GUI**. Auto-update is **not active** (no `electron-updater` dependency; a `publish:` block exists but nothing consumes the feed) |
| **Gmail integration** (Integrations) | ✅ **All 5 phases built & test-green.** P1 OAuth (loopback+PKCE)+encrypted tokens+Settings UI · P2 `historyId` incremental sync + notifications · P3 conversational email (new email → its own chat + spoken heads-up + grounded Q&A) · P4 opt-in web research (auto-decision + cache) · P5 hardening (startup catch-up, 403 rate-limit retry, resume sync). **Phases 1–2 verified LIVE (2026-07-15); 3–5 test-green, live-drive pending.** Semantic search over the whole mailbox is a separate future effort. See `docs/lifeos-planning/gmail-integration.md` |

**Build health:** `typecheck`, `lint`, and `build:win` all green. **579 automated tests pass** across **59 test files** (latest: the 2026-07-15 Markdown-rendering + provider-specific launcher STT work — new `markdown.test.tsx` (16 render tests) and `stt-flow.test.tsx` (4 decision tests), plus 3 `desktop-voice-controller` cases for the `sttAutoSubmit` flag). The sandboxed preload is verified free of code-split chunks (`out/preload/chunks` absent) — the invariant that keeps `window.lifeos*` defined.

> **Recent work (this snapshot):** **Markdown-rendered AI replies** (a dependency-free, XSS-safe `<Markdown>` shared by chat + launcher — headings/lists/bold/code, no literal `**`) and a **provider-specific launcher STT flow** (offline = editable draft + Send; OpenAI = hands-free auto-submit). Before that: **repeat scheduling** for reminders (daily/weekly/monthly/yearly + custom every-N-units, multiple weekdays, COUNT/UNTIL end conditions) with a stateless anchor-based occurrence engine, a **create/edit reminder UI**, and the **Yogi logo recolored to the LifeOS orange brand**. Rebuilt the Windows installer. See the top Progress-log entry.

---

## Progress log

### 2026-07-15 — Markdown-rendered AI replies + provider-specific launcher STT flow

**Summary.** Two user-requested improvements. (1) The assistant's replies now **render Markdown** instead of showing literal `**` — `**Features**` displays as bold **Features**, and headings/lists/`code`/links render with real typography, consistently in **both** the main chat and the voice launcher. (2) The launcher's speech-to-text flow is now **provider-specific**: offline STT keeps the editable-draft + **Send** review step exactly as before, while **OpenAI STT is hands-free** — the recognized text is submitted straight to the chat, the user's message appears, and the AI response starts automatically with no extra click.

**Markdown rendering.**
- **`src/components/Markdown.tsx`** (new) — a tiny, **dependency-free** Markdown → React renderer, shared by `MessageBubble` (main chat) and `LauncherApp` (launcher) so replies look identical on both surfaces. Supports `#`–`######` headings (capped at `<h3>` so a lone `#` can't dominate a bubble), `-`/`*`/`+` and `1.` lists (**list items separated by blank lines — as the model emits them — stay in one `<ol>`/`<ul>` with correct numbering**, the exact screenshot case), `**bold**`, `*italic*`, `` `code` ``, and `[text](url)` links.
- **Safety by construction:** builds **React elements only, never `dangerouslySetInnerHTML`**, so untrusted model output can't inject markup (React escapes every text node). Links render **anchor text only** (URL dropped) — an `<a href>` would navigate the whole Electron window and a `javascript:` href is an injection vector, so text-only is the safe, no-new-IPC choice. The parser is **tolerant of partial/malformed Markdown** (an unclosed `**` or half-typed `[link` degrades to literal text, never throws) — future-proof for streamed text. `_`/`__` are intentionally **not** emphasis so `snake_case`/`file_names` survive.
- **Scope guard (no regressions):** only the **normal assistant** reply is Markdown. User bubbles and delivered email/reminder turns keep their plain pre-wrap rendering, so nothing that isn't a model reply is reinterpreted.
- **All three AI-reply surfaces are consistent:** the same `<Markdown>` is used by the main chat, the voice launcher, **and the reminder popup** (`PopupApp.tsx`, itself a chat client — its assistant replies previously showed literal `**` too).
- Styles: `.md*` in `src/styles/global.css` (shared; `white-space: normal` resets the launcher/popup bubbles' inherited pre-wrap) + compact `.launcher-md` / `.popup-md` overrides in `launcher.css` / `popup.css`.

**Provider-specific launcher STT flow.**
- **`DesktopVoiceState.sttAutoSubmit`** (new field, `core/types/desktop-voice.ts`) — surfaced to the launcher renderer in every state snapshot. Computed **live** in `electron/main/index.ts` as `stt_provider === 'openai' && hasApiKey && sttConsented` (the exact condition under which the cloud batch provider actually transcribes) via a new optional `getSttAutoSubmit` controller/IPC dep, so a silent sherpa fallback is **never** auto-submitted, and switching the provider in Settings takes effect on the next launch with no restart.
- **`src/launcher/LauncherApp.tsx`** — `onTranscript` branches on the flag via a pure, unit-tested helper **`src/launcher/stt-flow.ts` (`decideTranscriptAction`)**: `submit` → `sendTranscript` immediately (`processing → sending`, no review draft, no Send button); `review` → the unchanged `reviewReady` path (editable text + Send/Dismiss); `ignore` → empty transcript. A `justAutoSubmittedRef` guard suppresses the empty-transcript recovery in the auto-submit path so a stray `reviewReady` can't race the send. Consecutive OpenAI voice turns each auto-submit and continue the same conversation.

**Files changed.** New: `src/components/Markdown.tsx`, `src/launcher/stt-flow.ts`, `tests/renderer/markdown.test.tsx`, `tests/renderer/stt-flow.test.tsx`. Renderer: `src/features/chat/MessageBubble.tsx`, `src/launcher/LauncherApp.tsx`, `src/popup/PopupApp.tsx`, `src/styles/global.css`, `src/launcher/launcher.css`, `src/popup/popup.css`. Core/main: `core/types/desktop-voice.ts`, `electron/main/desktop-voice/controller.ts`, `electron/main/ipc/launcher.ts`, `electron/main/index.ts`. Tests: `tests/unit/desktop-voice-controller.test.ts` (+3 `sttAutoSubmit` cases). Docs: `FRONTEND.md`, `LAUNCHER.md`, `AI_INTEGRATIONS.md`, this file.

**Verification.** `typecheck` ✅ (node + web) · `lint` ✅ 0 errors (pre-existing warnings only) · `build:win` ✅ (NSIS + portable re-signed; preload-chunks invariant intact; installer `release/LifeOS Setup 0.1.0.exe` rebuilt, packaged asar confirmed to contain the new `Markdown` chunk + `sttAutoSubmit` in `out/main/index.js`) · `test` ✅ **579 / 59 files**. The Markdown renderer is covered by **16 jsdom render tests** (real DOM assertions) including the exact screenshot reply (heading + blank-line-separated numbered list with bold lead-ins → no literal `**`, one `<ol>`), inline formatting, snake_case preservation, and **partial/malformed tolerance** (unclosed `**`, half link, lone backtick, empty). The launcher flag is covered by 3 controller tests (offline default / OpenAI on / live re-derivation) and the transcript-routing decision by **4 `decideTranscriptAction` tests** (submit / review / ignore / no-session fallback).

> **GUI-drive & OpenAI-STT gap (honest):** the packaged Electron GUI was **not** driven end-to-end here (no display in this environment), and the **OpenAI auto-submit path needs a live OpenAI key + STT consent** to exercise for real — the *decision* is unit-tested and the wiring reasoned + type-checked, but the end-to-end hands-free dictation was not live-driven. The offline (review) path is unchanged and remains covered. A manual Windows pass — render a Markdown reply in all three windows, then dictate with each STT provider (offline → Send appears; OpenAI → auto-submits, multiple turns) — is the remaining check before calling packaged parity confirmed.

### 2026-07-15 — Repeat scheduling for reminders + Yogi orange rebrand

**Summary.** Two user-requested improvements. (1) Reminders gained **full repeat scheduling** — the engine and UI now support **One time, Every day, Every week, Every month, Every year, and Custom** (every-N days/weeks/months/years, selectable weekdays, and an optional end: never / on a date / after N occurrences). Existing one-time reminders and stored daily/weekly rules are untouched. (2) The **Yogi logo was recolored** from the placeholder indigo (`#5B5BD6`) to the LifeOS orange brand (`#F97316`).

**Recurrence engine (stateless, anchor-based).**
- **`core/scheduling/rrule.ts`** — the `ParsedRule` model and `buildRule`/`parseRule` were widened to a strict **superset** of the old grammar: `FREQ` now includes `MONTHLY`/`YEARLY`, plus `INTERVAL`, multi-value `BYDAY`, and `COUNT`/`UNTIL` (mutually exclusive, RFC-5545). Kept **Luxon-free** so it can validate rules in a Zod refine. Legacy stored strings (`FREQ=DAILY;BYHOUR=7;BYMINUTE=0`, `FREQ=WEEKLY;BYDAY=MO;…`) still parse unchanged.
- **`core/scheduling/next-occurrence.ts`** — a single `occurrences(rule, anchor, zone)` generator is the source of truth; each occurrence is computed **from the anchor** (`anchor.plus({months: k*interval})`), never iteratively, so Luxon's month-length clamping can't drift (Jan 31 → Feb 28 → **Mar 31**, not Mar 28). `nextFireAfter` returns `null` when COUNT is exhausted or the next occurrence is past UNTIL; `firstFireAt` computes occurrence #1 (snapping a weekly rule to its first selected weekday). DST-correctness preserved (wall-clock stepping).
- **No DB migration** — the bound rides inside the existing `recurrence_rule` string, so `user_version` stays at 8 and every existing row is byte-compatible.

**Scheduler + persistence.**
- **`electron/scheduler/scheduler.ts`** — roll-forward is now anchored on `scheduledAt` (occurrence #1) so COUNT indexing is exact; when `nextFireAfter` returns `null` the reminder is **marked completed** instead of rolling forward (a bounded reminder ends cleanly after its final fire). The "collapse N missed occurrences into one roll-forward" and missed-while-closed behaviours are unchanged.
- **`reminder-repository.ts`** — `update()` now re-arms a reminder when it's rescheduled (status → `pending`, `completed_at` cleared, `next_fire_at` reset to the new first fire), so **editing** a fired/one-time reminder into a repeat (or vice-versa) takes effect immediately. `SUPPORTED_RRULE` (in `core/types/ipc.ts`) now validates via `parseRule` (grammar lives in one place).

**UI (create + edit).**
- **`src/features/schedules/ReminderEditor.tsx`** (new) — a clean modal with name, date, time, a Repeat dropdown, and a Custom sub-panel (every-N + unit, weekday chips, and an Ends radio group). Shows a **live preview** of the resolved schedule. Reused for both **＋ New reminder** and per-row **Edit** on the Schedules screen.
- **`src/features/schedules/repeat.ts`** (new) — the pure form ↔ rule translator; builds instants with `DateTime.fromObject(..., { zone })` (never system-local), delegates all recurrence maths to `core/scheduling`.
- **`SchedulesScreen.tsx`** — added the New/Edit buttons and richer recurrence summaries (`rruleToHuman` now takes the anchor to render "Every month on the 15th", intervals, weekday lists, and COUNT/UNTIL tails). Delete already stopped future occurrences; unchanged.
- Chat NL recurrence is intentionally **still daily/weekly only**; its refusal message now points users to **＋ New reminder** for monthly/yearly/custom (kept honest rather than silently pretending to understand).

**Branding.** `scripts/gen-icons.mjs` recolored to `#F97316` and the four PNGs regenerated (`assets/icons/{icon,tray,tray@2x}.png`, `build/icon.png`); the Windows `.ico`/taskbar icon is derived from `build/icon.png` at package time. The in-app surfaces (sidebar `.rail-brand .mark`, launcher/popup avatars, onboarding, reminder popup) were **already** orange via the `--accent` CSS token (`#f97316`) — the only blue asset was the icon PNG set, now orange. Verified the packaged `release/win-unpacked/resources/icons/icon.png` renders orange.

**Files changed.** Engine/core: `core/scheduling/rrule.ts`, `core/scheduling/next-occurrence.ts`, `core/time/format.ts`, `core/parsing/parse-reminder.ts`, `core/types/ipc.ts`. Main: `electron/scheduler/scheduler.ts`, `electron/database/reminder-repository.ts`. Renderer: `src/lib/ipc.ts`, `src/features/schedules/{SchedulesScreen,ReminderEditor,repeat}.tsx?`, `src/styles/global.css`. Branding: `scripts/gen-icons.mjs` + the 4 PNGs. Tests: `tests/unit/next-occurrence.test.ts` (rewritten for the new shape + monthly/yearly/interval/COUNT/UNTIL), `tests/integration/scheduler.test.ts` (+COUNT/UNTIL completion), `tests/renderer/repeat.test.tsx` (new — UI helper + `rruleToHuman`), `tests/renderer/reminder-editor.test.tsx` (new — the create/edit component; the edit case is a regression net for the seed fix below).

**Edit-seed fix (caught in review).** The editor initially seeded its date/time from `scheduledAt`, which is the immutable anchor (occurrence #1) and is in the **past** for any recurring reminder that has already fired — so saving an edit tripped the "that time has already passed" guard and made running recurring reminders un-editable. Fixed by seeding from `nextFireAt` (the upcoming occurrence, always future for a pending reminder). Trade-off (intended, since an edit is an explicit re-arm): editing a bounded reminder re-anchors its COUNT origin to the next occurrence.

**Verification.** `typecheck` ✅ (node + web) · `lint` ✅ 0 errors (pre-existing warnings only) · `build:win` ✅ (NSIS + portable re-signed; preload-chunks invariant intact) · `test` ✅ **556 / 57 files**. The engine (one-time, daily, weekly, multi-weekday, every-N, monthly with 31st-clamp, yearly, COUNT-exhaustion → completed, UNTIL → completed) and the UI rule-builder are covered by unit + integration tests against a real SQLite DB. Reminder **persistence across restart** is inherent (the RRULE + anchor live in `lifeos.db`; the scheduler reconciles from the DB on startup) and covered by the existing scheduler/repository integration suites.

> **GUI-drive gap (honest):** the packaged Electron app's create→edit→fire flow was **not** driven end-to-end in this environment (no display/notification surface here). It's verified by construction — the recurrence engine and the form→rule translator are unit/integration-tested, the fire path is unchanged from the already-verified scheduler, and the installer was rebuilt from the same green tree. A manual Windows pass (create each repeat type, edit one, watch a daily fire, restart) is the remaining check before calling packaged parity confirmed.

### 2026-07-15 — UX writing & content audit (app-wide copy pass)

**Summary.** A full UX-writing pass over every user-facing instructional string in the renderer (`src/`) plus shared voice copy. Goal: make the app read as friendly, professional, trustworthy, human, and privacy-first — written in one consistent voice — **without hiding what actually happens**. The trigger was the OpenAI consent dialogs, which led with alarming, data-transfer-first phrasing (*"Send my voice to OpenAI"*) even though the feature is safe and opt-in. Copy only, plus one copy-driven render conditional (the Gmail AI-summaries note is gated on `gmailAiSummaries`); no behavioral logic changed. Full plan + lexicon: **`docs/lifeos-planning/ux-writing-audit.md`**.

**Approach (documentation-first).** Locked a **terminology lexicon** before editing (the biggest lever for "sounds like one designer"), then applied it everywhere. Retired the four different phrasings of local storage (*on your computer / on this device / on your machine / on-device*) in favor of **"on your device"**; retired three names for the OpenAI chat feature (*Yogi's intelligence / Chat & answers / AI Assist*) in favor of **"AI chat & answers"**; made the three consent buttons **parallel** (*Turn on OpenAI …*).

**Accuracy guardrails (softening ≠ hiding).** Every consent dialog still discloses exactly what leaves the device: the AI dialog keeps the "reminder titles + rough due times go to OpenAI" disclosure; all three keep "uses your own API key, billed to your OpenAI account." Reassurances are scoped to what the code guarantees — no blanket "nothing is stored" (Gmail and reminders *are* stored locally by design); STT/TTS copy says audio "isn't saved to disk," which is true.

**Priority consent dialogs — before → after.**

| # | Before | After |
| --- | --- | --- |
| STT lead | **Your voice recording is sent to OpenAI to transcribe it.** | **OpenAI turns your speech into text, using your own API key.** |
| STT button | Send my voice to OpenAI | **Turn on OpenAI transcription** |
| AI title | Use OpenAI for chat & answers? | **Turn on AI chat & answers?** |
| AI lead | **Your command text is sent to OpenAI.** | **Your messages are answered by OpenAI, using your own API key.** |
| AI button | Send my messages to OpenAI | **Turn on OpenAI chat** |
| TTS lead | **The text Yogi speaks is sent to OpenAI to generate the voice.** | **OpenAI creates Yogi's natural voice, using your own API key.** |
| TTS button / title | Use OpenAI voices | **Turn on OpenAI voices** (title now "Turn on OpenAI voices?") |

**Other rewrites (representative).**
- **Section titles:** "Yogi's intelligence (OpenAI)" → **"AI features (OpenAI)"**; "Integrations · Google Gmail" → **"Gmail (optional)"**; toggle "Chat & answers (AI Assist)" → **"AI chat & answers"**.
- **Provider dropdowns:** "Offline — on-device (default)" → "On your device (default)"; "OpenAI — cloud, more accurate" → "OpenAI — more accurate" (STT + TTS parallel).
- **Onboarding:** "Everything stays on this device" → "…on your device"; privacy bullets reworded ("no tracking of any kind", "turned into text right on your device"); "Two things to know" → "Two quick things to know" with warmer mic/tray copy.
- **Privacy (Settings):** "No telemetry" → "no tracking"; wording unified to "on your device".
- **Gmail:** privacy line unified ("your email stays on your device"), added an honest one-line note when AI summaries are on ("Summaries are created by OpenAI from your email, using your own API key. You can turn this off anytime.").
- **Rail chip:** "🔒 Offline · on-device" → **"🔒 On your device"**; tooltips reworded. **Offline banner:** "Offline mode." → "Working offline." with clearer follow-through. **Paused banner, overdue modal, reset dialog, empty states (Schedules/History)** all warmed and made consistent.

**Files changed (copy only, no logic):** `src/features/settings/{OpenAiKeySection,VoiceSection,GmailSection,SettingsScreen}.tsx`, `src/features/onboarding/OnboardingFlow.tsx`, `src/features/chat/ChatScreen.tsx`, `src/features/reminders/OverdueModal.tsx`, `src/features/schedules/SchedulesScreen.tsx`, `src/features/history/HistoryScreen.tsx`, `src/app/App.tsx`. New doc: `docs/lifeos-planning/ux-writing-audit.md`.

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 errors (14 pre-existing warnings unchanged) · `build` ✅ (preload-chunks invariant intact) · `test` ✅ **523 / 55 files** (unchanged — no test asserts on the reworded UI strings, confirmed by grep before editing).

**Screenshots.** Not included — this environment has **no display/GUI surface** to render the Electron app (the same standing limitation noted throughout this log). Substituted with the before/after tables above and the manual test steps below.

**Manual test steps (Windows, running app).**
1. **Fresh onboarding** — delete local data (or first run), step through all three panes; confirm the privacy pane reads "Everything stays on your device" and no "computer/machine" wording remains.
2. **AI chat consent** — Settings → AI features (OpenAI) → add a key → toggle "AI chat & answers" on; confirm the dialog title "Turn on AI chat & answers?", the lead line, the preserved reminder-titles disclosure, and the button "Turn on OpenAI chat". Cancel and confirm it doesn't enable.
3. **STT consent** — Speech-to-text → choose "OpenAI — more accurate"; confirm "Turn on OpenAI transcription" button and the "isn't saved to disk" reassurance.
4. **TTS consent** — Voice → Voice output → "OpenAI — more natural"; confirm "Turn on OpenAI voices?" title + button; Play sample.
5. **Gmail** — confirm "Gmail (optional)" header, the unified privacy line, and (with a key + summaries on) the OpenAI-summaries note.
6. **Offline surfaces** — with no key, confirm rail chip "🔒 On your device", the Chat "Working offline" banner, and Settings → Speech "runs entirely on your device".
7. **Empty states / modals** — Schedules + History empty text; fire an overdue catch-up; open the reset dialog; confirm the warmer, consistent wording.

### 2026-07-14 — Desktop voice launcher: response arc made visible + state-machine coverage

**Summary.** Made the floating desktop voice launcher (Alt+Shift+Space) the primary voice surface end-to-end. The launcher previously **hid itself the instant you pressed Send**, so the entire response arc — Searching, Thinking, the AI reply, and the *Stop speaking* control — happened on a hidden window and was never seen. It now stays visible through `sending → searching → complete → speaking` and returns to its hidden resting (idle) state only when TTS finishes. Verified the rest of the shortcut state machine (Issue A) was **already correct** and left it unchanged.

**Features completed / verified (no change needed).**
- **Global shortcut `Alt+Shift+Space`** with a 400 ms debounce that ignores OS key-repeat; first press creates a NEW conversation + opens the launcher + begins listening; second press stops + finalizes STT + enters Review; a press while `processing`/`sending` is ignored; a press while `speaking` stops TTS and starts a fresh recording.
- **No duplicate / no empty conversations** — `startListening` deletes a prior 0-turn session before creating the next; `discardTranscript` deletes the empty session; a session that has a real turn is preserved.
- **Electron window posture** — frameless, transparent, always-on-top (`screen-saver`), `skipTaskbar`, `showInactive()` (never steals focus), click-through toggled via `setIgnoreMouseEvents`/`setFocusable` on hover + interactivity, draggable grip with clamped, persisted position.

**Features fixed.**
1. **Send now keeps the launcher visible** through the whole response arc (was: `win.hide()` fired inside `sendTranscript`). Searching/Thinking, the reply, and *Stop speaking* are now on-screen — satisfying Issue B (Send) and Flow 1.
2. **Idle == hidden, decided explicitly.** The launcher's natural resting state is hidden (created `show:false`, only shown by `startListening`), so `speaking → idle` (TTS finished) now hides the window. This also removed a papercut where an enabled-but-dead Send button lingered after the arc.
3. **Response phases render a compact status+reply+stop view**, not the editable review form. The window is a fixed 180 px; rendering the full form *and* the reply/stop would overflow and clip the reply and *Stop speaking* button off the bottom. The reply is now the flex-shrinking, scrollable region and *Stop speaking* is pinned — so it can **never** be clipped regardless of reply length.
4. **Empty-transcript recovery.** If STT returned an empty final transcript, the controller was left stuck in `processing` (recoverable only via ✕/Esc). The launcher now enters Review on an empty result so the user can dismiss or type.
5. **Dismiss/✕/Escape now silences TTS.** A direct consequence of un-hiding: the launcher can be dismissed *while Yogi is speaking*, and previously that hid the window but left speech running with no visible Stop control. `discardTranscript` now calls `stopSpeaking()` first. (Safe: in the speaking case the session holds a real turn, so the empty-session cleanup correctly does not delete it.)
6. **Lint gate unblocked** — an unused `payload` param in the launcher's browser dev-mock (`src/launcher/main.tsx`) was tripping `no-unused-vars`; prefixed to `_payload`.

**Exit-condition wiring verified (the fix's load-bearing dependency).** Hide-on-idle now routes entirely through `setSpeaking(false)`, so the launcher only leaves `speaking` when TTS reports completion. Both playback paths in `src/audio-host.ts` were read and confirmed to emit `audio:playing(false)` on **end, error, pause, and abort** — OS `speechSynthesis` (`onend`/`onerror`/cancel) and the OpenAI MSE stream (`ended`/`pause`/`error` via `trackPlayback`, plus explicit `setPlaying(false)` in `ttsAbort`). Main's `stopSpeaking()` also calls `setSpeaking(false)` directly (not only via the audio round-trip), so the Stop-button, ✕/Escape, and next-shortcut paths always exit `speaking` too.

**Files changed.**
- `electron/main/desktop-voice/controller.ts` — removed `win.hide()` from `sendTranscript`; hide the window on the `speaking → idle` transition in `setSpeaking(false)`.
- `src/launcher/LauncherApp.tsx` — added `isResponse` branch (compact response view) mutually exclusive with the review form; empty-transcript → Review recovery effect; dropped the now-redundant bottom-of-card note/reply/stop duplicates.
- `src/launcher/launcher.css` — `.launcher-response` flex region; `.launcher-reply` shrink+scroll; `.launcher-stop` pinned (`flex:0 0 auto`).
- `src/launcher/main.tsx` — `_payload` lint fix.
- `tests/unit/desktop-voice-controller.test.ts` — **new**, 14 tests encoding Issue A + Issue B (this file is both the Phase-2 reproduction and the Phase-9 regression net).

**Architecture changes.** None. Same IPC surface, same channels, same controller/renderer split; only the visibility lifecycle of the existing launcher window changed. The launcher window is still absent from the top-level architecture diagram — a doc gap to close in the next full snapshot.

**Regression results (all green).**
- `npm run typecheck` — pass (node + web).
- `npm run lint` — 0 errors (12 pre-existing `any` **warnings** remain in the launcher dev-mock; non-blocking).
- `npm run build` — pass; sandboxed-preload invariant intact (`out/preload/chunks` absent).
- `npm run test` — **266 passed / 29 files** (was 252 / 28; +14 from the new controller test).

**Testing performed.** Full automated suite above, plus a focused unit run of the new controller test. The state machine (shortcut presses, debounce, send/dismiss, speaking→idle hide, dismiss-stops-TTS, empty-transcript recovery, no-duplicate/no-empty sessions) is covered by injectable-deps unit tests, and the TTS-completion → hide wiring was verified by reading both audio playback paths (above).

> **HARD GAP — end-to-end GUI flow NOT executed in this environment.** The launcher is global-shortcut-triggered and depends on live mic capture, on-device STT, and TTS audio playback with a human in the loop; it also registers a system-wide `Alt+Shift+Space` and lives in the tray. There is no display/screenshot/browser-automation surface here to observe or drive it, so **Phase 3 ("every transition must work") and the Phase 9 manual items (shortcut, recording, review, dismiss, send, thinking, TTS, multiple consecutive recordings) have not been run against the real app.** They are verified *by construction* (unit tests + code trace of the TTS-completion wiring) and the no-clip guarantee is *structural* (flex-shrink reply + pinned Stop button under a fixed-height `overflow:hidden` parent), but a **manual Windows pass on the running app is still required before this is considered fully done.**

**Known issues / remaining work.**
- **Manual GUI verification pending** — drive the real Electron app on Windows: shortcut → record → review → Send → Searching/Thinking → reply → TTS → Idle, and the Dismiss path; confirm the compact response view is unclipped for a long (multi-line) reply and that *Stop speaking* works.
- **TTS-disabled tail** — with Voice off there is no `speaking` phase, so the arc ends at `complete` and the launcher stays visible showing the reply until the user dismisses or starts a new recording. Intended (the reply needs to be readable without audio), but worth a product confirmation.
- Launcher not represented in the architecture diagram / no dedicated launcher doc yet.

**Next recommended tasks.**
1. Manual Windows GUI pass of both flows (above) — the only verification gap.
2. Add the launcher to the architecture diagram and, if it is staying, give it a short design note (states, window posture, IPC).
3. Consider a lightweight `LauncherApp` render (jsdom) test for the phase→view mapping if the renderer logic grows.

### 2026-07-14 (cont.) — Conversation continuity + launcher redesign (Reminder-panel design) + live voice bars

**Summary.** Three follow-up requests: (1) the launcher was starting a **brand-new chat on every send** — fixed at the root with a shared active-conversation pointer; (2) redesigned the floating launcher to reuse the **Reminder popup's design language** (position, radius, shadow, slide-in); (3) made the voice bars driven by **real microphone volume** and stop the instant recording ends.

**1 — Conversation continuity (root cause + fix).**
- **Root cause:** `DesktopVoiceController.startListening()` called `chat.createSession()` **unconditionally** on every launch, so each voice session was a new chat. After each turn the controller also nulled its session, guaranteeing a fresh chat next time.
- **Fix — a single shared `activeSessionId` pointer** (owned by main, `electron/main/index.ts`). `startListening` now resolves: shared pointer (if the chat still exists) → most-recent chat (cold-start fallback) → create only when there are **no** chats. The pointer moves only on deliberate navigation. A "most-recent" heuristic was explicitly rejected because `recordReminderDelivery` bumps a chat's `updated_at` — a fired reminder would otherwise hijack which conversation the launcher continues.
- **Two-way sync:** the main window reports its open chat via a new `chat:activeSessionSet` channel (`useSessions` → main), so "+ New chat" and manual selection in the sidebar move the pointer; the existing `launcher:sessionActivated` keeps the main window following the launcher. Pointer-only (no broadcast back) → no echo loop.
- **Data-safety corrections that the continuity change forced:** `discardTranscript` **no longer deletes** the session (it is the shared active chat — deleting it on Dismiss was a data-loss bug); `startListening` no longer deletes "empty" sessions (it no longer creates per-launch empties). The pointer is **not** nulled on idle/dismiss/speaking→idle — that's what preserves continuity.
- **Requirement reversal noted:** this deliberately **reverses** the earlier Issue-A "third press starts a NEW conversation." The 15-test controller suite was updated in lockstep (continuity, N-sends-one-chat, cold-start, New-Chat-pointer, dismiss-keeps-chat).

**2 — Launcher redesign (Reminder-panel design language).**
- Window (`electron/main/windows.ts`): width **384** (= `POPUP_WIDTH`), height 240, positioned **bottom-right of the active display with a 16px margin on every show** (new `positionLauncherBottomRight`, a clone of `positionPopupBottomRight` — tracks multi-monitor / taskbar changes), shown via `showInactive()` (never steals focus).
- Card (`src/launcher/launcher.css`): rewritten to match `.popup` — `border-radius: 14px`, `box-shadow: 0 12px 32px rgba(0,0,0,0.28)`, `background: var(--surface)`, 6px card margin, 12–14px padding, and the **same slide-in** (`translateX(24px)→0`, 220ms `cubic-bezier(0.16,1,0.3,1)`) with a reduced-motion fade. Header mirrors `.popup-head` (accent ● + "Yogi" + status + ✕). Orange branding via `--accent`.
- Appearance/disappearance parity: the card **remounts on each show** (`if (phase==='idle') return null`, mirroring the popup's `if(!data) return null`) so the entrance animation replays every time.
- **Drag removed** (the popup isn't draggable) — cleanly: deleted the renderer drag handlers, the `launcher:positionChanged` channel + handler + preload method + `window.d.ts` type, and the `moveTo`/saved-position window API. Positioning is now fixed bottom-right like the popup.

**3 — Voice visualization.**
- Bars are driven purely by the live mic RMS (`speech.volume`), no fixed loop, and are rendered **only while listening** — so they stop the instant recording ends.
- On recording end the UI transitions to a smooth **Thinking / Searching / Transcribing / Speaking** dot indicator (reuses the global `.typing` dots, same as the popup).

**Files changed.**
- Continuity: `electron/main/desktop-voice/controller.ts`, `electron/main/ipc/launcher.ts`, `electron/main/ipc/chat.ts`, `electron/main/index.ts`, `core/types/channels.ts`, `electron/preload/index.ts`, `src/lib/ipc.ts`, `src/types/window.d.ts`, `src/features/chat/useSessions.ts`.
- Redesign / voice viz: `electron/main/windows.ts`, `src/launcher/LauncherApp.tsx`, `src/launcher/launcher.css`, `electron/preload/launcher.ts`.
- Tests: `tests/unit/desktop-voice-controller.test.ts` (rewritten, 15 tests, continuity-aware).

**Regression results (all green).** `typecheck` ✅ · `lint` ✅ 0 errors (12 pre-existing dev-mock `any` warnings) · `build` ✅ (preload-chunks invariant intact) · `test` ✅ **267 / 29 files**. App boots clean; shortcut registers.

**Known issues / open items.**
- **Live GUI drive of the redesign is the last gate** (in progress) — confirm bottom-right position + 16px margin, slide-in on each show, the review/response layout is unclipped at 384×240, and voice bars react to the mic.
- **TTS audibility remains OPEN and unverified** from the prior thread ("can't hear what Yogi said"). These changes do not touch the audio path and `onSpeak` still fires per turn, but whether Yogi is actually audible from the launcher was never confirmed — it should be isolated (Settings → Voice → Preview vs launcher) in the next pass.
- Launcher still absent from the architecture diagram.

### 2026-07-14 (cont. 2) — Launcher↔main-chat live sync + web-search visibility + empty-state guidance

**1 + 2 — Launcher messages (and their web-search results) not appearing in the main chat.**
- **Root cause (one bug, two symptoms):** `useConversation` (the main chat) has **no live listener for turns it didn't send** — it appends only its own `send()` results plus reminder deliveries. It relied on *session re-hydration*: before the continuity fix, a launcher message went to a **new** session, so `launcher:sessionActivated` forced a session switch → `useConversation`'s `[sessionId]` effect re-ran → re-loaded turns from the DB → the launcher turn appeared. The continuity fix made the launcher reuse the **already-open** session, so `select()` became a no-op → no re-hydration → the persisted launcher turn (its user transcript **and** Yogi's reply, web-search results included) never rendered live. **This is a regression the continuity change introduced, not a pre-existing bug.** Web search itself was never broken — the launcher uses the **exact same `ConversationEngine.run()` pipeline** (`controller.sendTranscript → engine.startTurn`), tools and all; issue #2 was the same invisibility, so the search answer + sources simply never reached the main chat.
- **Fix — mirror the completed launcher turn into the open chat.** `DesktopVoiceController.markTurnDone(turnId)` already runs **only for the launcher's own turn** (`activeTurnId === turnId` guard). It now loads that turn from the DB (new `ChatRepository.getTurn`) and broadcasts `chat:turn:appended {sessionId, turn}`. `useConversation.onTurnAppended` appends it **iff it's the open chat**. Because the guard means the main window's **own** sends never emit this event, there is **no double-append and no dedup needed** — the elegant part of the fix. Messages use turn-id-derived keys (`t-<id>-u/-a`) with an idempotency guard; `searching` is reset on append (a launcher web search fires `chat:searching` globally with nothing else to clear it).
- **Deliberately text-only:** a launcher reminder *proposal* is not reconstructed as a live card here (that would misrender a `pending` proposal as `cancelled` via `turnsToMessages`' restart-fail-safe). Launcher proposals settle via voice-confirm (`action:resolved`), which `useConversation` already reflects.

**3 — Empty main-chat guidance.** The existing empty-state (`launcher-first`) now leads with **“Start a voice conversation — press `Shift` + `Alt` + `Space` anywhere,”** styled with `<kbd>` keys + the accent mark, explaining the shortcut launches Yogi and starts listening. It's gated on `messages.length === 0`, so it self-dismisses the moment the first (now-synced) turn lands.

**Files changed.** `electron/database/chat-repository.ts` (`getTurn`), `electron/main/desktop-voice/controller.ts` (mirror broadcast), `src/features/chat/useConversation.ts` (live chat-turn append), `src/features/chat/ChatScreen.tsx` + `src/styles/global.css` (empty-state), `tests/unit/desktop-voice-controller.test.ts` (+1 live-sync invariant test → 16).

**Regression results.** `typecheck` ✅ · `lint` ✅ 0 errors · `build` ✅ (preload-chunks invariant intact) · `test` ✅ **268 / 29 files**.

**Validation.** Automated above. **Live drive still required** and, per review discipline, **#2 must be confirmed empirically** — a real web-search query from the launcher must appear **in the main chat with sources**, not merely return a reply. (In progress.)

**Known related surface (out of scope, named so it's not a surprise):** the **reminder popup** writes chat turns to sessions through the same path and has the **identical non-sync gap** — a popup chat won't live-appear in the main window either. Same fix pattern would apply if wanted.

### 2026-07-14 (cont. 3) — Real-time launcher↔main sync protocol, launcher as a live compact chat, web-search status

**1 — Web-search status (two distinct problems).**
- **(a) Search not firing (engine trigger).** The dev log is decisive: `reply-only: flag=false wantsSearch=false provider=y` — the model neither set `needsWebSearch` nor matched `LOOKUP_REPLY_RE`, so **no search ran** and the user was stranded on the model's own text. `web_search_enabled=true`, so this is an under-triggering problem, NOT the sync. **Deferred pending the exact failing query** (per review discipline — not fixing the trigger blind); the specific reply text decides whether to broaden the regex or force search on uncertain question-intent.
- **(b) Status not shown in both windows (the sync).** Root cause: `chat:searching` carried **no `sessionId`**, so a non-originating window couldn't associate it, and only the originating window showed searching. **Fixed** by the protocol below: a turn's "searching" state now shows as a live placeholder in **both** the launcher and the main chat, and is replaced by the reply (or a degrade message) on completion.

**2 + 3 — Launcher shows the conversation, and both surfaces stay synchronized.**
- **Root cause:** the launcher only ever showed its own single reply; the main chat only appended turns *it* sent. There was no real-time, cross-window conversation stream — completed-turn sync was one-way (launcher→main), and in-flight (thinking/searching) sync didn't exist.
- **Fix — one broadcast protocol, both windows are subscribers:** all chat turns now flow through a single main-process entry point (`startChatTurn`) used by BOTH `chat:send` and the launcher. It emits, session-scoped:
  - `chat:turn:started {sessionId, turnId, userText}` — the user's message + a live "thinking" placeholder.
  - `chat:searching {turnId, sessionId}` — flips that placeholder to "🔎 Searching the web…".
  - `chat:turn:appended {sessionId, turn}` — resolves the placeholder to the final reply (web-search sources included).
  - `chat:started`/`appended` are broadcast **except the originating window** (`fanoutExcept`), so a window that already shows its own turn optimistically (the main chat's `send()`) is not double-rendered — **no dedup, no race**. The **launcher passes no originId** and renders as a *pure subscriber* (no optimistic list), so it also receives its own turn's events → one code path, one conversation.
- **Launcher UI (Issue 4 fit):** the launcher is now a compact chat that reuses the reminder-popup design language — a scrollable message list (`.launcher-scroll`, mirroring `.popup-scroll`) that auto-scrolls to the newest message, with the voice composer (mic bars / review / send / dismiss / stop-speaking) docked below. Same 384-wide card, 14px radius, `0 12px 32px` shadow, slide-in-from-right, bottom-right + 16px margin, remount-on-show. Window grew to 380px to hold the conversation + composer. Voice bars remain mic-RMS-driven; thinking/searching render as bubbles in the list.
- **Streaming:** N/A — `chat:delta` is idle; replies are non-streamed. No streaming sync built.

**Files changed.**
- Protocol (main): `core/types/channels.ts` (`chat:turn:started`), `electron/main/index.ts` (`fanoutExcept`, `turnMeta`, `startChatTurn`, engine callbacks emit started/searching+sessionId/appended-except-origin), `electron/main/ipc/chat.ts` (`startTurn` dep + origin), `electron/main/desktop-voice/controller.ts` (route send through `startTurn`, drop the controller-only mirror), `electron/main/ipc/launcher.ts`.
- Preload/bridge: `electron/preload/index.ts`, `electron/preload/launcher.ts` (`turns`, `onTurnStarted`, `onTurnAppended`), `src/types/window.d.ts`, `src/lib/ipc.ts`.
- Renderers: `src/features/chat/useConversation.ts` (in-flight mirror + placeholder resolve), `src/features/chat/MessageBubble.tsx` + `conversation-types.ts` (`pending` render), `src/launcher/useLauncherMessages.ts` (**new** — launcher live conversation), `src/launcher/LauncherApp.tsx` (rewritten: list + composer), `src/launcher/launcher.css`, `electron/main/windows.ts` (height 380).
- Tests: `tests/unit/desktop-voice-controller.test.ts` (origin routing), `tests/renderer/useConversation.test.tsx` (mock `onTurnStarted`).

**Regression results.** `typecheck` ✅ · `lint` ✅ 0 errors · `build` ✅ (preload-chunks invariant intact) · `test` ✅ **267 / 29 files**.

**Validation.** Automated above. **Live drive REQUIRED** and the acceptance criteria must be confirmed on screen — including a real web-search query showing **sources in BOTH windows**, and messages appearing in both the launcher and the main chat in real time. (In progress.)

**Known limitations / open items.**
- **Issue 1a (search firing) is unresolved pending the exact failing query** — the sync makes the *status* visible in both windows, but a turn the model declines to search still won't search. This is the oldest still-open thread alongside **TTS audibility** (never confirmed).
- The reminder popup still isn't a subscriber to this stream (out of scope; same pattern would extend it).
- Launcher-only "New chat" affordance still absent (main-window sidebar only).

### 2026-07-14 (cont. 4) — ROOT CAUSE: web search never ran for `research`-intent queries

**Why the pipeline stopped after "Let me look that up…" (the actual root cause).** Web search lives **only inside the `if (isReplyOnly(intent))` branch** of `ConversationEngine.run()`. But `REPLY_ONLY_INTENTS = ['chat','question','unknown']` — and **`'research'` is an ACTION intent**. The system prompt itself told the model to classify look-ups ("top X", "latest news", contacts, prices, weather) as **`'research'`** and to reply "Let me look that up." So the very queries that most need search were classified `research` → took the **else/action** branch → no `onSearchStart` (no "Searching…" indicator), no search tool call, no answer; the parser couldn't build a reminder, so the engine just broadcast the model's raw `reply` ("Let me look that up…") and the turn ended. No error, because nothing failed — the search was simply **never reached**. (Reply-only turns that *did* log `flag=false wantsSearch=false` were a second, milder mode: the model answered `question`-intent directly without flagging search.)

**Where exactly it stopped (per the requested pipeline trace):** User message → engine → LLM classifies `intent='research'` → **`isReplyOnly('research')` is false → search branch skipped** → tool never selected/invoked → model's acknowledgement broadcast as the final reply. It stopped at *tool selection*, before any search call.

**Fix (logic, not UI).**
1. **Routing** (`electron/conversation/conversation-engine.ts`): the answer branch is now `if (isReplyOnly(intent) || intent === 'research')`, and `wantsSearch` is **forced true for `research`** (`intent === 'research' || turn.needsWebSearch || LOOKUP_REPLY_RE.test(reply)`). So a research turn always calls the (already-working) search tool, fires `onSearchStart` → "🔎 Searching the web…" in **both** surfaces (via the sync protocol), and answers with sources.
2. **No dead ends** (same file): when a turn wants search but the provider is off/not consented, the reply is now an honest "web search is turned off — enable it in Settings" instead of stranding on "Let me look that up…".
3. **Prompt** (`core/conversation/system-prompt.ts`): `'research'` is now described as an explicit *web-lookup* intent (news, weather, prices, "top X", contacts), so the model uses it deliberately — and it now correctly triggers search.

The search **provider was never broken** (`OpenAiSearchProvider` has its own 30s timeout + honors the abort signal; the earlier `web_search: answered (1 sources)` proves it works once reached). This was purely a routing/classification gate.

**Files changed.** `electron/conversation/conversation-engine.ts`, `core/conversation/system-prompt.ts`, `tests/unit/conversation-engine.test.ts` (+2: research-forces-search, research-no-provider-honest-message).

**Regression results.** `typecheck` ✅ · `lint` ✅ 0 errors · `build` ✅ · `test` ✅ **269 / 29 files**.

**Validation.** Unit tests lock the routing. **Live confirmation pending** — a `research` query should now log `answer: intent=research … wantsSearch=true` → `web_search: q="…"` → `web_search: answered (N sources)`, show "Searching the web…" in both windows, and return an answer with sources.

### 2026-07-15 — Release hygiene: installer verified credential-clean + dev/packaged profile isolation

**Concern:** an installed build showed the developer's OpenAI key + Gmail credentials — "a fresh install must contain no personal data."

**Investigation (installer is CLEAN — not a blocker):** all user data lives ONLY in `app.getPath('userData')` → `lifeos.db` (settings, reminders, history, chat, DPAPI-encrypted OpenAI key + Gmail id/secret/tokens). The installer packages none of it — `electron-builder.yml` `files: [out/**/*, package.json]`; `build/` has only `icon.png` (no `installer.nsh`, so NSIS install = extract files, writes nothing to `%APPDATA%`). Verified the actual packaged payload `release/win-unpacked/resources/app.asar` — **no `.db`, no email/token/secret strings**. Secrets are user-entered and DPAPI-encrypted (tied to the Windows user → undecryptable on another machine even hypothetically). **Root of the confusion:** `app.setName('LifeOS')` made BOTH dev and packaged resolve to the same case-insensitive `%APPDATA%\LifeOS`, so a dev's local profile appeared inside an installed build on the *same* machine.

**Fix (dev/packaged profile isolation).** `electron/main/index.ts` (after `app.setName`): `if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'LifeOS-dev'))`. Dev → `%APPDATA%\LifeOS-dev`; packaged → canonical `%APPDATA%\LifeOS`. `reset-guard.ts` accepts the new dir name (+ test). On this machine the historical `%APPDATA%\LifeOS` was renamed to `LifeOS-dev` (dev keeps its data; the installed app now reads an empty `LifeOS`).

**Empirically verified:** launched `win-unpacked/LifeOS.exe` → fresh `%APPDATA%\LifeOS\lifeos.db` created with `ai_key_ciphertext`/`gmail_*` **empty**, 0 reminders, 0 chat_turns; the dev profile `%APPDATA%\LifeOS-dev` retains the key/Gmail/1 reminder/8 turns. **Gates:** typecheck ✅ · lint ✅ 0 errors · **524 tests** ✅.

**Note:** the existing `LifeOS Setup 0.1.0.exe` already installs clean (packaged behavior unchanged — it always used `%APPDATA%\LifeOS`); the code change only isolates the DEV harness. Rebuilding the installer is optional (only affects developers who run both dev and packaged on one machine).

### 2026-07-14 (cont. 5) — Capability-based router: offline mode & offline reminders fixed

**Root cause (verified end-to-end, stated honestly).** The conversation router was **LLM-first**, not capability-first. `ConversationEngine.run()` calls the cloud LLM for every turn; only when **no provider** is configured does it fall back to `ChatTurnService`, a **reminder-only** local handler. Anything the reminder parser's `detectIntent` doesn't recognise returned the generic *"Connect OpenAI in Settings to chat and answer questions."* Reproduced through the real engine offline (`provider: () => null`): `[what time is it] → "Connect OpenAI…"`, and a two-turn reminder `["remind me to drink water"] → clarification`, then `["tomorrow at 9 AM"] → "Connect OpenAI…"`. Two failure modes:
1. **Local non-reminder commands** (time, greetings, "open settings") had no local handler → the OpenAI placeholder, though they need no LLM.
2. **Multi-turn reminders broke**: an under-specified reminder correctly returns a clarification, but the follow-up answer ("tomorrow at 9 AM") lacks the "remind" keyword → `detectIntent`=`unknown` → placeholder. Reminders were only completable in one fully-specified sentence.
   *Honest note:* the literal *"remind me in one minute"* returns a **clarification**, not the placeholder; the placeholder reproduces for **non-reminder inputs** and **clarification follow-ups**. The voice launcher shares this engine (`controller.sendTranscript` → `startTurn`), so it had the same behaviour.

**Fix — a capability-based router (the requested architecture).**
- **`core/routing/local-intent.ts`** — a pure, **conservative** classifier (`reminder | time | greeting | help | settings | none`). Matches only *clean, whole* commands; anything with a tail ("what time is it **in Tokyo**", "open settings **and enable dark mode**") returns `none` and falls through to the LLM, so a greedy match never gives a wrong local answer.
- **`electron/main/chat/local-command-router.ts`** — handles local commands with **no LLM**: `time` → local clock/date; `settings` → switches the main window's screen via a new `app:navigate` broadcast; `greeting`/`help` → local reply **offline only** (online returns `null` so the LLM keeps its warmth). Runs **first** in `ConversationEngine.run()` for both modes (the "hybrid: execute the local portion" path).
- **Offline reminder clarification-combine** (`conversation-engine.ts` `pendingReminderContext`): when a turn isn't a reminder on its own but a prior clarification is still pending, the engine threads the accumulated reminder text and re-parses, so the follow-up completes the reminder offline (online this was already handled by the LLM via history). Covers voice, since the launcher uses the same engine.
- **Honest messaging** (`chat-turn-service.ts`): the offline non-reminder reply now names what *does* work offline ("I can set reminders and tell you the time offline — but answering that needs an online AI provider…"), reached only for genuine reasoning.
- **Nav channel** (`core/types/channels.ts` `app:navigate`, preload, `App.tsx`): "open settings" switches the main window's screen.

**Files changed.** `core/routing/local-intent.ts` (new), `electron/main/chat/local-command-router.ts` (new), `electron/conversation/conversation-engine.ts` (router-first + `pendingReminderContext` + combine), `electron/main/chat/chat-turn-service.ts` (honest message), `electron/main/index.ts` (wire router + navigate), `core/types/channels.ts`, `electron/preload/index.ts`, `src/types/window.d.ts`, `src/app/App.tsx`; tests: `tests/integration/offline-routing.test.ts` (new, end-to-end offline), `tests/unit/local-intent.test.ts` (new), and updated `conversation-engine`/`useConversation` mock references.

**Regression results.** `typecheck` ✅ 0 · `lint` ✅ 0 · `build` ✅ · `test` ✅ **352 / 39 files** (+18). New tests lock: local time/greeting answered offline, **two-turn AND recurring** reminders complete offline (recurrence + title stay clean), honest reasoning notice, the classifier's conservative whole-command matching, and **online composition** (a local command is intercepted with the LLM *not* called; questions/greetings still reach the LLM online).

**Validation — precise.**
- **Tested at the engine level (this change):** hello / what time is it / open settings / two-turn + recurring reminders complete offline / online-still-reaches-LLM. Driven through the **real** `ConversationEngine` (`provider: () => null`) + real router.
- **Unchanged this session, covered by existing tests:** the scheduler / trigger-sink / persistence / STT-provider layers were not touched — "popup fires," "survives restart," and "offline STT still works" are not new risk.
- **Genuinely unverifiable here (no mic/display):** live microphone capture and the real popup/launcher window render. Those are the only residual manual checks.

### 2026-07-14 (cont. 6) — Offline STATUS indicator fixed + real-wiring verification

**The badge lied.** A screenshot with no key still showed **`☁ OpenAI`** in the sidebar. Root cause: the chip keyed off provider *selection* (`sttProvider === 'openai' || ttsProvider === 'openai'`) — and Voice-output was set to OpenAI — instead of actual runtime capability. With **no API key nothing can reach the cloud** (the zero-outbound-packets guarantee), so the app was fully offline while the UI claimed OpenAI.
- **Fix** (`src/app/App.tsx`): the chip is now driven by `settings.hasApiKey` → **`🔒 Offline · on-device`** with no key, `☁ OpenAI connected` with one. The key is the single gate for *every* cloud feature (STT-cloud, TTS-cloud, LLM, search), so it's the honest signal.
- **In-chat banner** (`ChatScreen`, `App.tsx`, `global.css`): when offline, the Chat screen shows *"🔒 Offline mode. Reminders, the time, and your schedule work with no internet. Add an OpenAI key in Settings for chat & web answers."* — so offline state is clear where the user actually types, not just the rail.

**Real-wiring verification** (`tests/integration/offline-wiring.test.ts`, new, 5 tests): builds the production graph the way `index.ts` does — a **real SQLite DB with no key**, the real `makeLlmProvider` gate, real `ConversationEngine` + router + parser + repositories — and proves: `makeLlmProvider` returns **null** with no key (app offline); local commands answer locally (never "Connect OpenAI"); a reminder **parses → persists → is schedulable** offline; a recurring reminder persists with its RRULE; genuine reasoning gets the honest notice. This closes the "I don't trust the routing actually works" gap through the real objects, not mocks.

**Boot check.** Launched the built app (`npm run start`): `[info] startup: database ready …`, `[info] launcher: shortcut Alt+Shift+Space`, **no uncaught/error lines**.

**Regression results.** `typecheck` ✅ 0 · `lint` ✅ 0 · `build` ✅ · `test` ✅ **357 / 41 files** (+5). App boots clean.

### 2026-07-14 (cont. 7) — Confidence-scored local intent parser + the stale-main-process finding

**Reported symptom:** with no key, reminder phrases (e.g. "Remind me to call Biplub after one minute") replied with the offline AI notice. **Finding:** not reproducible in code — a probe + a real-engine integration run of the user's EXACT phrase list shows every reminder phrase produces a card or a local clarification, and time/settings route locally; only "Explain quantum computing" hits the notice. **Root cause of the live symptom:** `npm run dev` hot-reloads the RENDERER (so the new offline banner appeared) but does **not** restart the Electron **main process**, where the engine + router live — so the running app had the new UI over the old routing. A full quit-and-relaunch (or `npm run build`) is required for main-process changes.

**Improvement shipped anyway (the requested robustness upgrade).** `core/routing/local-intent.ts` is now a **confidence-scored** classifier, not a bag of exact regexes:
- **Reminders are SCORED** — a reminder verb (broadened: `remind me`, `ping/nudge/buzz/alert/notify me`, `don't forget`, `wake me`, `set a reminder/alarm`, `make sure I`) + an optional time expression (`in/after N min`, `at 9`, `tomorrow`, `every Monday`, …). Tolerant of word order ("after one minute remind me"), extra words, and STT slop; returns `{intent, confidence}`.
- **Device commands stay whole-command** (anchored) so "what time is it **in Tokyo**" falls through to the LLM instead of a wrong local answer. Added **date** ("what's the date") and **schedules** ("show my reminders" → navigates to Schedules) intents.
- `detect-intent.ts` (the parser's gate) was broadened in lock-step so a phrase the classifier scores as a reminder also PARSES as one (no classifier/parser disagreement → no accidental offline notice).

**Files changed.** `core/routing/local-intent.ts` (scored classifier), `core/parsing/detect-intent.ts` (broadened verbs), `electron/main/chat/local-command-router.ts` (date + schedules + `NavScreen`), `src/app/App.tsx` (offline badge via `hasApiKey` + banner), `src/features/chat/ChatScreen.tsx`, `src/styles/global.css`; tests: `tests/integration/offline-phrases.test.ts` (new — the user's exact list through the real engine), `tests/integration/offline-wiring.test.ts` (new — real DB/no-key/real provider gate), updated `tests/unit/local-intent.test.ts`.

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 · `build` ✅ · `test` ✅ **373 / 42 files**. The user's full phrase list is asserted through the **real** `ConversationEngine` + `makeLlmProvider` gate + repositories on a real SQLite DB with no key — none reach the AI notice; fully-specified reminders (incl. "ping me…"/"wake me…") create cards. Fresh build relaunched — boots clean.

### 2026-07-14 (cont. 8) — THE REAL root cause: offline STT mis-transcribes the reminder cue

**A screenshot (offline, no key) settled it.** The badge correctly showed `🔒 Offline · on-device` (so the new main-process code WAS running), yet reminders failed. The user's message bubble read **"IT REMAINED ME IN ONE MINUTE"**, and the chat history was full of *"REMAINS ME TO CALL…"*, *"IT REMIND ME IN ONE…"*, *"WHO REMIND ME AFTER…"*, *"SAID REMINDER"*. The offline sherpa model **mis-transcribes the reminder cue** — "remind" → "remained"/"remains", extra leading "it/who". The parser needs the literal "remind me", so "remained me…" → `unknown` → the offline AI notice. This was never a routing bug; it was **STT quality + a parser intolerant of STT noise** — exactly the "minor speech-to-text errors" the user flagged.

**Fix — a principled, edit-distance reminder normalizer** (`core/parsing/normalize-reminder.ts`): a bounded Levenshtein detects a token within distance 2 of the *verb* family (`remind`/`reminds`/`reminded`/`reminding`) that is FOLLOWED BY "me", canonicalizes it to "remind me", and drops leading filler ("it"/"who"/"hey yogi"). Run at the top of `parseReminder` and inside the router's reminder scorer, so BOTH detection and extraction tolerate the corruption. Precision comes from the "followed by me" gate: "the **remainder** of 10", "the meeting **remained** on schedule", and the noun "set a **reminder**" are provably untouched. Clean/typed text is returned unchanged (the 56 parse-reminder tests are green).

**Result offline:** "it remained me in one minute" → normalized "remind me in one minute" → a LOCAL reminder clarification (→ completes on the follow-up), never the AI notice. Where STT also drops the title/time, the user gets a local clarification rather than a dead end.

**Files.** `core/parsing/normalize-reminder.ts` (new), `core/parsing/parse-reminder.ts` (normalize first), `core/routing/local-intent.ts` (score on normalized text); tests: `tests/unit/normalize-reminder.test.ts` (new), STT-corrupted cases added to `tests/integration/offline-phrases.test.ts`.

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 · `build` ✅ · `test` ✅ **387 / 43 files**. The exact screenshot phrase "IT REMAINED ME IN ONE MINUTE" is asserted through the real engine → not the AI notice.

**Still recommended (untestable without audio):** bias offline sherpa toward command vocabulary via hotword/keyword boosting so "remind" is transcribed correctly in the first place — the normalizer is the safety net, better STT is the real cure.

### 2026-07-14 (cont. 9) — Offline reminders now CONFIRM (dispatcher + voice-confirm), no longer "stop"

**Symptom:** dictated "remind me in one minute to call Biplub" (STT clean this time), Yogi said *"Here's what I understood."* and **stopped**. **Cause:** the offline path (`ConversationEngine.run` no-provider branch) broadcast a bare EP-2 parse card and never went through the Action Dispatcher — so it did NOT speak the "say yes to confirm" prompt (`onProposeSpeak`) and did NOT arm voice-confirm. Online reminders got all of that; offline reminders were a silent, click-only card with no voice path — a dead end for voice-first use (and no card at all in the text-only launcher).

**Fix:** offline reminders now route through the **same dispatcher path** as online (the dispatcher is LLM-independent — it validates + stores a parser-produced action). A parsed offline reminder → `dispatcher.propose` → a confirmable proposal card **and** a spoken confirm prompt, so a button click **or** a spoken "yes" (the local voice-confirm matcher) completes it. Clarifications/non-reminders still take the EP-2 shell + honest-notice path.

**Files.** `electron/conversation/conversation-engine.ts` (no-provider branch → dispatcher propose + `onProposeSpeak`); tests: an offline-dispatcher unit test in `tests/unit/conversation-engine.test.ts`, and a **complete real-object flow** in `tests/integration/offline-wiring.test.ts` (offline: dictate → real `ActionDispatcher` proposal + spoken prompt → `confirm(turnId)` → reminder **persisted** in the real DB and schedulable).

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 · `build` ✅ · `test` ✅ **389 / 43 files**.

### 2026-07-14 (cont. 10) — Four fixes: stuck loading, reminder voice, LLM refusals, web-search verify

**Issue 1 — offline "thinking" indicator never finished (launcher turns).** Root cause: `ConversationEngine.startTurn` did `void this.run(...)`, and the offline/local path has NO `await` before its broadcast — so the broadcast fired SYNCHRONOUSLY inside `startTurn()`, before `startChatTurn` could set `turnMeta` + emit `chat:turn:started`. That inverted ordering broke the launcher↔main mirror: the other window's placeholder was created but never got `chat:turn:appended` (turnMeta was still empty at broadcast time), so it hung until a chat switch re-hydrated from the DB. **Fix:** defer `run()` to a microtask (`Promise.resolve().then(...)`) so the caller's synchronous setup always completes first. Also enhanced `onTurnAppended` (useConversation) to reconstruct the proposal card LIVE from the mirrored turn (`liveDispatch`), so the pending card → "✓ Saved" appears immediately instead of after a switch. Files: `electron/conversation/conversation-engine.ts`, `src/features/chat/useConversation.ts`; tests: a synchronous-broadcast regression + a live-mirror renderer test.

**Issue 2 — unnatural reminder voice** ("Call… It's time — Call Biplab"). Root cause: TWO speakers — the trigger-sink TTS spoke the raw `r.title` AND the popup spoke "It's time — <title>" — overlapping (deduped only by `speechSynthesis.cancel`, hence the clip). **Fix:** one natural template `spokenReminder(title)` → "Hi there. It's time to <title>."; the popup is the sole speaker when enabled and the sink's TTS stands down (`popupEnabled`), speaking the natural line only when the popup is off. Files: `core/tts/reminder-speech.ts` (new), `electron/main/reminder-popup.ts`, `electron/scheduler/trigger-sink.ts`, `electron/main/index.ts`.

**Issue 3 — online LLM refused a benign request** ("Share a joke" → "I'm sorry, but I can't share jokes."). Root cause: not in our code — it's the model, and the system prompt framed Yogi narrowly as a "reminder app" with a terse "chat — greetings, small talk", which gpt-4o-mini read as scope-limiting. **Fix:** broadened `core/conversation/system-prompt.ts` — Yogi is a genuinely helpful GENERAL assistant/companion (chats, tells jokes, answers questions), explicitly instructed to never refuse ordinary harmless requests and to actually DO what's asked.

**Issue 4 — online web search.** Verified intact (no regression): `makeSearchProvider` is enabled whenever web-search + AI-assist + key + consent are on (all default-on once keyed), wired into the engine's `searchProvider`; the `research`/`needsWebSearch` path runs `OpenAiSearchProvider` (`gpt-4o-mini-search-preview`) and answers with citations. The capability router only intercepts whole-command local intents, so weather/news/research fall through to the LLM/search as intended.

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 · `build` ✅ · `test` ✅ **394 / 43 files**. Live LLM/search behaviour (Issues 3–4) can't be exercised without a key in CI — the wiring is verified; the prompt fix needs a real key to confirm end-to-end.

### 2026-07-14 (cont. 11) — Interruption, missed-reminders, hybrid voice, hint, desktop naming

**Audio session architecture (Issue 1 — conversation interruption).** Before: ONE shared hidden audio window, no owner/mutex; a reminder firing mid-conversation truncated or overlapped the reply, and — a real bug — when the reminder's TTS ended, `audio:playing(false)` routed to `setSpeaking(false)` and **hid the launcher, wiping its session** (a finished reminder collapsed the conversation UI). Fix (pragmatic pause/resume, per best-practice "pause speech, don't overlap"): the launcher controller gains `pauseForReminder()` (stop conversation TTS, hide the launcher → renderer unmounts → mic capture torn down, snapshot the session) and `resumeAfterReminder()` (re-open listening on the SAME session). `setSpeaking` now **ignores playback while interrupted**, so the reminder's audio can't collapse the paused launcher. Wiring: `trigger-sink.fire()` calls `pauseConversation` (first best-effort step, gated on the popup being the reminder surface); the popup's `onQueueDrained` (fired when the user handles the LAST reminder) calls `resumeAfterReminder`. **Scope:** resume = same conversation, re-opened listening — NOT a mid-sentence TTS resume (the cut reply is preserved in history). Files: `electron/main/desktop-voice/controller.ts`, `electron/main/ipc/launcher.ts`, `electron/scheduler/trigger-sink.ts`, `electron/main/reminder-popup.ts`, `electron/main/index.ts`.

**Reminder lifecycle / missed-reminder policy (Issue 2 — already implemented + hardened).** The wall-clock scheduler already does startup catch-up: one-time overdue → `OverdueModal` summary + `status='missed'` + history; recurring overdue → rolled forward (no alarm storm) — this IS the best-practice pattern. Added **launch-at-login** (opt-in, off by default): `app.setLoginItemSettings({openAtLogin, args:['--hidden']})`, reconciled at startup + on settings change; a login-triggered start stays in the tray (`createMainWindow(startHidden)` / `wasOpenedAtLogin`) so the scheduler runs more of the time and fewer reminders are missed. (While the PC is fully off nothing fires — the catch-up summary covers that.) New setting `launch_at_login` + DTO/patch + a Settings toggle.

**Voice provider architecture / hybrid "Cloud voice recognition only" (Issue 4 — already possible).** STT/LLM/TTS/search are independently gated in `registry.ts`, so cloud STT works with AI-Assist OFF: STT→openai (key+consent), AI-Assist off, Voice→Windows, web search off = cloud transcription + everything-else-local, with `withFallback(sherpa)` covering offline. Verified by a registry test; surfaced with a "🔒 Cloud voice recognition only" note in Settings. Trade-offs: +network latency (~0.5-1.5s per dictation), only audio leaves the device, ~$0.006/min STT-only, offline falls back to on-device sherpa.

**Chat hint (Issue 3).** A subtle, always-present "Press Shift+Alt+Space anywhere to talk to Yogi" footer pinned below the composer in every chat (theme-aware, non-scrolling, non-interactive).

**Desktop integration / Windows naming (Issue 5).** `app.setName('LifeOS')` (case-insensitive on Windows, keeps existing data) + `executableName: LifeOS` in electron-builder + AUMID already set. **Packaged builds show "LifeOS"** in Task Manager, Details, Start Menu, Installed Apps, notifications, tray, and window title. **Dev/unpackaged inherently shows "electron"** (the process is `electron.exe`) — not fixable without packaging; run `npm run build:win` to see the branded exe.

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 · `build` ✅ · `test` ✅ **402 / 43 files** (+8: pause/resume state machine, reminder-finish-doesn't-collapse-launcher, pause-gated-on-popup, drain→resume signal, hybrid-STT registry). Boot ✅ clean. Live audio interruption + packaged Task-Manager name need a real machine/build to confirm end-to-end.

### 2026-07-14 (cont. 12) — Reminder detection breadth, conversation re-read resume, packaged-name VERIFIED

**Issue 2 — reminder routing when AI Chat is off (root cause: DETECTION breadth, NOT AI coupling).** Screenshots (key present, AI-Assist OFF, cloud STT): *"Set reminder after one minute to call Biplab"* → the offline AI-required notice, while *"Set **a** reminder…"* worked. Cause: `detectIntent` recognized "remind me" and "set **a** reminder" but NOT "set reminder" (no article), "add/create/make reminder", plurals, or noun-led "reminder to …" — `\bremind\b` doesn't match the noun "reminder". When detection failed the offline path returned the AI notice, making it *look* coupled to AI Chat. Reminder routing is in fact fully local (proven: a real-engine test creates the reminder with AI-Assist off + a key present). **Fix:** broadened `detect-intent.ts` (`set/add/create/make/schedule/new [a|an|the] reminder`, noun-led `reminder to/for/…`) + `extract-title.ts` (strip the same prefixes so the title stays clean) + a greeting fix so "Hey Yogi." is a local greeting. Desired architecture (STT → intent → reminder parser → scheduler, independent of AI) was already how it works — this closes the detection gaps. Also fixed a real bug from cont. 2: `launch_at_login` (and now `conversation_auto_resume`) had no patch→setting mapping in `ipc/index.ts`, so the toggle didn't persist.

**Issue 1 — resume now RE-READS the interrupted reply.** Extended the pause/resume: `pauseForReminder` snapshots whether Yogi was mid-reply; `resumeAfterReminder` (when auto-resume on, default) re-opens the launcher, **re-reads that reply from the start** (recovering the lost context), and sequences into listening when the re-read finishes (via `pendingResumeListen` + the `setSpeaking(false)` hook, so speech never overlaps the mic). New `speak` dep on the controller; new setting `conversation_auto_resume` + Settings toggle. Off → re-open ready without re-reading. (A full mid-sentence resume / interactive yes/no gate remains future work; re-reading from the start is the pragmatic recovery.)

**Issue 3 — Windows name VERIFIED by an actual build.** `npx electron-builder --win --dir` produced `release/win-unpacked/**LifeOS.exe**` (the ONLY exe — no electron.exe), with `ProductName=LifeOS`, `FileDescription=LifeOS` (the Task-Manager friendly name), `CompanyName=DreamNotion`. So packaged/installed builds show **LifeOS** in Task Manager, Details, Start Menu, Installed Apps, notifications (AUMID), tray, and window title. Dev/unpackaged shows **electron** because the process is literally `electron.exe` — inherent to `electron-vite`, not fixable without packaging. Run `npm run build:win` (or the `--dir` build) to get the branded exe.

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 · `build` ✅ · `test` ✅ **409 / 43 files**. Packaged exe name/metadata verified on disk. Live audio re-read + full Task-Manager display need the running packaged app to confirm visually.

### 2026-07-14 (cont. 13) — Gmail integration, Phase 1 (Integrations): OAuth foundation

**Scope.** First phase of a spec'd 5-phase, privacy-first Gmail integration. The spec mandates phase-gating ("do not proceed until the previous phase is verified"), so this session delivered the **research/architecture doc + Phase 1 foundation only**: secure OAuth connect/reconnect/disconnect, encrypted token storage, the DB schema, and the Settings → Integrations UI. Sync, notifications, AI email context, semantic search, and web research (Phases 2–5) are **architected-for behind seams but not built**. Full design + manual test guide: **`docs/lifeos-planning/gmail-integration.md`**.

**Two settled architecture calls (researched).**
1. **OAuth = Loopback IP + PKCE.** Google removed OOB; Loopback (`http://127.0.0.1:<ephemeral-port>` + a one-shot main-process HTTP server catching the `code`) is the supported flow for *Desktop app* clients. The auth URL always sends `access_type=offline` **and** `prompt=consent` (or Reconnect yields no refresh token and auto-refresh silently breaks).
2. **Sync = incremental `history.list` polling as the default spine; Pub/Sub push deferred.** True push forces every user to stand up a GCP topic/subscription/IAM + weekly `watch` — too heavy for a consumer app (the spec licenses this fallback). The Phase-2 engine will checkpoint on `historyId` so a future Pub/Sub *pull* feed plugs into the same path.

**Privacy / security (mirrors the API-key pattern).** OAuth tokens **and** the OAuth client secret are `safeStorage`/DPAPI ciphertext held in settings rows, decrypted only in main, **never across IPC** — both keys are excluded from `getAllSafe()`. The renderer only ever receives a safe `GmailStatusDto` (connected + email + counts), never a token or secret. **Disconnect performs a real server-side token revoke** (`oauth2.googleapis.com/revoke`), then wipes local tokens + account. Main-process `fetch` to Google is not gated by the session allowlist (same as the OpenAI provider), so **no `session.ts`/CSP change was needed**; privacy is enforced by provider gating (call Google only when connected). Minimal, incremental scopes: Phase 1 requests `gmail.readonly` + `gmail.metadata` only (`modify`/`send` reserved for later phases).

**What shipped.**
- **Schema (M006_GMAIL, `user_version` 5 → 6, additive/forward-only):** `gmail_accounts`, `gmail_sync_state`, `gmail_threads`, `gmail_messages` (unique message id → dedup), `gmail_participants`, `gmail_labels`, `gmail_message_labels`, `gmail_attachments` (+ indexes). `email_ai_context` / `email_embeddings` / `web_research` **deliberately deferred** to later migrations (their shape depends on the local-vs-OpenAI embeddings decision).
- **Pure core (`core/gmail/`):** `oauth.ts` (PKCE S256, state/CSRF, auth-URL + token/refresh/revoke request shapes, redirect parsing — no `fetch`), `types.ts`, `mail-provider.ts` (the Outlook/IMAP extensibility seam, interface-only in P1).
- **Main:** `electron/services/gmail-token-store.ts` (mirrors `ApiKeyStore`), `electron/gmail/gmail-auth.ts` (loopback server + exchange/refresh/revoke/getProfile, injectable `fetch` for tests), `electron/database/gmail-repository.ts`, `electron/main/ipc/gmail.ts` (`guard()`ed handlers + safe status broadcast), wired in `electron/main/index.ts`.
- **Settings pipeline + UI:** new keys/defaults, `SettingsPatch`/`SettingsDto` Gmail fields, `GmailStatusDto`, channels, preload bridge, `src/lib/ipc.ts` wrappers, `window.d.ts`, and `src/features/settings/GmailSection.tsx` (status pill, credential entry with show/hide, Connect/Reconnect/Disconnect, Test, feature toggles, sync mode, max-stored, delete-cache, status detail — LifeOS design language).

**Files (new):** `docs/lifeos-planning/gmail-integration.md`, `core/gmail/{types,oauth,mail-provider}.ts`, `electron/services/gmail-token-store.ts`, `electron/gmail/gmail-auth.ts`, `electron/database/gmail-repository.ts`, `electron/main/ipc/gmail.ts`, `src/features/settings/GmailSection.tsx`, tests `tests/unit/{gmail-oauth,gmail-token-store}.test.ts` + `tests/integration/{gmail-repository,gmail-connect-flow}.test.ts`. **(edited):** `electron/database/migrations.ts`, `electron/database/settings-repository.ts`, `core/types/{ipc,channels}.ts`, `core/settings/typed-settings.ts`, `electron/main/ipc/index.ts`, `electron/main/index.ts`, `electron/preload/index.ts`, `src/lib/ipc.ts`, `src/types/window.d.ts`, `src/features/settings/SettingsScreen.tsx`, `src/styles/global.css`.

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 errors · `build` ✅ (preload-chunks invariant intact) · `test` ✅ **437 / 47 files** (+28, +4 files). New tests cover: PKCE S256 (RFC 7636 vector), state/CSRF, auth-URL offline+consent+scopes, redirect parse, token/refresh/revoke shapes; token-store encrypt/decrypt + never-plaintext + refuse-when-unavailable; M006 migration + repo CRUD + cache-delete + dedup; and a real-DB connect→refresh→invalid_grant→disconnect(**revoke asserted**) flow with mocked Google.

> **HARD GAP — live OAuth NOT exercised here.** The real Google consent handshake, browser round-trip, `getProfile`, and desktop notifications need live credentials + a display + a human, which this environment lacks. They are verified **by construction** (unit/integration tests with mocked Google) and delivered as the **step-by-step manual testing guide** in `gmail-integration.md §10`. Green unit tests are **not** proof end-to-end OAuth works — a Windows manual pass (create Desktop OAuth client → paste creds → Connect → Test → Disconnect → verify revoke at myaccount.google.com/permissions) is required before Phase 1 is "done-done".

**Next (Phase 2, not this session):** the `MailProvider` Gmail impl + `historyId` sync engine (initial/incremental/recovery/dedup, read/star/label/delete deltas) + background reconcile + the desktop notification (Open / Ask Yogi / Dismiss).

### 2026-07-15 — Gmail integration, Phase 2 (Sync + Notifications)

**Scope.** Built Phase 2 on the Phase-1 seams: the concrete Gmail `MailProvider`, the `historyId`-checkpoint incremental sync engine, a wall-clock sync scheduler, and a new-mail desktop notifier. The user waived the Phase-1 manual OAuth gate ("proceed to Phase 2") — noted and honored; the whole layer still sits on an OAuth path never exercised against live Google here.

**Design decisions (from research + review).**
- **Metadata-only fetch by default** (`format=metadata`); `format=full` only when Download Attachments is on — sidesteps any assumption about whether metadata returns the attachment MIME tree.
- **Crash-safe checkpoint:** the `historyId` cursor advances only after a delta batch persists; adds dedup on the unique message id, deletes/label-updates idempotent; a `history` 404 → `HistoryExpiredError` → reseed via bounded initial sync.
- **New-mail detection** = added message that is INBOX+UNREAD and not already stored (existence checked *before* upsert); self-sent (`SENT`) excluded; initial sync never notifies.
- **`gmail_store_context` is a real gate** — off ⇒ track the cursor + notify but store nothing.
- **Deleted vs Trash:** `messageDeleted` removes the row; a `TRASH` label applies as a normal label update.
- **Notification buttons deferred by choice** — Windows Electron `Notification` has no action buttons; click→open now, popup-style Open/Ask Yogi/Dismiss later (matches the reminder-popup precedent).
- **Scheduler** = short wall-clock tick checking due-ness against `last_sync_at` (not a far-future `setTimeout`); modes 5min/15min/manual, push→5min; connect kicks a background sync; `.unref()` so it never holds the loop open.

**Files (new):** `electron/gmail/{gmail-provider,sync-engine,gmail-sync-scheduler,gmail-notifier}.ts`; tests `tests/unit/{gmail-provider-parse,gmail-sync-scheduler}.test.ts` + `tests/integration/gmail-sync-engine.test.ts`. **(edited):** `core/gmail/{mail-provider,types}.ts`, `electron/database/gmail-repository.ts` (message/thread/label/attachment writes, dedup, prune), `electron/main/ipc/gmail.ts` (+ `GMAIL_SYNC_NOW`), `core/types/{ipc,channels}.ts`, `electron/main/index.ts` (provider→engine→scheduler→notifier wiring), preload/`src/lib/ipc.ts`/`window.d.ts`, `src/features/settings/GmailSection.tsx` (Sync now button), `docs/lifeos-planning/gmail-integration.md`.

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 errors · `build` ✅ (preload-chunks invariant intact) · `test` ✅ **459 / 50 files** (+22, +3 files). New tests cover: provider parsing (headers/labels/flags/participants, attachment MIME walk, address-list edge cases); the engine's initial/incremental/**recovery**/**dedup**/delete/label/notify paths + the storeContext gate + not-connected → reconnect_needed + prune, all through the real DB against a scripted fake provider; and the scheduler's due-ness logic (disabled/manual/interval/first-run/reconnect-needed/syncNow).

> **HARD GAP unchanged from P1:** no live Gmail credentials + no display here → the real token exchange, history sync, and desktop notifications are verified **by construction + mocks only**. The extended manual guide is in `gmail-integration.md §10.G`. Green tests are not proof sync works against Gmail.

**Live-run fix (2026-07-15, same day).** First real connection surfaced **`Gmail API 403` on every `messages.get`** → 0 stored → 0 KB → no notifications. Root cause: the requested scopes included **`gmail.metadata`**, which restricts `messages.get` to `format=metadata` and 403s `format=full` (used because "Download attachments" was on) *even with `readonly` also granted* — metadata poisons the token. Fix: request **`gmail.readonly` only**, drop `include_granted_scopes` (no carry-forward), and surface Google's error reason in the log for future diagnosis. Users on the old grant must **Disconnect → remove metadata scope in Cloud Console → Connect** (a plain Reconnect keeps the revoked-but-still-granted metadata scope). `typecheck`/`lint`/`build`/tests green after the change. This was exactly the class of failure the "unverified base" caveat warned about — caught on first live run.

**Next (Phase 3):** AI email context (`email_ai_context`: summary/entities/dates/tasks/priority) + search (`email_embeddings` — the local-vs-OpenAI decision is made here) + thread memory + Yogi email capabilities.

### 2026-07-15 (cont.) — Gmail Phase 3: conversational email (new-email → its own chat + spoken heads-up + talk to Yogi)

**Ask (from the user, after Phases 1–2 verified live).** With a new-email notification, Yogi should (1) treat each new email as a new chat, (2) speak (TTS) the heads-up, and (3) let the user interact about the email. Built by extending the reminder-delivery pattern — no new infrastructure.

**Key architecture win (verified in code).** The engine's LLM context is `recentTurns`, so delivering the email as an assistant turn puts it **in Yogi's context for free** — "summarize this / who sent it / what action?" work with **no engine or system-prompt change**. Hardened the turn projection: a delivery turn (empty `userText`) projects **assistant-only** keyed on the empty-text invariant (not a per-kind label), so it can never malform the request with an empty user message.

**The load-bearing safety the review caught.** Auto-created email chats bump `updated_at`, which would let a new email **hijack the launcher's cold-start "continue my most-recent conversation"** (the exact continuity behaviour engineered earlier). Fixed: email chats are created **quietly** (do NOT move the shared active pointer, do NOT switch any view), and both the launcher fallback and the main-window mount now resume the most-recent **non-email** chat (`mostRecentConversation()` / `emailMessageId` filter). Email chats open **only** via a notification/sidebar click.

**Shipped.**
- **M007:** `email_ai_context` (summary/intent/action items/dates/priority) + `chat_sessions.email_message_id`. New `kind='email'` turn end-to-end (core type, repo, engine projection, renderer).
- **EmailContextService** (`electron/gmail/email-context-service.ts`): summaries via the gated `makeLlmProvider` seam + `gmail_ai_summaries`; cached; degrades to snippet on off/no-key/error (never throws). Prompt/schema/formatters pure in `core/gmail/summary.ts`.
- **EmailDeliveryCoordinator** (`electron/gmail/email-delivery.ts`): per new email → dedup by id → summarize → quiet chat → assistant delivery turn → broadcast; **one** notification + **one** TTS line per batch; TTS skipped while audio busy; ≤10 chats/batch. Replaces the raw notifier in the sync engine's `onNewMessages`.
- **Notification click → opens the email's chat** (`GMAIL_OPEN_CHAT`; App switches to Chat + selects, race-free via a prop). Live sidebar refresh (`CHAT_SESSIONS_CHANGED`).
- Grounding ceiling stated honestly: summary/sender/intent/action/dates answered; deep body questions not (the `email_message_id` link is the future hook).

**Files (new):** `core/gmail/summary.ts`, `electron/gmail/{email-context-service,email-delivery}.ts`; tests `tests/unit/gmail-summary.test.ts` + `tests/integration/gmail-email-delivery.test.ts` + a projection test in `conversation-engine.test.ts`. **(edited):** `electron/database/migrations.ts`, `core/types/chat.ts`, `electron/database/chat-repository.ts`, `electron/database/gmail-repository.ts`, `core/gmail/{types,mail-provider}.ts`, `electron/gmail/{gmail-notifier,sync-engine}.ts`, `electron/conversation/conversation-engine.ts`, `electron/main/desktop-voice/controller.ts`, `electron/main/index.ts`, `core/types/channels.ts`, preload/`src/lib/ipc.ts`/`window.d.ts`, `src/features/chat/{ChatScreen,useSessions,useConversation,conversation-types,MessageBubble}.tsx/ts`, `src/app/App.tsx`, `src/styles/global.css`.

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 errors · `build` ✅ (preload-chunks invariant intact) · `test` ✅ **476 / 52 files** (+16). New tests: summary formatters + parse/degrade; delivery coordinator (dedup, batch → one notify + one TTS, TTS-skip on audio-busy/tts-off, **quiet-create doesn't become the continuity target**); context service (off/no-provider/cache/error-degrade); engine projection (email turn → no empty user message). Updated the launcher-controller fake for `mostRecentConversation`.

> **HARD GAP (narrowing).** Phases 1–2 are now live-verified. Phase 3's live loop (hear the TTS, click the toast, open the chat, ask a follow-up) needs a real inbound email + display — verified here by construction + mocks. Manual steps in `gmail-integration.md §6.2 / §10`.

**Next (Phase 4):** opt-in web research on an email (`web_research` cache/dedup, Yogi decides usefulness), then Phase 5 hardening. Semantic search/embeddings (`email_embeddings`) remain deferred until a search phase.

### 2026-07-15 (cont. 2) — Gmail Phase 4: opt-in web research on emails

**Reframe that shrank the phase.** Because Phase 3 made an email chat a normal `ConversationEngine` session with the summary in context, **manual "research this email" should work via the engine** (`research` intent → forced web search → answer with sources, per the cont.4/cont.10 fixes) with zero new code — but this is **UNVERIFIED end-to-end**: what's tested is the engine forcing search once a turn is *classified* `research`; whether gpt-4o-mini classifies a bare "research this" that way is model-dependent (the same flaky-classifier risk as the `needsWebSearch` saga). So Phase 4's new code = only the **automatic trigger + a `web_research` cache**, reusing the `makeSearchProvider` seam (no parallel search path). The manual path needs the web-search chain on; fallback phrasing "research this email about X" if the bare phrase under-triggers.

**Shipped.**
- **M008:** `email_ai_context += research_worthwhile/research_query`; new `web_research` table (PK `message_id` → one cached result per email, no re-pay on re-sync).
- **Decision rides on the summary:** the one summary LLM call also returns `researchWorthwhile` + `researchQuery` (fail-safe: worthwhile only if flagged AND a non-empty query). Prompt defaults **false**, fires only on the narrow class (visa / flight delay / gov-legal-tax-medical / shipping / admission / conference).
- **EmailResearchService** (`electron/gmail/email-research-service.ts`): cache → gated `makeSearchProvider` → save; degrades to null (no provider / empty query / error); never throws.
- **Coordinator:** after notify+speak, **fire-and-forget** research pass (cap **3**/batch, bounded concurrency) appends a silent assistant-only research turn (🔎 answer + sources) to the email's chat — no second TTS; can't hijack the view (`mostRecentConversation()` excludes email chats).
- **Toggle chain made visible:** the auto-research checkbox is disabled until key + AI summaries + Store email context are on (the decision needs the stored summary), with an inline explanation — no silent dead-end.

**Files (new):** `electron/gmail/email-research-service.ts`; tests folded into `tests/unit/gmail-summary.test.ts` + `tests/integration/gmail-email-delivery.test.ts`. **(edited):** `electron/database/migrations.ts`, `core/gmail/{types,summary}.ts`, `electron/database/gmail-repository.ts`, `electron/gmail/email-delivery.ts`, `electron/main/index.ts`, `src/features/settings/GmailSection.tsx`.

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 · `build` ✅ (preload invariant intact) · `test` ✅ **484 / 52 files** (+8). New tests: research-decision parse (flag AND query), `formatResearchText`, research service (search/cache/dedup/no-provider/empty-query/error-degrade), coordinator auto-research (worthy→append, off→skip, non-worthy→skip, **no second TTS**). Actual search call stays mock-only (fake `SearchProvider`), same as prior phases.

> **HARD GAP.** The live loop (a real research-worthy email → real paid web search → research turn) needs live creds + a display — verified here by construction + mocks. Manual steps in `gmail-integration.md §6.3 / §10.I`.

**Next (Phase 5):** hardening — perf, edge cases, full test matrix, docs. Semantic search/embeddings (`email_embeddings`) remain a separate later phase.

### 2026-07-15 (cont. 3) — Gmail Phase 5: hardening (the last planned phase)

**Concrete, testable hardening (not busywork).**
- **Startup catch-up (real edge case):** relaunching after a backlog would otherwise burst-create up to 10 email chats + a spoken line on every start. Now the FIRST automatic sync of a session runs as *catch-up* — stores the backlog + advances the `historyId` checkpoint but suppresses the delivery burst (no chat/notify/TTS), mirroring the reminder scheduler's "missed-while-closed" policy. `Sync now` is always a deliberate delivery; kicked on `start()` and on `powerMonitor` resume.
- **403 rate-limit retry:** the provider now retries a 403 whose *machine* reason is `rateLimitExceeded`/`userRateLimitExceeded`/`RESOURCE_EXHAUSTED` (Google returns these as 403, not just 429), while a scope/permission 403 stays terminal (no loop — a misconfig fails fast, as the live 2026-07-15 metadata-scope bug did once fixed).
- **Edge cases documented, not mis-fixed:** delete-cache intentionally keeps the auto-created email chats (deleting them would destroy the user's conversations); backlog-not-delivered-as-chats is a conscious tradeoff. Both in Known Limitations.

**Files (new):** `tests/unit/gmail-provider-retry.test.ts`. **(edited):** `electron/gmail/{sync-engine,gmail-sync-scheduler,gmail-provider}.ts`, `electron/main/index.ts` (resume trigger), tests `tests/unit/gmail-sync-scheduler.test.ts` + `tests/integration/migrations.test.ts`.

**Verification.** `typecheck` ✅ 0 · `lint` ✅ 0 · `build` ✅ (preload invariant intact) · `test` ✅ **494 / 53 files** (+10). New tests: catch-up semantics (first quiet, then delivers; `catchUp()` bypasses interval; `syncNow` always delivers; no-ops when disabled/disconnected/reconnect-needed), retry policy (retry rate-limit-403 + 429 + 5xx, DON'T retry permission-403, give up at cap), and migration coverage for every M006–M008 table + the M008 ALTER columns.

**Boot check — NOT run here (labelled, not faked).** Phases 3–5 added heavy main-process startup wiring (`EmailContextService`/`EmailResearchService`/`EmailDeliveryCoordinator`, the `audioBusy` closure, two `powerMonitor` resume handlers, and `gmailSyncScheduler.start()` which kicks a boot catch-up). This is **build- and typecheck-verified but NOT boot-verified**: an Electron instance was already running in this environment, so `npm run start` would hit the single-instance lock (no clean boot) and killing `electron` would risk the user's other Electron apps. Init ordering was re-traced statically (no TDZ; all deps defined before use; the boot catch-up now swallows rejections). **Booting the app is the user's step 0.**

**Gmail integration — all 5 planned phases complete.** Phases 1–2 verified live on 2026-07-15; 3–5 are test-green with live-drive pending (no display/inbound-mail here). The only still-unverified user-facing claim is the *manual* "research this" trigger (model-dependent classification — flagged in §6.3/§10.I). Semantic search over the whole mailbox (`email_embeddings`) is deliberately deferred to a separate future effort.

### 2026-07-15 (cont. 4) — Launcher UX pass: close button, notification→launcher navigation, default chat, chat switcher, reset-revoke, reminder NL

**Six-part feedback round on the desktop launcher + settings.** All logic is main-process and renderer; the automated suite went **494 → 508 tests** (typecheck/lint/build green, preload-chunks invariant intact). The GUI-facing behaviours are verified by unit tests + code trace; a live Windows drive is still the user's step 0 (single-instance lock + no display here — the repo's standing HARD GAP).

**1 — Close (✕) button not working (root cause + fix).** The ✕ is always rendered, but the launcher window only reliably took clicks when "interactive". `launcherApi.setInteractive(false)` — active during **`listening`** and **`processing`** — made the whole window click-**through** (`setIgnoreMouseEvents(true, { forward: true })`) and re-enabled clicks only via a fragile hover-forward path, so the ✕ was unreachable while listening/recording. **Fix (in `electron/main/index.ts` `launcherApi`, not the controller):** decouple mouse-clickability from keyboard-focusability — keyboard focus still tracks `interactive` (needed only for the review textarea), but the window **always accepts mouse clicks while visible** (`setIgnoreMouseEvents(false)` unconditionally). A non-focusable window still delivers button clicks, so this keeps the "never steal focus" posture (paired with `showInactive()`). `setHovered` is now a no-op; the `launcherHovered` bookkeeping was removed. *Verification note:* this fix lives in `launcherApi`, so the controller unit test can't exercise it; it is verified **by construction** (phase→interactive-state trace showing the failure window was `listening`/`processing`) — **live GUI close still pending a Windows drive.**

**2 — Email notification now opens the launcher into the email's conversation.** Before, a new-email toast click called `openMain()` + broadcast `gmail:openChat` — it focused the **main window** and the launcher was untouched (so a manual launcher-open showed the *previous* chat, not the email). Now `openGmailChat` (index.ts) routes to the launcher when it's enabled: new `DesktopVoiceController.openConversation(sessionId)` moves the shared active pointer, ensures/positions/shows the launcher, lands in a **typeable Review state** with that conversation hydrated, and broadcasts `launcher:sessionActivated`; a live recording is torn down first (`launcher:stopListening`) so we don't switch out from under the mic. If the launcher is **disabled**, it falls back to the old main-window path. Works whether the launcher was closed or already open (it switches).

**3 — Manual launcher-open now lands on the MOST RELEVANT conversation.** New `ChatRepository.mostRelevantConversation()` = the most-recently-active chat of **any** kind (recency-primary, email winning an exact tie). Because a new email or a fired reminder is delivered as a turn that bumps `updated_at`, the latest notification surfaces first — realising the requested priority **notification → reminder → normal chat** without a brittle strict-tier query. `resolveActiveSession()` now uses it, keeping the shared pointer only when it is at least as fresh as the top candidate (so pressing the shortcut *mid-conversation* continues that conversation instead of jumping to an older chat). **This deliberately reverses the earlier "a delivered email must never hijack continuity" rule** — the user explicitly asked for notifications to surface, and the new chat switcher (below) makes any unwanted jump a one-click recovery.

**4 — Compact chat switcher inside the launcher.** The launcher header's brand is now the **active conversation's title + a caret**; clicking it opens a small dropdown (`role="listbox"`) listing all conversations newest-first, each with a 📧/💬 kind icon, the current one highlighted + ✓. Selecting one calls `openConversation`. New IPC `launcher:listSessions` / `launcher:openConversation` walk the full plumbing chain (channels → preload → `window.d.ts` → handler). `Escape` closes the dropdown first, then the launcher.

**5 — Reset Local Data: documented + a privacy fix.** See **"Reset Local Data — exact behaviour"** below for the full explanation the user asked for. The one gap found: `resetLocalData` deleted the local encrypted Gmail token but **did not revoke the Google grant server-side**, leaving LifeOS authorized in the user's Google account after a reset. **Fixed:** the reset IPC handler now runs a best-effort `onBeforeReset` (index.ts) that calls `gmailAuth.disconnect()` (server-side revoke + local clear) **when connected**, before the wipe. It is **time-bounded (4 s `Promise.race`)** because it adds a network call in front of a path that had none and a reset is often triggered offline — on timeout/failure the wipe proceeds anyway (worst case: the grant isn't revoked, i.e. exactly the pre-fix state), so the revoke can never freeze the reset.

**6 — Reminder creation is natural-language, confirmed + documented.** No specific wording is required. Any reminder **cue** works offline with word-order and STT-slop tolerance (`remind me`, `don't (let me) forget`, `set/add/create/make/schedule reminder`, `ping/nudge/buzz/alert/notify me`, `wake me`, `set an alarm`). Verified through the **real engine** (no key): *"Remind me tomorrow at 5"*, *"Don't let me forget my meeting on Friday"*, *"Remind me this evening to call John"* all route to the local reminder flow. A completely **verb-less implicit** reminder (*"I need to call John this evening"*) has no cue, so **offline** it honestly asks for a provider; with an OpenAI key the LLM interprets it as a reminder. Deliberately **not** broadened the offline regex to catch verb-less phrasing — a greedy local match gives wrong answers; that inference is the LLM's job.

**Files changed.**
- Issue 1: `electron/main/index.ts` (`launcherApi.setInteractive`/`setHovered`, removed `launcherHovered`).
- Issue 2: `electron/main/index.ts` (`openGmailChat` routes to the launcher, gated on enabled), `electron/main/desktop-voice/controller.ts` (`openConversation`).
- Issue 3: `electron/database/chat-repository.ts` (`mostRelevantConversation`), `electron/main/desktop-voice/controller.ts` (`resolveActiveSession` + `pointerSession`).
- Issue 4: `core/types/channels.ts`, `electron/main/ipc/launcher.ts` (list/open handlers + interface), `electron/main/desktop-voice/controller.ts` (`listSessions`), `electron/preload/launcher.ts`, `src/types/window.d.ts` (`LauncherSession`), `src/launcher/LauncherApp.tsx` (switcher UI + session-change hydration + Escape), `src/launcher/launcher.css`.
- Issue 5: `electron/main/ipc/index.ts` (`onBeforeReset` dep + revoke-before-wipe), `electron/main/index.ts` (wire `onBeforeReset` to `gmailAuth.disconnect()`).
- Issue 6: no code change — `tests/integration/offline-phrases.test.ts` (+4 example assertions documenting the boundary).
- Tests: `tests/unit/desktop-voice-controller.test.ts` (+9: most-relevant default, older-email-doesn't-hijack, openConversation review/mic-teardown, listSessions DTOs).

**Regression results.** `typecheck` ✅ 0 · `lint` ✅ 0 errors (14 pre-existing `any`/unused-disable **warnings**) · `build` ✅ (preload-chunks invariant intact) · `test` ✅ **508 / 54 files** (+14).

**Testing performed.** Full automated suite. Controller state machine (open/close, notification-open, default-chat priority, switcher DTOs, mic teardown on switch) covered by injectable-deps unit tests; reminder NL boundary proven through the real `ConversationEngine` (no key). **Not run here (needs a real Windows GUI / display / inbound email):** the physical ✕ click, the on-screen switcher dropdown, a real email toast → launcher navigation, and Reset's actual relaunch + Google-grant revocation. These are the standing HARD GAP and are the user's manual pass.

**Known limitations / follow-ups.**
- **Live GUI verification pending** for all launcher-window behaviours (as above) — verified by construction only.
- **Reminder-notification → launcher:** reminders keep their dedicated **reminder popup** (already a full chat client) as the primary fired-reminder surface; a fired reminder now also surfaces its chat via the new most-relevant default on the next manual launcher open. Rewiring the Windows reminder notification itself into the launcher was intentionally left out to avoid regressing the well-tested popup flow.
- **Default-chat vs. deliberately-opened-old-chat:** opening an *old* chat in the main window and then pressing the launcher shortcut resolves to the most-recently-active chat (which may be a newer notification), not the old one — a conscious trade to honour the "surface notifications" request; the switcher recovers it in one click.

#### Reset Local Data — exact behaviour (Issue 5)

**Flow.** Settings → *Reset Local Data* → a modal requires typing `RESET` → IPC `settings:reset` (takes **no** arguments; the path is resolved in main from `app.getPath('userData')`, never from the renderer) → (new) best-effort **Google OAuth revoke if connected** → close the DB (release the WAL) → delete data → **`app.relaunch()` + `app.exit(0)`** → the app restarts into **first-run onboarding**.

**Exactly what is deleted.** Everything LifeOS persists lives in the SQLite database `lifeos.db` (+ its `-wal`/`-shm` sidecars), which is deleted deterministically with retries. That single file holds **all** of: reminders + history, notifications' source data, **all conversations** (`chat_sessions`/`chat_turns`, including email and reminder chats), **memories**, **all settings/preferences**, the **DPAPI-encrypted OpenAI API key**, the **DPAPI-encrypted Gmail OAuth tokens + client secret**, Gmail sync state, and the cached email AI-context / web-research. After that, the rest of the Electron profile folder is **best-effort** wiped (Chromium caches, Cookies, GPU cache, etc. — they hold no LifeOS data and regenerate on next launch; Chromium keeps some open on Windows, so that `rm` may partially EBUSY, which is expected and harmless).

**What is preserved.** Nothing of the user's LifeOS data. Outside the profile: the app binary/installation itself; and — until this fix — the **Google account authorization** (now revoked server-side on reset when connected).

**Scheduled jobs / in-memory state.** The scheduler and all timers are in-memory and simply die on relaunch; there is nothing on-disk to clear beyond the DB. On restart the fresh DB has no reminders, so nothing re-fires.

**Restart.** Yes — `resetLocalData` always relaunches in a `finally` (even if a delete throws), so the app never keeps running against a closed database. It comes back on the onboarding screen.

**Is it intentional / matches expected UX?** Yes: it is the single, guarded destructive action (type-`RESET` gate; the only place `fs.rm` may be imported, enforced by ESLint; a unit-tested path safety guard). The `RESET` confirmation and the "this cannot be undone" copy make accidental loss unlikely.

**Suggested further improvements (not implemented this round, to avoid scope creep):** (a) an in-modal, itemised list of exactly what will be deleted (reminders N, conversations N, API key, Gmail connection…) so the user sees the blast radius before confirming; (b) an **Export / backup to JSON** before wipe (also a prerequisite for any future sync); (c) a granular "disconnect Gmail / remove API key only" so users don't reach for the full reset to clear one credential. The OAuth-revoke gap itself is now closed.

### 2026-07-15 (cont. 5) — Reminder reliability (false-success bug) + reminder toast → launcher

**The serious bug: Yogi claimed "I've set a reminder" but nothing was created or fired.** Reported with a screenshot: *"Set me a reminder after two minutes to call Biplab"* → Yogi replied *"I've set a reminder for you to call Biplab in two minutes."* — **no card, no reminder, no trigger.**

**Root cause (found by probing the real parser, not guessed).** The engine's design is "the LLM never actuates — a reminder is created only when the LOCAL parser recognises the text and routes it through the Action Dispatcher." The exact phrase `detectIntent` → **`unknown`, parse `refusal`**, because (a) the verb patterns didn't allow a pronoun between the verb and the noun (**"set _me_ a reminder"**), and (b) the noun-led connector list was **missing "after"** (note: "set me a reminder _in_ 5 minutes" *did* work — "in" was listed, "after" wasn't). With the parser refusing, `reminderShaped=false`, so the online turn fell through to the **model's free-text reply**, which fabricated a success message. The system prompt already said "never claim to have performed an action" — gpt-4o-mini simply disobeyed it, so a prompt tweak alone could never be trusted.

**Fix — two layers (breadth + a hard guard), plus verification and logging.**
1. **Detection breadth (the direct fix).** `core/parsing/detect-intent.ts`: added a verb+pronoun pattern (`set/give/make/create/add me a reminder`) and added **"after"/"within"** to the noun-led connector list. `core/parsing/extract-title.ts` strips the new prefixes in lock-step (so titles stay clean — "Call Biplab", not "me a reminder to call Biplab"). `core/routing/local-intent.ts` verbs broadened to agree. Verified via the real parser: the reported phrase now → `create_reminder`, `ok=true`, title `"Call Biplab"`.
2. **Reliability guard (defense-in-depth — never claim success unless created).** `electron/conversation/conversation-engine.ts` now runs a `reminderClaimOverride`: if the user asked for a reminder **and** the model's reply asserts one was set, **but this turn created no reminder** (reply-only / parser couldn't build one), the false claim is replaced with an honest *"I couldn't set that reminder just now — please try again, e.g. \"remind me in 2 minutes to call Biplab\""*. Applied on both the reply-only and the action-fallthrough branches. So even for a phrasing the parser still can't handle, Yogi never fakes success.
3. **Verify-on-persist.** `persistReminder` (index.ts) now **reads the reminder back** after `create` and requires it is stored **and** has a `next_fire_at`; if not it throws. `ActionDispatcher.confirm` was hardened to **catch** an Execution-Layer throw and return `ok:false` (so the turn is always settled and success is never claimed for a reminder that wasn't actually stored + scheduled).
4. **System prompt** strengthened: classify as `reminder_create` and say you're *setting it up to confirm* — explicitly forbidden from claiming it's already done.

**Reminder toast → launcher navigation (the explicit ask).** `createNotifier` now passes the fired reminder to its click handler; a reminder notification click opens the launcher **directly into that reminder's conversation** (via the same `openConversation` used for email) in a typeable state, with the main window mirrored — using a shared `openSessionEverywhere` helper. A reminder with no linked chat just focuses the main window. (The always-on-top **reminder popup** still appears automatically on fire — unchanged; this adds the *toast-click → launcher* path on top.)

**Reminder pipeline logging (as requested).** Debug logs now trace the whole lifecycle: `reminder parsed + proposed` (engine), `confirm <outcome>` (action IPC), `reminder created <id> "<title>" · fires <ISO> · one-time/recurring · session` (verify-on-persist), `scheduler started · tick=…ms · N active`, and in the trigger fan-out `fired <id>`, `notified + history recorded`, `delivered <id> into chat`, plus `notification clicked → session`.

**End-to-end testing (done here, in code).** New `tests/integration/reminder-lifecycle.test.ts` drives the **real** pipeline — engine → parser → dispatcher → execution → repository → **wall-clock scheduler** — and asserts the full loop for **1 min, 2 min (the reported phrase), 5 min, tomorrow morning, and a specific date+time**: parse → confirmable proposal → confirm → persisted **and** scheduled in the future → does **not** fire before its time → **does fire** when the clock reaches it → fires exactly once (cleanup). Plus: survives a DB reopen (restart) and still fires; the reliability guard converts a faked success into an honest failure with **no** reminder created; a mis-tagged-but-parseable reminder is still created for real; and a persistence throw surfaces as a failure, not a false success. **What still needs a real Windows drive (no display here):** the on-screen confirmation card, the OS notification actually appearing, audible TTS, and the toast-click opening the launcher — verified by construction + the full automated pipeline test.

**Files changed.** `core/parsing/detect-intent.ts`, `core/parsing/extract-title.ts`, `core/routing/local-intent.ts`, `core/conversation/system-prompt.ts`, `electron/conversation/conversation-engine.ts`, `electron/actions/dispatcher.ts`, `electron/notifications/notifier.ts`, `electron/scheduler/trigger-sink.ts`, `electron/main/index.ts`. Tests: `tests/integration/reminder-lifecycle.test.ts` (new, +9), `tests/integration/offline-phrases.test.ts` (+4 "set me a reminder" cases).

**Regression results.** `typecheck` ✅ 0 · `lint` ✅ 0 errors (14 pre-existing warnings) · `build` ✅ (preload-chunks invariant intact) · `test` ✅ **523 / 55 files** (+15). *(Guard is gated on `!wantsSearch` so a web-search answer about reminders — e.g. "best reminder apps" — is never clobbered; regression-tested.)*

## Current application architecture

```text
RENDERER (sandbox:true, no Node)     React 19 — rail nav, chat with sessions sidebar, mic capture
   │  contextBridge (window.lifeos.* / window.lifeosPopup.* / window.lifeosAudio.*), frozen, no raw ipcRenderer
PRELOAD (sandboxed CJS)              main preload imports channel constants; popup/audio preloads INLINE
   │  validated IPC — Zod .strict() at every handler, origin check, Result<T> envelope
MAIN PROCESS (Node, never throttled) SQLite · scheduler · tray · notifications · STT service ·
   │                                 ConversationEngine · Action Dispatcher · provider registry · popup coordinator
   │  fanout() → broadcasts chat/tts/action/popup events to EVERY window
HIDDEN AUDIO WINDOW                  TTS playback — OS speechSynthesis OR streamed OpenAI audio (MSE)
REMINDER POPUP WINDOW                frameless, always-on-top, own preload — a toast that is also a chat client

core/  ── pure TypeScript (luxon, chrono-node, zod) ──
         parser, recurrence, formatting, provider SEAMS (llm/speech/tts/search), turn schema, system prompt, types
```

**Reliability principle (unchanged, still enforced):** in the trigger path, **notification + history are unconditional and fire first**; TTS, audio, the in-app surface, the popup, and chat-delivery are each best-effort and individually wrapped — none can prevent the toast.

**Provider-seam principle (new in v2):** every cloud capability sits behind a pure interface in `core/` (`LlmProvider`, `SpeechProvider`, `TextToSpeechProvider`, `SearchProvider`). Concrete OpenAI implementations live in `electron/providers/`; a `registry.ts` factory returns the cloud provider **only** when that capability is enabled + keyed + consented, else a local provider or `null` (the engine then degrades gracefully). Web search is deliberately **not** coupled to the LLM — it is its own seam.

## Technologies currently used

| Layer | Choice |
| --- | --- |
| Shell | Electron **43.1.0** (Chromium 150, Node 24) |
| UI | React 19 + TypeScript, built with electron-vite (Vite 6) |
| Database | **`node:sqlite`** (built into Electron — no native module, no rebuild); WAL; schema **`user_version` 8** (18 tables, M001–M008) |
| NL date parsing | chrono-node 2.9.1 |
| Date math / recurrence | Luxon 3.7 (hand-rolled next-occurrence; RRULE strings stored) |
| Validation | Zod 4 (`.strict()` at the IPC boundary and on the LLM turn schema) |
| Local speech-to-text | **`sherpa-onnx-node`** (native N-API), streaming Zipformer (~68 MB int8) — the default |
| Cloud speech-to-text (opt-in) | OpenAI **`gpt-4o-mini-transcribe`** (batch WAV POST; transparent fallback to sherpa on failure) |
| Local text-to-speech | Web `speechSynthesis` in a hidden window (offline OS voices) — the default |
| Cloud text-to-speech (opt-in) | OpenAI **`gpt-4o-mini-tts`** — **streamed** to the audio window via Media Source Extensions (blob fallback) |
| Conversation LLM (opt-in) | OpenAI **`gpt-4o-mini`** with strict Structured Outputs (non-streaming by design) |
| Web search (opt-in) | OpenAI **`gpt-4o-mini-search-preview`**, parsing `url_citation` annotations into sources |
| API-key encryption | Electron `safeStorage` (**Windows DPAPI**); ciphertext in a setting; plaintext never crosses IPC |
| Packaging | electron-builder → NSIS installer + portable exe (built for v1 0.1.0) |
| Tests | Vitest (unit + integration + one renderer-hook test) |

## Folder structure (high level)

```text
core/            pure TS: parsing/, scheduling/, time/, conversation/ (system-prompt, turn-schema, intent),
                 llm/, speech/, tts/ (+ voice-catalog), search/, actions/, types/
electron/        main/ (index, ipc/, chat/, tts/, windows, session, reminder-popup)
                 conversation/ (conversation-engine, context-builder)
                 actions/ (dispatcher, confirmation-store, execute, matchers)
                 providers/ (registry + OpenAI llm/speech/tts/search, offline sherpa/web-speech)
                 database/ (driver, migrations, repositories incl. chat-repository + gmail-repository)
                 gmail/ (gmail-auth, gmail-provider, sync-engine, gmail-sync-scheduler, gmail-notifier,
                        email-context-service, email-research-service, email-delivery)  ← Gmail integration
                 scheduler/ · notifications/ · speech/ · services/ (api-key-store, gmail-token-store) · tray/ · preload/
src/             React: app/, features/{onboarding,chat,schedules,history,settings,reminders}, popup/,
                 hooks/, lib/, components/, styles/, audio-host.ts
public/worklets/ pcm16-downsampler.js (AudioWorklet)
resources/       models/stt/ (STT model + tokens + LICENSE)
tests/           unit/ (40) · integration/ (14) · renderer/ (1) — 523 tests / 55 files
docs/            lifeos-planning/ (planning docs + this status) — see 55 (popup), 56 (TTS latency), 57 (tool-calling)
```

---

# Implemented Features

Legend: ✅ Done · ⚠️ Partial · ⛔ Not started / schema-only

## Reminder core (v1 — complete)

| Feature | Status | Notes |
| --- | --- | --- |
| Electron app + secure defaults | ✅ | sandbox, contextIsolation, nodeIntegration:false, CSP (env-gated), navigation locks, default-deny network filter with a **live** cloud-allowlist predicate, single-instance lock |
| SQLite integration | ✅ | `node:sqlite` behind a swappable `SqliteDriver`; WAL; `PRAGMA user_version` migrations (now v4); parameterized queries |
| Migrations | ✅ | **4** forward-only migrations (initial · memory · chat-sessions · turn-kind); refuses a newer-version DB |
| Local NL parser | ✅ | intent → recurrence → chrono (`forwardDate`) → ambiguity (`isCertain`) → confidence → clarification. 56 fixtures |
| Ambiguity handling | ✅ | Asks instead of guessing (AM/PM, missing time, vague daypart, recurrence-without-time, missing title) |
| Wall-clock scheduler | ✅ | Main-process, persisted `next_fire_at`, 30 s reconcile tick, `powerMonitor` resume/unlock, startup catch-up, overdue policy; avoids the 24.8-day timer trap |
| Recurrence (all frequencies) | ✅ | RRULE stored; next-run via Luxon; DST-correct. **Daily / weekly / monthly / yearly + custom every-N, multi-weekday, and COUNT/UNTIL end conditions** (2026-07-15). Stateless anchor-based occurrence engine; bounded reminders auto-complete after their final fire. Chat NL still parses daily/weekly only (advanced repeats via the editor) |
| Notifications | ✅ | Main-process `Notification`; click → show + focus; fires while in tray |
| Speech-to-text | ✅ | Local sherpa streaming (default) **or** opt-in OpenAI transcribe with transparent fallback |
| Microphone UI | ✅ | Mic button states, live transcript strip, press-to-start/stop, silence auto-stop, 30 s cap |
| Confirmation & clarification | ✅ | Card shows absolute + **live** relative time + recurrence; nothing persists without confirm |
| Active Schedules | ✅ | Lists pending/triggered; absolute + **live-ticking** relative time; per-reminder pause; delete (now confirmed) |
| Overdue catch-up | ✅ | One-time reminders missed while closed → `missed`, recorded, shown once on startup (race-free pull) |
| Pause / Resume · Tray · Close-to-tray · Onboarding · History · Theme · Reset Local Data | ✅ | All present and working (see Screens) |
| Logging | ✅ | Local `app_logs`, level-gated, secret redaction (now also records web-search decisions for diagnosis) |
| IPC contract layer | ✅ | `guard()`: origin check → Zod `.strict()` → business rules → `Result<T>`; never throws/leaks across IPC |

## Conversation & intelligence (v2)

| Feature | Status | Notes |
| --- | --- | --- |
| Conversation Engine | ✅ | Classifies each turn into a strict-JSON `AssistantTurn`; routes reply-only vs action-intent; per-turn `AbortController`; 20 s chat / 35 s search deadlines; single-`chat:done`-per-turn invariant; one bounded retry; degrades to the local parser/offline notice when the cloud is off |
| Persistent chat sessions | ✅ | `chat_sessions` + `chat_turns` (M003); sidebar of resumable chats; faithful re-render (`assistant_text` = what was shown); auto-title from first message; delete (nulls linked reminders, never cascades) |
| OpenAI LLM provider | ✅ | `gpt-4o-mini`, strict Structured Outputs, non-streaming (the `chat:delta` channel is reserved for a future streaming upgrade) |
| Action Dispatcher (confirm gate) | ✅ | `ConfirmationStore` holds a validated, single-use proposal (90 s timeout = **cancel**, never auto-confirm); the execute layer is the **only** mutator; byte-identical to the direct-create path (regression-gated) |
| Voice confirmation | ✅ | "yes/no/repeat" spoken confirm resolves the open proposal deterministically in main (never via the LLM) |
| Tool-calling / web search | ✅ | `SearchProvider` seam + OpenAI search provider; the engine runs a search when the model asks **or** when its reply promises a lookup (reply-text heuristic backstops the unreliable flag); answers with cited sources; bounded + honest on timeout/failure |
| Streaming TTS | ✅ | OpenAI audio streamed to the audio window via MSE for low latency; blob fallback when a MIME isn't streamable; failures degrade to Windows voice without double-speaking |
| Reminder popup (as chat client) | ✅ | Frameless, always-on-top (`screen-saver` level), shown **inactive** (no focus steal), bottom-right of the cursor's display; FIFO queue with "+N more"; Complete/Snooze/Dismiss; **text or voice** reply in the reminder's own session; natural-language lifecycle (complete/snooze/cancel, delete gated by yes/no) |
| Reminder → chat delivery | ✅ | A reminder created inside a chat is delivered back into that chat as a `kind='reminder'` turn and broadcast live |
| Voice controls | ✅ | **Stop speaking** button (main chat + popup); pressing the mic **interrupts** Yogi mid-sentence and starts listening; **"🔎 Searching the web…"** status while browsing |
| Settings — AI Assist | ✅ | Consent-gated enable; write-only API-key entry (save/validate/remove) with DPAPI encryption; STT provider select; TTS provider + voice picker (6 personalities, with hints) + speed (with readout); web-search toggle |

## Wired-but-idle / not yet built (honest)

| Feature | Status | Notes |
| --- | --- | --- |
| Long-term memory | ⛔ Schema-only | `memories` table exists and `ContextBuilder` ships an (empty) `memories: []` slot wired for it, but there is **no extraction, recall, or UI** |
| `conversations` telemetry table | ⛔ Unused | Created (M002); distinct from the faithful `chat_turns` render source; not currently written |
| Streaming LLM replies | ⛔ Reserved | `chat:delta` channel + `LlmProvider.stream?` exist; `supportsStreaming=false` — replies arrive whole |
| Non-OpenAI LLMs (Ollama/Anthropic/Gemini) | ⛔ Not started | In the `LlmProviderId` union; only OpenAI is implemented |
| Action intents beyond reminders | ⛔ Classified only | `research`/`memory_*`/`settings` intents are recognized but have **no executor** — only `reminder_create` executes (via the local parser, not raw LLM output) |
| Edit reminder UI | ✅ Done (2026-07-15) | `ReminderEditor` modal on the Schedules screen — edit name, date/time, and repeat settings, or create a new reminder from scratch |
| Sing / MP3 playback | ⛔ Deferred | Parser + sink branch exist; no bundled MP3 (deferred at the user's request) |
| Monthly / yearly / custom recurrence | ✅ Done (2026-07-15) | Full daily/weekly/monthly/yearly + every-N, multi-weekday, and COUNT/UNTIL end conditions — available from the reminder editor. **Chat NL still understands daily/weekly only** (monthly/yearly/custom are UI-only, by design) |
| `LegacyChatScreen` | ⚠️ Fallback | The pre-conversation single-shot screen is retained behind `conversation_ui_enabled`; duplicates card logic (a maintenance fork) |

**Feature flags (in settings, all default-on for v2):** `conversation_ui_enabled`, `dispatcher_enabled`, `voice_confirm_enabled`, `reminder_popup_enabled`, `web_search_enabled`.

---

# Current User Flow

Working today, end to end:

1. Launch → **onboarding** on first run (3 panes), else straight to the app on the **Chat** screen (left rail: Chat / Schedules / History / Settings).
2. **Chat** shows a **sessions sidebar** (past, resumable conversations) beside a scrolling transcript with a docked composer + mic. A branded spinner covers the brief settings-load.
3. **Talk to Yogi** by voice (press mic → speak → transcript fills the composer) or by typing. Pressing the mic while Yogi is speaking **interrupts** and starts listening.
4. **If the cloud is off** (no key / AI Assist disabled): Yogi handles reminder-shaped input with the local parser and otherwise shows a short "connect OpenAI to chat" notice.
5. **If AI Assist is on:** Yogi replies conversationally. While it works, an animated **thinking** indicator (or **"🔎 Searching the web…"**) shows in the transcript. A **Stop speaking** button appears while Yogi talks.
6. **Needs live facts** (e.g. "contact number of NIT Hamirpur"): the engine runs a **web search** and answers with a short answer + **sources**; on timeout/failure it says so honestly rather than hanging.
7. **Asks for a reminder:** Yogi proposes it through the **Action Dispatcher** — a confirmation card with the title, absolute + **live** relative time, and recurrence. Confirm by **clicking** *Confirm Reminder* or **saying "yes"**. Only then is it written to SQLite and it appears under **Active Schedules** (linked to this chat).
8. **At the due time** (window open **or** in the tray): a Windows **notification** fires and Yogi **speaks** the reminder — both unconditionally.
9. **The reminder popup** appears (if enabled) bottom-right, always-on-top, without stealing focus. It shows the reminder and lets the user **converse** — Complete/Snooze/Dismiss by button, or by natural language ("mark it done", "snooze an hour"), or ask a follow-up that continues the reminder's chat. Multiple simultaneous reminders queue with "+N more".
10. If the reminder came from a chat, its firing is also **delivered back into that chat** as a distinct reminder bubble.
11. **History** records every triggered/completed/dismissed/snoozed/missed event. **Overdue catch-up** reports one-time reminders missed while closed.
12. **Pause all** (tray / banner / settings) stops everything; **Resume** restarts. **Settings → Reset local data** (type `RESET`) wipes local data and relaunches into onboarding.
13. **Theme** (System/Light/Dark) applies to the main window **and** the reminder popup (both follow the user's forced choice).

---

# Current Screens

| Screen | Purpose | Highlights |
| --- | --- | --- |
| **Onboarding** | First-run privacy + usage intro | 3 panes, dot indicator; mic permission deferred |
| **Chat** | Converse with Yogi; create reminders | Sessions sidebar (resumable, deletable, auto-titled), scrolling transcript, docked composer + mic, example chips, live-transcript strip, animated thinking / searching states, Stop-speaking, confirmation/clarification/dispatch cards |
| **Active Schedules** | See/manage upcoming reminders | Absolute + **live** relative time, recurrence in plain English, **＋ New reminder** + per-row **Edit** (name/date/time/repeat), per-reminder pause (recurring), delete (**confirmed**), pause-all |
| **History** | Past reminder activity | Filter chips (All/Completed/Dismissed/Missed); illustrated empty state |
| **Settings** | Preferences, privacy, AI Assist | Privacy + data folder; **OpenAI** (consent-gated AI Assist, write-only DPAPI key, STT provider); **Voice** (provider, 6-voice picker with hints, speed + readout, preview); Speak-aloud; Pause-all; Close-action; Theme; Reset; About |
| **Reminder popup** (separate window) | Act on / converse about a fired reminder | Always-on-top toast + chat client: title/description/spoken line, scrollable thread with sticky composer, mic (voice reply) + Stop-speaking, Complete/Snooze/Dismiss, "+N more" queue chip; honors the app theme |
| **Trigger modal** (overlay) | In-app fired-reminder actions (when popup disabled) | Dismiss/Done/Snooze; "+N more waiting" chip; queues multiples |
| **Overdue modal** (overlay) | Report missed-while-closed | Shown once on startup when applicable |

---

# Current Database

SQLite at `%APPDATA%\LifeOS\lifeos.db` (dev: `%APPDATA%\lifeos\`), WAL, **schema `user_version` 8**, **18 tables** (M001–M008; the 8 tables below are the original core set — the Gmail work M006–M008 added 10 more: `gmail_*`, `email_ai_context`, `web_research`; see [`docs/DATABASE.md`](../DATABASE.md)).

| Table | Purpose | Notes |
| --- | --- | --- |
| `reminders` | Core reminder records | `scheduled_at` (intent) vs `next_fire_at` (scheduler compares); epoch-ms; IANA `timezone`; RRULE or null; status/source/is_paused; **`session_id`** (M003, nullable, app-managed — links a reminder to the chat that made it) |
| `reminder_history` | Execution + user-action log | FK → `reminders` **ON DELETE CASCADE**; `title_at_time` denormalized; action ∈ triggered/dismissed/completed/snoozed/missed/failed |
| `settings` | Key/value preferences (34 keys) | Typed accessor layer; `ai_key_ciphertext` (DPAPI) is **never** returned over IPC (`hasApiKey` boolean instead) |
| `app_logs` | Local diagnostics | Level-gated, redacted |
| `memories` | **Future** — subject/fact/category facts | Created (M002); wired into `ContextBuilder` but unused; `is_sensitive` for health/family |
| `conversations` | **Future** — best-effort chat/intent telemetry | Created (M002); optional FK to `reminders`; unused |
| `chat_sessions` | Resumable chat threads | title, `updated_at` ordering (M003) |
| `chat_turns` | **Faithful render source** for a session | id == engine turnId; **`kind`** ('chat'\|'reminder', M004); `assistant_text` = what was shown; `proposal_summary`/`proposal_status` (pending/executed/cancelled)/`reminder_id`; distinct from the `conversations` telemetry table |

Indexes: partial `idx_reminders_due` on `(next_fire_at)` for the scheduler's hot query; plus status/history/log/session/turn indexes.

---

# Current Architecture

- **Renderer** (`src/`): React 19, sandboxed. Owns the chat UI + sessions, mic AudioWorklet capture, and ephemeral state. Subscribes to main's broadcasts (`chat:done`, `chat:searching`, `tts:speaking`, `action:resolved/expired`, `chat:turn:appended`, `reminders:changed`, `settings:changed`) and self-filters by turn/session id.
- **Main process** (`electron/main/`): the privileged Node loop. Owns SQLite, the scheduler, tray, notifications, the STT service, the **ConversationEngine**, the **Action Dispatcher**, the **provider registry**, and the **reminder-popup coordinator**. A `fanout()` helper broadcasts turn/tts/action/popup events to **every** window (the linchpin that lets the popup and main chat share one conversation). Drives Chromium's `nativeTheme` so all windows honor the theme.
- **Preload** (`electron/preload/`): sandboxed, one bundled CJS file each. The **main** preload imports channel constants; the **popup** and **audio** preloads **inline** their channel strings — the hard rule that prevents a shared code-split chunk from crashing the sandboxed preload (a past blank-screen bug, now guarded by a build check).
- **IPC** (`electron/main/ipc/`): every handler validates with Zod `.strict()`, checks sender origin, returns `Result<T>`. Chat/action/popup/tts/search channels added for v2.
- **Conversation** (`electron/conversation/`): `ConversationEngine` + `ContextBuilder` (bounded K=12 history window; a `memories` slot wired for later). Turn shape and system prompt live in `core/conversation/`.
- **Actions** (`electron/actions/`): `ActionDispatcher`, `ConfirmationStore`, `ExecutionLayer` (sole mutator), and deterministic matchers for voice-confirm and popup-lifecycle.
- **Providers** (`electron/providers/`): `registry.ts` factory + OpenAI LLM/STT/TTS/Search and offline sherpa/web-speech, all behind `core/` seams; gated by enable + key + consent.
- **Scheduler / TriggerSink** (`electron/scheduler/`): wall-clock authoritative reconcile; the sink fans out notification + history (unconditional) → TTS/audio → the UI surface (popup **or** legacy modal) → chat-delivery (best-effort).
- **Speech / TTS** (`electron/speech/`, `electron/main/tts/`): sherpa STT service; a speak coordinator that prefers **streamed** OpenAI audio and degrades to Windows voice on early failure.
- **Reminder popup** (`electron/main/reminder-popup.ts`): an electron-free, unit-tested queue/lifecycle state machine driven by an injected window.

---

# Known Issues

### Resolved in this snapshot's UX-polish pass
- ~~Offline mode returned "Connect OpenAI…" for local commands and clarification-follow-up reminders (LLM-first router)~~ → a **capability-based router** now answers time/greeting/help/settings and completes multi-turn reminders **offline**, with honest messaging only for genuine reasoning (see Progress log 2026-07-14 cont. 5).
- ~~Trigger modal "1 of N" counter was static~~ → replaced with a correct **"+N more waiting"** chip (display-only; the firing state machine was intentionally left untouched).
- ~~Relative times froze at render~~ → a `useNow()` ticker makes Schedules rows and proposal cards **count down live**.
- ~~Blank white flash on load~~ → a branded **spinner** load state.
- ~~Schedules Delete had no confirmation~~ → now **confirms** (parity with chat-session delete).
- ~~Static "Yogi is thinking…" / "…"~~ → an **animated typing indicator** (main chat + popup).
- ~~Popup ignored the user's forced theme~~ → all windows now follow the theme via `nativeTheme`.
- ~~History empty state was a lone dim line~~ → illustrated empty state (parity with Schedules).
- ~~Voice speed and voice hints were dead data~~ → speed **readout** ("1.2×") + per-voice **hint** surfaced.
- **A11y:** `aria-current` on the active rail item, `aria-label` on the chat sidebar, slider `aria-label` + value, keyboard-focus reveal for the delete-chat button, and a real **Tab focus-trap** in `Modal`.
- Stale "mic is disabled" popup comment corrected (the popup mic is fully live).

### Remaining rough edges (honest)
- **Offline capability router — bounded scope.** The local router handles time/date, greeting/help, and "open settings"; other app-control verbs ("show my schedules", "pause reminders") still fall through. The clarification-combine accumulates a pending reminder across turns but is offline-only (online uses the LLM) and resets if a fired-reminder turn interrupts the run. "Open settings" via voice with no main window yet opens on the default screen (the screen-switch is best-effort). Deeper multi-step (both title *and* ambiguous time missing) is handled but not exhaustively tested.
- **Offline STT / reminder end-to-end** is logic- and integration-tested (real engine, `provider: () => null`), but the audio-facing checklist (mic capture, popup fires, survives restart) needs a **real machine** — no mic/display in CI.
- **Button-style fragmentation** — there is no shared `.btn` primitive; primary/ghost styles are redefined in several selector groups (main + popup). A restyle must touch them in lockstep. (Cosmetic tech debt.)
- **`LegacyChatScreen` duplicates card logic** — a maintenance fork retained behind the `conversation_ui_enabled` flag.
- **Popup snooze menu** uses `role="menu"` but has no arrow-key navigation or click-outside-to-close.
- **10-minute idle-in-tray TTS endurance** has not been re-measured on the v2 build (immediate + short cases work).

### Technical debt / refactor candidates
- State-based navigation (no router) — fine for 4 screens.
- STT decode runs on the main thread (RTF ~0.07 — fast, but a worker would isolate it).
- Log-retention sweep is configured conceptually but no cleanup job is wired; no in-app log viewer.

---

# Features Recommended Next

## High priority
| Feature | Why | Complexity |
| --- | --- | --- |
| **Long-term memory (recall)** | The `memories` table + context slot are wired but empty — this is the biggest gap between "chatbot" and "companion" | Medium–High |
| **Fresh-VM QA of the packaged build** | The installer is rebuilt current (2026-07-15, incl. recurrence + branding), but the packaged GUI — reminder create/edit, a repeat firing, popup/provider surface — has not been clean-VM driven (model loads from `resourcesPath`, no-admin, no-network-with-cloud-off) | Medium |
| **Streaming LLM replies** | `chat:delta` is reserved; token streaming would make long answers feel instant | Medium |
| **Monthly/yearly recurrence in chat NL** | The engine + editor already do it; `extract-recurrence.ts` could learn "every month/year/N days" so voice matches the UI | Low–Medium |
| **Error-state polish for cloud paths** | Surface key-invalid / rate-limit / offline recovery actions inline | Low |

## Medium priority
| Feature | Notes | Complexity |
| --- | --- | --- |
| Second tool in the capability layer (Weather/Calendar) | Prove the `SearchProvider`-style seam is generic; pair each tool with a heuristic backstop + logging | Medium |
| Shared button/design primitive | Collapse the fragmented button styles into one `.btn` | Low–Medium |
| Retire `LegacyChatScreen` | Once the conversation UI is trusted, delete the fork | Low |
| Sing / bundled MP3 | Sink branch exists; source a royalty-free track | Low |
| Auto-update (`electron-updater`) | **Not active** — no `electron-updater` dependency and no update feed is consumed; the `publish:` block in `electron-builder.yml` only names a GitHub target. Add the dependency + an updater wire-up to enable | Medium |
| Import/export local data (JSON) | Backup + prerequisite for any future sync | Medium |
| Accessibility deep pass | NVDA, popup menu keyboarding, focus order | Medium |
| More renderer + E2E tests | Confirmation-gate RTL tests, packaged smoke, popup flows | Medium |

## Future vision
- **Local LLM (Ollama)** behind the existing `LlmProvider` seam — intelligence with zero network/cost, collapsing the consent apparatus.
- **Personal knowledge graph** on top of the memory system (SQLite FTS first, embeddings only if needed).
- **More tools** — weather (Open-Meteo), maps, and opt-in **Gmail / Calendar** integrations behind the capability layer, each disclosed.
- **Optional E2EE cloud sync + multi-device** — the decision that ends "no server".
- **macOS / Linux ports** — `core/` is already pure TS; only `electron/` would be rewritten.

---

# Suggested Development Order

Optimising for **stability → intelligence → UX → maintainability**, with privacy held constant:

1. **Personalization spine:** build memory extraction + recall on the wired `memories` table and the `ContextBuilder` slot — the highest-leverage step toward "companion".
2. **Prove the packaged v2:** re-package (NSIS + portable), run a fresh-VM QA pass, and re-verify no-admin / no-network-with-cloud-off / model-from-resources / the 10-min idle TTS case.
3. **Close intelligence UX gaps:** streaming LLM replies, inline cloud error recovery, edit-reminder form.
4. **Extend the capability layer:** a second tool (weather or calendar) behind the seam, to validate genericity.
5. **Repay debt:** shared button primitive, retire `LegacyChatScreen`, log-retention job, more renderer/E2E tests.
6. **Then breadth:** sing MP3, auto-update, import/export, deeper accessibility, and monthly/yearly recurrence in chat NL (the engine + editor already support it).

---

# Current completion estimate

- **The reminder MVP loop is 100% built and human-verified.** The conversation-first pivot's **core is built and working**: persistent chat, the ConversationEngine, all four OpenAI provider seams, the Action Dispatcher with click-or-voice confirmation, the reminder popup as a chat client, streaming TTS, and the tool-calling/web-search layer (now reliability-hardened and verified engaging in the running app).
- **The main remaining pillars are personalization/memory (schema-only today) and a packaged, QA'd v2 release.** Secondary gaps: streaming replies, edit-reminder UI, and design-consistency debt.
- **Biggest residual risks:**
  1. **Packaged-v2 behaviour** — the large v2 surface has not been exercised from a clean install (provider gating, popup window, streamed audio, model path). Mitigated by v1 packaged spikes, but a full pass is pending.
  2. **Small-model inconsistency** — `gpt-4o-mini` can misclassify (e.g. the web-search flag). Mitigated by the reply-text heuristic + bounded timeouts + honest failure copy; apply the same backstop pattern to any new tool.
  3. **Cloud dependency for the best experience** — offline/local paths degrade gracefully, but the richest behaviour needs the user's OpenAI key; a local-LLM option would remove this.
  4. **Unsigned installer → SmartScreen** — an availability (not security) issue; documented + checksums for the eventual release.

---

# Conclusion

LifeOS/Yogi is now a working, privacy-first **conversational** desktop companion, not just a reminder app. On top of a complete, human-verified reminder loop (local parser, wall-clock scheduler, notifications, offline STT/TTS, full lifecycle, tray, history, settings, theming, guarded reset) it adds a persistent, resumable conversation driven by a strict-JSON ConversationEngine; opt-in OpenAI intelligence behind clean provider seams (chat, transcription, streamed voice, and web search) with a DPAPI-encrypted, write-only API key; an Action Dispatcher that gates every reminder behind an explicit click-or-voice confirmation with a byte-identical write path; and an always-on-top reminder popup that is itself a voice-and-text chat client. All of it runs on-device by default, with **523 passing tests across 55 files**, a green typecheck/lint/build, and the sandboxed-preload invariant intact.

**The next logical milestone is the personalization spine — memory extraction and recall on the already-wired `memories` table — followed by re-packaging and a fresh-VM QA pass of the v2 build.** After that, the highest-value work is streaming replies and inline cloud-error recovery, then extending the capability layer with a second tool — keeping stability and privacy ahead of feature breadth, exactly as before.
