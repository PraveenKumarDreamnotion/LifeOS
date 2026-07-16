# 41 — Execution Master Plan

> **Post-roadmap feature (added after EP-1…EP-7 shipped):** the **Conversational Reminder Popup**
> ([55](55-reminder-popup-workflow.md)) — an always-on-top desktop toast that speaks a fired
> reminder and lets the user act + keep talking. It has its own P1/P2/P3 phases (`55` §6): P1 (popup
> shell + lifecycle buttons) depends only on CONV + `reminders:*`; P2 (conversation) is the deferred
> EP-6/7 lifecycle work + the mainWindow→all-windows broadcast fan-out (`55` §3). Sequenced after
> the CONV persistence + fire-into-chat work.
>
> **What this is:** the practical, build-order roadmap that turns the *architecture* docs
> (`30`–`39`) into shippable work. It decomposes the architecture into **eleven independently
> releasable execution phases (EP-1 … EP-11)**, each of which leaves the app in a working,
> demoable, testable state.
>
> **This document is the authority for BUILD SEQUENCING.** Where the *architecture* roadmap
> (`37`) and this doc disagree on order or numbering, **this doc wins.** `37` remains the
> authority for *what each capability's architecture is*; `41`/`42`–`52` are the authority for
> *the order we build them in and how*. Doc **`54`** is the authority for **release tags**,
> superseding `39`'s provisional release map. (Pointers added to the tops of `37` and `39`.)
>
> **Numbering discipline (read this once):** `37` uses *architecture phases* ("Phase 1…7");
> this plan uses *execution phases* **EP-1…EP-11**, a finer and re-sequenced decomposition.
> They are **not** the same numbers — `37` Phase 2 (OpenAI LLM) is **EP-5** here; `37` Phase 5
> (voice-confirm) is **EP-6/EP-7** here. Always say "EP-n" for build order.

---

## 1. Why the execution order differs from `37`

`37` sequenced by *architecture risk* and put the LLM first (its Phase 2), voice after. This
execution plan sequences by *build stability* and puts **voice I/O before the LLM**:

1. STT and TTS are **self-contained and independent of the LLM** — they augment the *existing,
   working reminder app* (better transcription in, natural voice out) without changing the
   interaction model.
2. They are **lower-risk** than the conversation model and they **exercise the EP-1 key
   mechanism** with the simplest possible OpenAI calls first.
3. This keeps every early release a strictly-better version of the app that already works,
   rather than a half-built new paradigm.

`RECOMMENDATION` — This reversal is deliberate and dependency-safe (§6 proves no forward
dependency). It matches the file structure the owner specified (`44`=speech, `45`=tts,
`46`=conversation-workflow). The one honest consequence: the conversation *shell* ships in
EP-2 but can't hold a real conversation until EP-5 — so **EP-2/EP-3/EP-4 demos are framed as
"the reminder app, now with better voice," not as "chat"** (§9).

---

## 2. Execution philosophy (non-negotiable)

- **Evolutionary, not a rewrite.** Build on the existing implementation. The scheduler,
  repositories, migrations, trigger fan-out, tray, notifier, and security envelope are kept
  and extended, never replaced (`30` §13).
- **Adapters over rewrites.** New capability enters behind an interface/adapter that wraps
  what exists (the provider seam, the conversation shell wrapping the current reminder flow).
- **Working software after every phase.** No EP may leave existing functionality broken. Every
  EP ends with the full reminder loop (create → confirm → schedule → notify + speak) working.
- **Feature-flagged.** Each EP's new surface sits behind a flag (§10) so a release can ship
  with it off, and a regression can be reverted by flipping the flag — not by reverting code.
- **Offline-first, cloud-optional at every step.** With no OpenAI key, every release behaves
  like today's offline app. Cloud is opt-in, per-feature, consented, revocable (`32` §2).
- **The confirmation gate and "LLM proposes / app validates / human confirms" survive every
  phase** (`30` §13, `31` §6, `36` §7).

---

## 3. EP-0 — the v0.1 baseline gate (settle this first)

`current-project-status.md` reports the **offline MVP at ~95%**: built and human-verified, but
**unsigned, not fresh-VM-QA'd, and not yet published**. This roadmap builds eleven phases *on
top of that baseline*.

`MVP DECISION` — **Finish and ship the offline MVP as v0.1 before releasing EP-2.** Concretely:
- **EP-0 work** (from `39` §3, `30` §7): Authenticode signing (Azure Trusted Signing), the
  fresh-VM QA pass + Wireshark/Procmon evidence, README/PRIVACY/checksums, the first public
  GitHub Release, and the STT-model checksum pin.
- **Sequencing:** EP-0 may run **in parallel** with EP-1 (EP-1 is internal refactoring that
  doesn't change user-facing behaviour), but **v0.1 must be published before any cloud phase
  (EP-3+) ships**, because it is the trust baseline the whole "privacy-first, cloud-optional"
  story rests on. Building cloud features atop an un-shipped, unsigned app is a real risk.
- **Assumption stated:** every EP from EP-1 onward assumes the v0.1 codebase as its starting
  point and assumes v0.1 is (or is about to be) published.

EP-0 has no `42`-series doc of its own — it is the carryover checklist in
`current-project-status.md` + `39` §3. It is listed here so the roadmap does not silently
assume a shipped baseline that does not yet exist.

---

## 4. Before-planning analysis (grounded in the `30` audit)

The audit (`30`) was re-confirmed against the live tree this session (27 `electron/` modules,
unchanged). The four required questions:

### 4.1 Reuse as-is (do NOT touch — `30` §13)

| Kept | Why |
| --- | --- |
| `electron/scheduler/scheduler.ts`, `trigger-sink.ts` | Correct wall-clock scheduler + reliability-ordered fan-out. The reminder *lifecycle* is orthogonal to how a reminder is *created*. |
| `core/scheduling/next-occurrence.ts`, `rrule.ts` | DST-correct, unit-tested. (One dedup with `format.ts` in EP-1.) |
| `electron/notifications/notifier.ts`, `electron/tray/tray.ts` | Work; notification stays unconditional-and-first. |
| `electron/database/*` (driver, migrations 001/002, repos) | `SqliteDriver` seam + parameterised repos + `CreateReminderInput` + business rules are the trusted writer, reused behind the dispatcher. |
| `electron/services/reset-*`, `electron/main/{lifecycle,paths}.ts` | Correct, guarded, minimal. |
| `src/hooks/useSpeech.ts`, `src/features/chat/MicButton.tsx`, `src/components/Modal.tsx` | Speech capture + mic UI + modal primitive are reused by the conversation UI. |
| The **secure `webPreferences`, navigation locks, default-deny network, CSP** | Extended (one origin) never weakened (`32` §3). |
| Packaging fundamentals (NSIS `perMachine:false`, `extraResources`, `asarUnpack`) | Correct; only signing is added (EP-0). |

### 4.2 Refactor (extend/adapt, keep behaviour)

| Refactor | Where | EP |
| --- | --- | --- |
| Extract `SpeechProvider`/`TextToSpeechProvider`/`LlmProvider` + factory (`33`) | new `core/*` + `electron/providers/` | EP-1 |
| Fix the dead `aiAssistEnabled:()=>false` seam → live, re-installable predicate (`30` D1) | `electron/main/index.ts`, `session.ts` | EP-1 |
| Consolidate speech IPC onto `guard()`; delete dead `onFinal`/`voiceId`/`rate`/`audio:ready/error` plumbing (`30` D4/D8) | `electron/main/ipc/speech.ts`, `preload/*`, `audio-host.ts` | EP-1 |
| Dedup RRULE grammar (`rrule.ts` vs `format.ts`, `30` D2); fix `last_triggered_at`-on-missed bug (`30` D3); strip SPIKE diagnostics (`30` D9) | `core/`, `electron/scheduler/`, `electron/speech/` | EP-1 |
| `SettingsDto`/`SettingsUpdate` dedup + typed accessors (`30` D6) | `core/types`, `src/lib/ipc.ts`, `settings-repository.ts` | EP-1 (mechanism), EP-8 (full UX) |
| `ChatScreen` single-shot → conversation message list (`30` §3.1) | `src/features/chat/*` | EP-2 |
| `core/parsing` `Intent`→`ReminderIntent`; `parseReminder` demoted to offline reminder executor behind the dispatcher (`30` §9.2) | `core/parsing/`, `electron/actions/` | EP-6 |
| Split `App.tsx` (router + modal host + onboarding gate) | `src/app/` | EP-2 (start), EP-8/EP-11 (finish) |

### 4.3 Untouched (correct, and out of scope for the pivot)

Scheduler internals, recurrence math (beyond the dedup), the reminder DB schema (migrations
001/002), the reset flow, the notification/tray behaviour, the packaging model. These are the
"do not change" list from `30` §13 — the pivot changes how a reminder is *created* and how the
app *converses*, not how a reminder *fires*.

### 4.4 Replace (retire the old primary path; keep the mechanism)

| Replaced as the primary path | Replaced by | Mechanism retained? |
| --- | --- | --- |
| Single-shot `parse → ResultCard` as the main interaction | Conversation message list (EP-2) with the card as a message variant | Yes — the parser + card logic are reused inside the bubble |
| `ChatScreen`'s direct `ipc.createReminder` after Confirm | `action:confirm` → Action Dispatcher → execute (EP-6) | Yes — same repo/`CreateReminderInput`/business rules behind the dispatcher |
| Hardcoded `speechSynthesis` voice pick (`audio-host.ts` ignores `voiceId`) | Provider + voice catalog (EP-4) | Yes — web-speech remains the offline `TextToSpeechProvider` |
| Regex-only intent detection as the authority | LLM `AssistantTurn` intent (EP-5) with regex as the offline fallback | Yes — regex parser is the offline reminder executor |

### 4.5 Tech debt to resolve BEFORE new features (all in EP-1)

`30` D1 (dead network seam — blocks all cloud), D4 (speech guard), D6 (SettingsDto dup —
blocks Settings growth), D8 (dead plumbing — the voice/rate channels EP-4 needs), plus D2/D3/D9
(cleanups). EP-1 is deliberately a **no-new-user-feature** phase whose entire job is to pay this
debt and stand up the seams, so every later phase plugs into clean interfaces.

---

## 5. The eleven execution phases (canonical order)

| EP | Doc | Objective (one line) | Cloud? | Ships (tag §7) |
| --- | --- | --- | --- | --- |
| **EP-1** | `42` | Cleanup, tech-debt, provider interfaces + factory, key **mechanism** + minimal OpenAI settings, dead-seam fix | no | v0.2 |
| **EP-2** | `43` | Conversation shell (message list) **wrapping the existing reminder flow**; offline | no | v0.3 |
| **EP-3** | `44` | OpenAI STT (batch) behind `SpeechProvider` + sherpa fallback | opt-in | v0.4 |
| **EP-4** | `45` | OpenAI TTS + voice catalog/preview + the new `audio:playBytes` path; thread voiceId/rate | opt-in | v0.4 |
| **EP-5** | `46` | OpenAI LLM: real chat / Q&A / long conversations (reply-only intents) | opt-in | v0.5 |
| **EP-6** | `47` | Action Dispatcher + structured actions + validation gates; **re-route reminder create through it** | opt-in | v0.6 |
| **EP-7** | `48` | Reminder workflow v2: conversation create, **voice confirm/cancel**, edit, delete | opt-in | v0.6 |
| **EP-8** | `49` | Settings **UX** redesign: provider selection, voice picker, consent management, privacy-copy | opt-in | v0.7 |
| **EP-9** | `50` | Memory foundation: `memories` adoption, FTS5, save/recall, "what do you remember" screen | opt-in | v0.8 |
| **EP-10** | `51` | Research foundation: `ResearchProvider`, Weather (Open-Meteo), tool routing | opt-in | v0.9 |
| **EP-11** | `52` | Polish: animations, performance, accessibility, testing, packaging → **stable LifeOS** | — | v1.0 |

---

## 6. Dependency graph (proves no forward dependency)

```text
EP-0 (ship v0.1) ──┐
                   ▼
EP-1 (seams + key mechanism + dead-seam fix)         ← blocks everything cloud + the dispatcher
   ├──► EP-2 (conversation shell, offline)           ← needs EP-1 message/provider scaffolding
   ├──► EP-3 (OpenAI STT)    needs: EP-1 key mechanism only
   │        └──► EP-4 (OpenAI TTS + voice)  needs: EP-1 key + EP-3's audio-bytes groundwork
   └──► EP-5 (OpenAI LLM)    needs: EP-1 key + EP-2 conversation shell
              └──► EP-6 (Action Dispatcher)  needs: EP-2 (proposal UI) + EP-5 (LLM actions)
                        └──► EP-7 (Reminder v2)  needs: EP-3 (STT for voice-confirm) + EP-6
EP-8 (Settings UX)   needs: EP-1..EP-5 (the settings they introduce, now consolidated)
EP-9 (Memory)        needs: EP-6 (dispatcher branch) ; extends EP-5 context window BACKWARD
EP-10 (Research)     needs: EP-6 (dispatcher branch)
EP-11 (Polish)       needs: all
```

**No phase depends on a *later* phase.** Two backward-extension points are called out so they
don't become forward edits:
- `MVP DECISION` — **EP-5 must ship the empty `memories: []` slot** in the LLM context window
  (`31` §4.3). EP-9 then *fills* it — an additive change, not an EP-5 rewrite.
- `MVP DECISION` — **EP-6 replaces a working path** (EP-2's direct `ipc.createReminder`). Its
  DoD carries an explicit **regression gate**: reminder-create outcome must be byte-identical
  pre/post, and the old direct path stays behind a flag until the dispatcher path is verified
  on a real build.

---

## 7. EP → release tag map (authority: `54`, supersedes `39`)

`MVP DECISION` — This map **supersedes `39`'s provisional release table** (which was ordered to
`37`'s architecture phases). `54` owns the canonical, live version of this map; `39` gets a
top-of-file pointer marking its table provisional. **One release scheme, defined once.**

| Tag | EP(s) | Theme | Network posture |
| --- | --- | --- | --- |
| **v0.1** | EP-0 | Ship the offline MVP (signed, QA'd, published) | zero |
| **v0.2** | EP-1 (+ trust repayments: auto-update, monthly recurrence) | Internal seams + debt paid; still offline | zero |
| **v0.3** | EP-2 | Conversation shell; reminders unchanged; offline | zero |
| **v0.4** | EP-3 + EP-4 | Cloud **voice** (STT in, natural voice out), opt-in | openai only when voice enabled |
| **v0.5** | EP-5 | Cloud **conversation** (chat/Q&A), opt-in | openai only when chat enabled |
| **v0.6** | EP-6 + EP-7 | Structured actions + Reminder v2 (voice confirm, edit, delete) | as v0.5 |
| **v0.7** | EP-8 | Settings UX redesign (providers, voice picker, consent) | as v0.5 |
| **v0.8** | EP-9 | Memory foundation | memory never sent; sensitive excluded |
| **v0.9** | EP-10 | Research foundation (Weather first) | per-provider consented origin |
| **v1.0** | EP-11 | Polish, performance, a11y → **stable LifeOS** | unchanged |

`FUTURE OPTION` — **Ollama** (local LLM, `24`/`33` §4) lands **post-1.0 (v1.x)** behind the
existing `LlmProvider` seam — it needs a separate ~2 GB install and is not on the critical path.
(This replaces `39`'s old "v0.8 = Ollama"; the conversation pivot consumes v0.2–v0.9, pushing
Ollama past 1.0 — the resequencing already flagged in `39` §1.)

---

## 8. Cross-cutting invariants — checked at EVERY phase

Each phase doc's Definition of Done re-asserts these; `53` has the standing regression suite:

1. **The full reminder loop works** (create → confirm → schedule → notify + speak), offline,
   with no OpenAI key.
2. **Zero outbound packets with all cloud features off** (Wireshark, `11` §14 SEC-10).
3. **The confirmation gate holds** — nothing consequential persists without a human/voice
   Confirm (the safe-settings carve-out is the only exception, `30` §13.1 / `36` §4.2).
4. **The API key never crosses IPC**; all OpenAI calls happen in main (`32` §3.3).
5. **The LLM never actuates** — it returns JSON; the app validates + executes (`31` §6, `36` §7).
6. **Notification + history fire unconditionally and first**; speech/LLM/network are best-effort
   (`30` §13.4).
7. **No `child_process`/`eval`/dynamic import** anywhere but the one allowlisted TTS file
   (`11` §7, ESLint-enforced).

---

## 9. Honest per-phase demos (EP-2 → EP-4)

Because conversation intelligence doesn't land until EP-5, the EP-2/EP-3/EP-4 demos are framed
around the **reminder app**, which genuinely improves each phase:
- **EP-2 demo:** "the reminder app now shows your requests and Yogi's responses as a scrolling
  conversation" (not "chat with Yogi").
- **EP-3 demo:** "dictate a reminder with much better accuracy" (OpenAI transcription).
- **EP-4 demo:** "reminders are spoken in a natural voice you chose."
- **EP-5 demo:** *now* "ask Yogi anything — it converses."

Each phase doc's "Expected App Behaviour" and "Conversation Testing" sections reflect this: in
EP-2–EP-4, non-reminder input shows the honest placeholder ("Connect OpenAI in Settings to chat
and answer questions"); from EP-5 it converses.

---

## 10. Feature-flag registry (rollback without code revert)

Each EP's new surface is gated so a release can disable it and a regression is a flag flip:

| Flag | Introduced | Off ⇒ |
| --- | --- | --- |
| `conversation_ui_enabled` | EP-2 | old single-shot `ChatScreen` |
| `stt_provider='openai'` (+ consent) | EP-3 | sherpa (offline) |
| `tts_provider='openai'` (+ consent) | EP-4 | Windows voices |
| `ai_assist_enabled` (+ consent) | EP-5 | offline placeholder for chat/Q&A; local parser for reminders |
| `dispatcher_enabled` | EP-6 | EP-2's direct reminder-create path (the regression fallback, §6) |
| `voice_confirm_enabled` | EP-7 | button-only confirmation |
| `memory_enabled` | EP-9 | memory intents refused in the dispatcher (`31` §2) |
| research providers (per-provider) | EP-10 | research intent refused |

All cloud flags default **off**; `conversation_ui_enabled` defaults on at its release with the
old path one flag away.

---

## 11. Testing authority (one owner per test — avoids drift)

`MVP DECISION` — **`53` is the aggregator + cross-phase suites** (conversation, voice,
settings, security, regression, performance). **Each phase doc (`42`–`52`) owns its
phase-specific manual/edge/failure/recovery checklist.** `53` *references* the phase checklists;
it does not copy them. This mirrors the §7 "one authority per concern" discipline that kept the
architecture docs consistent — applied to testing so the same version-drift problem cannot recur
in test form.

Every phase DoD requires: its phase checklist green, the §8 invariant regression suite green,
and (from EP-3) the Wireshark off→zero / on→openai-only check.

---

## 12. Document map

| Doc | Owns |
| --- | --- |
| `41` (this) | Build-sequence authority; reuse/refactor tables; dependency graph; EP→tag map; invariants |
| `42`–`52` | The eleven phase execution plans (EP-1…EP-11), full template each |
| `53` | Complete testing guide: aggregator + cross-phase conversation/voice/settings/security/regression/perf suites |
| `54` | Release-tag authority (supersedes `39`): tags, go/no-go gates, mechanics, cadence |

Architecture reference (unchanged): `30` (audit), `31` (conversation engine), `32` (OpenAI),
`33` (providers), `34` (settings), `35` (voice), `36` (dispatcher). `37`/`39` are superseded for
*order/tags* only (pointers added), and remain valid for *architecture*.
