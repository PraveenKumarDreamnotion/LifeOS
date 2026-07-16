# 52 — Execution Phase EP-11: Polish & Release

> **Ships:** v1.0 — **stable LifeOS** (`41` §7). **Cloud posture:** unchanged from v0.9; EP-11
> adds **no new capability and no new network origin**. It is the *"earned v1.0"* — stability
> and trust proven, not a feature milestone (`24` v1.0: *"v1.0 is not a feature milestone. It
> is a claim: the confirmation gate, the scheduler and the privacy guarantees have survived
> real users for a quarter."*).
>
> **Depends on:** all prior EPs (`41` §6 — "EP-11 needs all"). **Authority:** `41` (build
> sequence); **`54`** for release mechanics/tags. This doc owns the EP-11 phase checklist
> (`41` §11).

---

## Objective

Take the feature-complete v0.9 app to a **stable, polished, accessible, well-tested, signed
v1.0**, touching four fronts and one gate:

- **Polish** — animations/transitions across nav, modals, chat bubbles, and proposal cards
  (calm, motion-reduced-aware; nothing that delays a reminder firing).
- **Performance** — address the two `30` §6 ceilings: **main-thread synchronous SQLite** and
  **STT decode on the main thread** → evaluate a `utilityProcess`/async facade; add
  **statement caching** (`30` D11); fix `activeCount()` materialising the full list (`30` §6);
  make the logger write off the hot path.
- **Accessibility** — close the `30` renderer-audit a11y gaps: **modal focus trap +
  restoration**, `aria-current` on nav, `aria-pressed` on filter toggles, **labeled emoji**,
  and disciplined focus management across the conversation UI.
- **Testing completion** — close the untested-layer gaps `30` §10 named: renderer/React (jsdom),
  the IPC guard/validation boundary, the speech pipeline, plus an E2E/smoke of the **packaged**
  app.
- **Packaging + final release** — sign, QA on a fresh VM, publish v1.0 per **`54`**.

`MVP DECISION` — EP-11 changes **no product behaviour** except making existing behaviour
smoother, faster, more accessible, and more thoroughly tested. Every `41` §8 invariant must
remain literally true; the release gate re-asserts them.

---

## Why this phase exists

`30` was blunt about what was left unpaid: *"zero tests above the database/scheduler"* (§10),
*"the layers about to change most … are precisely the untested ones,"* two named performance
ceilings (§6), a list of concrete a11y gaps in the renderer audit, and **unsigned binaries**
(§7 S6). Every prior EP added surface to exactly those under-tested, main-thread-bound layers
(conversation UI, IPC, providers, memory, research). EP-11 is where that accumulated
polish/perf/a11y/test debt is paid so the v1.0 *claim* (`24` v1.0) is honest: the gate, the
scheduler, and the privacy guarantees have survived real use and are now proven under test.

It is deliberately last because polishing earlier would have polished a moving target; now the
feature set is frozen (v0.9), the surfaces are stable, and hardening them sticks.

---

## Current code that will be reused

| Reused as-is | Why |
| --- | --- |
| The **entire security envelope** (`windows.ts` flags, `session.ts` allowlist/CSP, preload, navigation locks — `30` §7) | EP-11 hardens performance/a11y **around** it; it never weakens a lock (`30` §13.3). |
| The **persisted-`next_fire_at` + 30 s poll scheduler** (`scheduler.ts`, `30` §13.5) | Must **not** be "optimised" into `setTimeout`s or made async without a reentrancy guard (`30` §13.5) — a hard constraint on the perf work. |
| The **reliability-ordered trigger fan-out** (notification + history first, `30` §13.4) | Animations/TTS stay best-effort and last; a reminder must fire even if everything cosmetic is down. |
| `SqliteDriver` seam (`10` §2, `node-sqlite-driver.ts`) | Statement caching + any async facade land **behind** the 6-method interface — a localised change (`30` D11). |
| `src/components/Modal.tsx` (`30` §4.1 reused primitive) | The focus-trap/restoration work extends this one primitive rather than every modal. |
| `App.tsx` nav rail + `View` routing (`src/app/App.tsx`) | `aria-current`/labeled-emoji are additive attributes; the EP-2/EP-8 split of `App.tsx` is finished here (`30` §4.2 refactor row, "EP-8/EP-11 finish"). |
| The CI pipeline (typecheck + lint + tests on `windows-latest`, `30` §10) | Extended with the new jsdom vitest project + coverage + a packaged smoke — not replaced. |
| Packaging fundamentals (NSIS `perMachine:false`, `extraResources`, `asarUnpack`, `latest.yml`, `30` §2.7) | Correct; EP-11 adds **signing** and the fresh-VM QA (the EP-0 carryover made durable). |

---

## Code that must be refactored

| Refactor | Where | Note |
| --- | --- | --- |
| **Statement caching** in the driver | `electron/database/drivers/node-sqlite-driver.ts` | Cache `db.prepare()` by SQL string behind the `SqliteDriver` seam (`30` D11). One-file change; no repo/schema edits. |
| **`activeCount()` → `SELECT COUNT(*)`** | `electron/database/reminder-repository.ts` | Stop materialising the full active list to take `.length` on every tray refresh (`30` §6). |
| **STT decode isolation** | `electron/speech/sherpa-speech-service.ts` (behind `SpeechProvider`, EP-1/EP-3) | Evaluate moving the synchronous `while(recognizer.isReady) decode()` loop to a `utilityProcess`; the provider interface already abstracts it (`30` §6, §11). |
| **DB async facade (evaluation)** | new `electron/database/async-facade.ts` (optional) | Consider a `utilityProcess`/worker for `listAll`/history as they grow (`30` §6). **Constraint:** the scheduler's `reconcile` stays synchronous + reentrancy-guarded (`30` §13.5). |
| **Logger off the hot path** | `electron/logging/logger.ts` | Batch/defer the synchronous `db.run` INSERT + redaction so it doesn't block the event loop per call (`30` §6). |
| **Modal focus trap + restoration** | `src/components/Modal.tsx` | Trap Tab within the modal; restore focus to the invoking element on close (`30` §10 a11y gap). |
| **Finish the `App.tsx` split** | `src/app/` | Router + modal host + onboarding gate separated; add the `ErrorBoundary` (`30` §9.6, §4.2). |
| **Filter/toggle ARIA** | `src/features/history/*`, `src/features/schedules/*` | `aria-pressed` on filter buttons; `aria-current="page"` on the active nav item. |
| **Labeled emoji** | `src/app/App.tsx` nav, chips, badges | Decorative emoji get `aria-hidden`; meaningful ones get an accessible label (`30` §10). |

`MVP DECISION` — The scheduler is on the `30` §13 "do not change" list. Any async/utilityProcess
work is confined to **STT decode, logging, and read-heavy queries** — never the
`next_fire_at`+poll core, and never `reconcile` (which is safe *only* because every step is
synchronous, `30` §13.5).

---

## Files expected to change

```
electron/database/drivers/node-sqlite-driver.ts   # statement cache
electron/database/reminder-repository.ts           # activeCount() → COUNT(*)
electron/database/async-facade.ts                  # NEW (optional) — read-query worker facade
electron/speech/sherpa-speech-service.ts           # STT decode → utilityProcess (evaluate)
electron/logging/logger.ts                         # deferred/batched writes
src/components/Modal.tsx                            # focus trap + restoration
src/app/App.tsx                                     # split; aria-current; labeled emoji
src/app/Router.tsx  src/app/ModalHost.tsx           # NEW — finish the App.tsx split
src/components/ErrorBoundary.tsx                    # NEW — renderer error boundary (30 §9.6)
src/features/history/HistoryScreen.tsx              # aria-pressed on filters
src/features/schedules/SchedulesScreen.tsx          # aria-pressed; focus mgmt
src/features/chat/*                                 # transitions; focus on new bubbles; reduced-motion
src/styles/motion.css                              # NEW — transitions + prefers-reduced-motion
vitest.config.ts / vitest.jsdom.config.ts           # NEW jsdom project + coverage
tests/renderer/** tests/ipc/** tests/speech/**      # NEW — close the 30 §10 gaps
tests/e2e/smoke.spec.ts                             # NEW — packaged-app smoke
electron-builder config                             # Authenticode signing wiring (54)
```

---

## New folders

- `tests/renderer/`, `tests/ipc/`, `tests/speech/`, `tests/e2e/` — the coverage the `30` §10
  audit named as missing.
- `src/styles/` (if not already present) for `motion.css`.
- (`electron/database/async-facade.ts` and the split `src/app/` files reuse existing folders.)

---

## New services

- **DB read-query async facade (optional, evaluated in this phase)** — a `utilityProcess`-backed
  reader for growing `listAll`/history queries, behind the `SqliteDriver` seam, **only if** the
  perf tests below show main-thread stalls at realistic history sizes. If they don't, it is not
  shipped (avoid speculative complexity).
- **STT decode utilityProcess** — isolates ONNX inference off the main thread (`30` §6, §11),
  behind the existing `SpeechProvider` interface.
- **`ErrorBoundary`** (renderer) — catches render errors and shows a recoverable fallback
  instead of a white screen (`30` §9.6).
- No new *provider* and no new *capability* service (EP-11 ships none).

---

## IPC changes

- **No new channels and no changed contracts.** EP-11 is behaviour-preserving. Any async DB
  facade is entirely main-internal — the IPC surface the renderer sees is unchanged.
- The **typed IPC handler registry** suggested in `30` §5.6 (`register(channel, schema, fn)`)
  may be adopted as an internal refactor to guarantee every handler is `guard()`-wrapped
  uniformly — a structural hardening, not a contract change. Covered by the new IPC tests.

---

## Database changes

- **No migration.** No schema change, no new table, no new setting that alters behaviour.
- **Statement caching** (`30` D11) and the `activeCount()` fix are query-execution changes only.
- The retention sweep (`10` §9) and `PRAGMA` set are unchanged; EP-11 may add
  `PRAGMA optimize` at close and verify `auto_vacuum=INCREMENTAL` is effective — a tuning, not a
  schema, change.

---

## UI changes

- **Motion:** calm enter/leave transitions for nav switches, modal open/close, chat-bubble
  append, and proposal-card state changes — all gated on
  `@media (prefers-reduced-motion: reduce)` (motion off ⇒ instant, no loss of function).
- **Accessibility:**
  - Modals **trap focus** and **restore** it to the invoking control on close (`Modal.tsx`).
  - Nav items carry `aria-current="page"` for the active `View`.
  - History/Schedules filter toggles carry `aria-pressed`.
  - Emoji: decorative ones `aria-hidden="true"`; meaningful ones get a visually-hidden label
    (the nav `💬/📅/🕘/⚙/🧠` icons, the `🔒 Local · Offline` chip, the `🔒 Sensitive` badge).
  - Focus moves sensibly to newly-rendered assistant bubbles/proposal cards without stealing
    focus mid-typing.
- **Error boundary** wraps the app shell with a recoverable fallback.
- **No copy changes** beyond a11y labels; the honest privacy copy stays accurate.

---

## Main process changes

- Statement cache in the driver; `activeCount()` uses `COUNT(*)`.
- Logger writes deferred/batched off the synchronous hot path.
- STT decode evaluated/moved to a `utilityProcess` behind `SpeechProvider`.
- Optional read-query async facade behind `SqliteDriver` (ship only if the perf tests justify).
- Scheduler, notifier, tray, session security, migrations — **unchanged** (`30` §13).

---

## Renderer changes

- Finish the `App.tsx` split (router / modal host / onboarding gate) and add `ErrorBoundary`
  (`30` §4.2, §9.6).
- Add the focus-trap/restoration, `aria-current`, `aria-pressed`, labeled-emoji, and
  focus-management changes above.
- Add reduced-motion-aware transitions.
- Add the jsdom test project so these renderer changes are actually covered (`30` §10).

---

## Provider changes

- **None functionally.** The STT provider's *implementation* may move decode to a
  `utilityProcess`, but the `SpeechProvider`/`TextToSpeechProvider`/`LlmProvider`/
  `ResearchProvider` **interfaces and behaviour are unchanged**. No new provider; no new origin.

---

## Security considerations

- **No new network origin, no new capability, no weakened lock.** EP-11 must leave the
  `session.ts` allowlist/CSP, `windows.ts` flags, preload, and navigation locks exactly as
  strong as v0.9 (`30` §7, §13.3). A regression test asserts the CSP and allowlist are
  byte-unchanged from v0.9 with all features off.
- **Signing (the EP-0 carryover, made durable):** Authenticode via Azure Trusted Signing
  removes the SmartScreen "unknown publisher" warning (`30` §7 S6, `24` v0.2). The
  auto-update feed gains authenticity, not just the existing sha512 integrity.
- **`utilityProcess` isolation** must inherit the same no-Node-in-renderer discipline; the STT
  worker handles audio only, exposes no new IPC to the renderer, and keeps the "audio never
  leaves the device" posture for the offline path intact.
- **The `41` §8 invariants are the release gate** (see DoD) — the confirmation gate, key-never-
  crosses-IPC, LLM-never-actuates, notification-first, no `child_process`/`eval` all re-verified
  under the new test suite, not just asserted.
- EP-9 sensitive-never-sent and EP-10 per-provider-origin proofs are pulled into the standing
  regression suite (`53`) and must stay green.

---

## Performance considerations

- **The two `30` §6 ceilings are the headline work:** main-thread synchronous SQLite and STT
  decode. Statement caching (D11) and `activeCount()`→`COUNT(*)` are the cheap wins; the
  `utilityProcess` moves are the structural ones — **evaluated against measured stalls**, not
  shipped speculatively.
- **Hard constraint:** the scheduler's `next_fire_at`+poll model and synchronous `reconcile`
  stay as-is (`30` §13.5) — perf work routes around them.
- Logger writes move off the per-call hot path (`30` §6).
- Animations must be GPU-friendly and reduced-motion-aware; **no** animation may delay
  notification/history firing (fan-out order preserved, `30` §13.4).
- Perf tests (below) establish the ceilings are actually raised at realistic history/memory
  sizes.

---

## Risks

- `RISK` — **A perf "optimisation" breaks the scheduler.** Mitigation: the scheduler is on the
  do-not-change list; async work is confined to STT/logging/read-queries; a regression test
  proves reminder timing is unchanged (`30` §13.5).
- `RISK` — **`utilityProcess` adds packaging complexity** (a second process, IPC to it).
  Mitigation: ship it only if measured stalls justify it; keep it behind the existing provider
  seam so it can be reverted to in-process by config.
- `RISK` — **A11y changes cause focus bugs** (focus stealing, lost restoration). Mitigation:
  jsdom + manual NVDA pass (`24` v0.2 accessibility item); focus tests in the renderer suite.
- `RISK` — **Signing/notarisation delays the release** (`30` §7 S6). Mitigation: signing is the
  EP-0 carryover already scoped; `54` owns the go/no-go and cadence.
- `RISK` — **New tests are flaky** (esp. E2E of a packaged app). Mitigation: keep the smoke
  minimal and deterministic (launch → migrate → offline reminder loop → clean exit); quarantine,
  don't disable, any flake.
- `RISK` — **Animation jank on low-end machines.** Mitigation: reduced-motion default-respect;
  short, cheap transitions; measured on the perf pass.

---

## Rollback strategy

- **Animations/a11y** are additive renderer changes — revert individually if a regression
  appears; none is behind a runtime flag because none changes behaviour, but each is an
  isolated commit.
- **The `utilityProcess`/async facade** is behind the `SpeechProvider`/`SqliteDriver` seams —
  reverting to in-process is a config/one-file change, not a rewrite (`10` §2, `30` §11).
- **Statement cache** can be disabled by a driver flag if it ever mis-caches.
- **Release-level rollback** is `54`'s mechanic: because v1.0 adds no capability, re-publishing
  v0.9 is a clean fallback; the auto-update feed (now signed) can point back.
- No migration ⇒ **no data-shape rollback needed**; a v0.9 binary opens a v1.0 DB unchanged.

---

## Definition of Done

Re-asserts the **`41` §8 invariants** as the release gate — each **verified under the new test
suite**, not merely asserted:

1. **Full offline reminder loop works** (create → confirm → schedule → notify + speak), no key
   (`41` §8.1) — covered by the packaged E2E smoke.
2. **Zero outbound packets with all cloud features off** — Wireshark off→zero (`41` §8.2).
3. **Confirmation gate holds** for reminders, memory-save, and all deletions (`41` §8.3).
4. **API key never crosses IPC** (`41` §8.4) — asserted by an IPC-response-shape test.
5. **LLM never actuates** (`41` §8.5).
6. **Notification + history fire unconditionally and first**; animations/TTS best-effort
   (`41` §8.6) — verified with all cosmetic paths forced-failing.
7. **No `child_process`/`eval`/dynamic import** outside the one allowlisted TTS file (`41` §8.7,
   ESLint-enforced).
8. **EP-9 sensitive-never-sent** payload-snapshot and **EP-10 per-provider-origin** Wireshark
   proofs green in the standing suite.
9. **Perf:** statement caching in; `activeCount()` is `COUNT(*)`; the two `30` §6 ceilings
   measured and addressed (or documented as adequate with evidence); scheduler timing unchanged.
10. **A11y:** modal focus trap + restoration, `aria-current`, `aria-pressed`, labeled emoji all
    present and NVDA-verified (`24` v0.2 pass).
11. **Testing:** the `30` §10 gaps closed — renderer (jsdom), IPC boundary, speech pipeline
    covered; a packaged-app E2E smoke passes; coverage reported.
12. **Signed** binaries; **fresh-VM QA** + Wireshark/Procmon evidence; v1.0 published per `54`.
13. The EP-11 phase checklist (this doc) is green; `53` cross-phase suites all green (`41` §11).

---

## Feature Checklist

**Already completed (pre-EP-11):**
- All capabilities: conversation, voice (STT/TTS), LLM chat, dispatcher, reminder v2, settings
  UX, memory (EP-9), research foundation (EP-10).
- `Modal.tsx`, nav rail, scheduler, security envelope, packaging fundamentals, `latest.yml`.
- 96 core tests + migration/scheduler tests (`30` §10).

**New work (EP-11):**
- Motion/transitions with reduced-motion support.
- Statement caching; `activeCount()`→`COUNT(*)`; deferred logger; STT-decode utilityProcess
  (evaluated); optional read-query async facade.
- Modal focus trap/restoration; `aria-current`; `aria-pressed`; labeled emoji; focus mgmt;
  `ErrorBoundary`; finish `App.tsx` split.
- jsdom vitest project; renderer/IPC/speech tests; packaged E2E smoke; coverage.
- Authenticode signing; fresh-VM QA; v1.0 publish (`54`).

**Deferred work (post-1.0):**
- Full async DB facade if evaluation deferred it as not-yet-needed (ship on evidence).
- Broader E2E matrix beyond the minimal smoke.

**Future work (post-1.0, `24` v1.0 / `FUTURE OPTION`):**
- macOS / Linux port (`core/` is already pure; replace `electron/` only).
- Ollama local LLM behind `LlmProvider` (`41` §7, `24` v0.4).
- Opt-in E2EE sync (the feature that ends "no server" — a legal/organisational decision, `24` v1.0).
- Places/routes/web/PDF/medical/legal research providers going live (EP-10 scaffolding).

---

## Manual Testing

| Step | Action | Expected Result |
| --- | --- | --- |
| 1 | Launch v1.0 (signed) on a fresh Windows VM. | No SmartScreen "unknown publisher"; app installs perMachine:false (no UAC); DB lands in `%APPDATA%\LifeOS\`. |
| 2 | With all cloud features off, run the full reminder loop (create → confirm → schedule → notify + speak). | Works exactly as offline v0.1; Wireshark shows **zero** packets. |
| 3 | Open and close a modal (Trigger/Overdue) via keyboard only. | Focus is trapped inside while open; on close, focus returns to the control that opened it. |
| 4 | Tab through the nav rail with NVDA running. | Active item announced as current (`aria-current`); emoji icons are labeled or silent, not read as raw glyphs. |
| 5 | Toggle a History filter with the keyboard. | Filter state announced via `aria-pressed`; visual + a11y state agree. |
| 6 | Enable "reduce motion" in Windows, use the app. | Transitions are instant; no animation; nothing breaks. |
| 7 | Force a render error (test build hook). | `ErrorBoundary` shows a recoverable fallback, not a white screen. |
| 8 | Dictate a long utterance (STT). | Tray/scheduler stay responsive during decode (utilityProcess isolation); reminder fires on time. |
| 9 | Run the packaged E2E smoke. | Launch → migrate → offline reminder loop → clean exit, all green. |
| 10 | Trigger a reminder with TTS and animations both forced to fail. | Notification + history still fire, first and unconditionally (`41` §8.6). |

---

## Edge Cases

- **Reduced-motion + a mid-flight transition** — the transition is skipped cleanly, no stuck
  half-animated state.
- **Focus restoration when the invoking element unmounted** (e.g. a reminder cleared while its
  modal was open) — focus falls back to a sensible container, never to `document.body` void.
- **Statement cache under a schema that changed at migration** — cache is keyed by SQL string,
  invalidated appropriately; a migrated connection re-prepares.
- **utilityProcess crash mid-decode** — STT degrades gracefully (the audio window self-heal /
  notification-only fallback, `30` §2.6) without taking down main.
- **Very large history (10k+ rows)** — `listAll`/history stay responsive (async facade if
  shipped, or bounded queries) and the tray `COUNT(*)` is instant.
- **NVDA + streaming assistant bubble** — the streamed text is announced as an update, not
  re-read from scratch on every token.

---

## Failure Cases

- **Signing service unavailable at build** — the release blocks (go/no-go, `54`); an unsigned
  artifact is never published.
- **utilityProcess fails to spawn (packaged)** — STT falls back to in-process decode behind the
  same `SpeechProvider`; a warning logged; the app still works.
- **Statement cache mis-prepare** — driver flag disables the cache; falls back to per-call
  `prepare()` (v0.9 behaviour); logged.
- **E2E smoke fails to launch the packaged app** — release blocked; this is exactly the
  "green CI does not prove the app packages or launches" gap `30` §10 called out, now enforced.
- **A11y change steals focus mid-typing** — caught by a renderer focus test; the change is
  reverted per the isolated-commit rollback.

---

## Recovery Tests

1. Kill the app during a reminder trigger animation → reopen → the reminder's state is correct
   (fan-out committed notification+history first, animation was best-effort).
2. Kill the STT utilityProcess mid-decode → the next dictation re-spawns it or falls back
   in-process; no main-process crash.
3. Interrupt the v1.0 auto-update mid-download → the signed feed integrity+authenticity check
   rejects a partial/altered artifact; the app stays on v0.9.
4. Open a v1.0 DB with a v0.9 binary → opens normally (no migration in EP-11); reminders intact.
5. Corrupt the renderer bundle → `ErrorBoundary`/relaunch path yields a recoverable state, not
   a permanent white screen.

---

## Regression Tests

- **The full `41` §8 invariant suite** (`53`) — all seven invariants green under the new
  renderer/IPC/speech tests, not just the old core tests.
- **Full offline reminder loop** — byte-identical to v0.1/v0.9 offline behaviour (`41` §8.1).
- **Confirmation gate** — reminders, memory-save, deletions still gated; timeout = cancel;
  renderer cannot execute an unshown action (`36` §4.3).
- **Wireshark off → zero** (`41` §8.2); **only-Weather-on → only `api.open-meteo.com`**
  (EP-10 proof carried forward).
- **EP-9 sensitive-never-sent** payload-snapshot still green.
- **Scheduler timing** — reminder fire times unchanged by any perf refactor (a timing-diff test
  against v0.9).
- **CSP/allowlist byte-unchanged** from v0.9 with all features off.
- Existing 96 core tests + migration/scheduler tests still green (`30` §10).

---

## Performance Tests

- **SQLite:** with statement caching, measure `findDue`/`listActive`/history query latency at
  1k / 10k history rows; confirm no event-loop stall that delays a 30 s tick (`30` §6).
- **`activeCount()`** is O(1) `COUNT(*)`, verified against the old full-materialisation cost.
- **STT decode:** with the utilityProcess, confirm the main-thread stays responsive (tray, IPC,
  scheduler) during a long dictation; measure RTF unchanged/better (`30` §6, §11).
- **Logger:** deferred writes do not block the hot path; a burst of logs doesn't stall the UI.
- **Animation:** transitions hold 60fps on a mid-range machine and are skipped under
  reduced-motion; none delays notification/history firing.
- **Memory (EP-9) context query** at 500 facts stays within the per-turn budget with statement
  caching applied.

---

## Expected App Behaviour (Current → EP-11)

```text
Current (v0.9 — feature-complete, but):
  • SQLite + STT decode on the main thread (30 §6 ceilings unaddressed)
  • no statement cache; activeCount() materialises the full list
  • modals don't trap/restore focus; nav lacks aria-current; emoji unlabeled
  • renderer / IPC / speech layers untested (30 §10); binaries unsigned (30 §7 S6)
  • CI green does not prove the app packages or launches

EP-11 (v1.0 — stable LifeOS):
  • same features, same behaviour, same invariants — now smoother, faster, accessible, tested
  • statement cache + COUNT(*) + deferred logger + STT/read-query isolation (scheduler untouched)
  • modal focus trap/restoration · aria-current · aria-pressed · labeled emoji · ErrorBoundary
  • jsdom renderer tests + IPC-boundary tests + speech tests + packaged E2E smoke + coverage
  • Authenticode-signed · fresh-VM QA (Wireshark/Procmon) · published per 54
  • the 41 §8 invariants re-verified under test = the earned v1.0 claim (24 v1.0)
```

---

## Conversation Testing

> EP-11 adds no conversational capability; these verify prior behaviour is **unchanged** under
> the polish/perf/a11y refactors (the point of a stable release).

- **User:** *"Remind me to call Rahul tomorrow at 9."*
  **Expected:** the reminder proposal card appears with a smooth (reduced-motion-aware)
  transition; Confirm → created; **timing and gate identical to v0.9**.
- **User:** *"My grandfather has diabetes."*
  **Expected:** the EP-9 memory-save card, unchanged; sensitive-never-sent still holds.
- **User:** *"What's today's weather?"* (Weather enabled)
  **Expected:** the EP-10 cited forecast, unchanged; only `api.open-meteo.com` contacted.
- **User:** *"Do I have dengue?"*
  **Expected:** the medical disclaimer refusal, unchanged (`24` v0.5).
- **User (with NVDA on):** any of the above.
  **Expected:** new assistant bubbles/proposal cards are announced without stealing focus
  mid-typing; the confirmation card's Confirm/Cancel are reachable and labeled.

---

## Voice Testing

> Verifies the STT-decode isolation and a11y focus work did not regress the voice path.

- Dictate a long reminder while watching the tray/scheduler → both stay responsive during decode
  (utilityProcess); the finalised transcript drives the same proposal card; the reminder fires
  on time.
- Say **"yes"** to a pending proposal → local voice-confirmation matcher (`36` §4.1) confirms as
  before; **no** transcript sent to the LLM to interpret the confirmation.
- With reduced-motion on, dictate and confirm by voice → no animation, full function.
- Force TTS to fail on a fired reminder → notification + history still fire first (`41` §8.6);
  voice output is best-effort and its absence never blocks the reminder.
- NVDA + a voice-confirm flow → the pending proposal and its resolution are announced; focus is
  managed so a screen-reader user can follow the confirm/cancel outcome.
```
