# 47 — Execution Phase EP-6: Action Dispatcher

> **Ships:** v0.6 (`41` §7, with EP-7). **Cloud:** opt-in, consented. **Flag:**
> `dispatcher_enabled` (off ⇒ EP-2's direct reminder-create path — the regression fallback,
> `41` §6, §10). **Depends on:** EP-2 (proposal-as-bubble UI) + EP-5 (the `ConversationEngine`
> and validated `AssistantTurn` actions). **Authority for sequencing:** `41`. **Does NOT depend
> on any later phase.** **Design authority for this phase:** `36`.
>
> **One-line objective:** stand up the central **Action Dispatcher** (`36`) so LLM action
> intents (`reminder_create/update/delete`) flow through **normalise → validate (four gates) →
> confirm → execute**, and **re-route reminder creation through it** — with a hard regression
> gate that the reminder-create outcome is **byte-identical** pre/post the re-route.

---

## Objective

Build the one central place where every proposed action is validated, confirmed if it
consequentially modifies data, and executed (`36` §1). Concretely:

1. **`ActionDispatcher` (main)** — `normalise → validateShape → validateSemantics →
   scanForUnsafeContent → requireCapabilityEnabled → confirm/execute` (`36` §2).
2. **Normalisation / ref-resolution (`36` §3)** — the model proposes references and ISO dates,
   never DB ids; main resolves them against real state and **fails closed** on 0 / >1 matches.
3. **The four validation gates (`09` §5, `31` §5)** — shape → semantics → safety scan →
   confirmation, generalised beyond reminders.
4. **Confirmation Layer (`36` §4)** — the proposal renders as a message-bubble card; **button**
   Confirm/Cancel through the dispatcher (voice confirm is EP-7); timeout = cancel; the
   **pending-proposal invariant** (`36` §4.3) makes confirmation trustworthy.
5. **Execution Layer (`36` §5)** — the only mutator; reuses the existing reminder repository +
   `CreateReminderInput` + business rules + scheduler reconcile.
6. **Re-route reminder create through the dispatcher** and **demote the local regex parser to
   the offline reminder executor** behind it (`30` §9.2, `33` §6); rename `Intent` →
   `ReminderIntent` (`31` §2, `41` §4.2).

`MVP DECISION` (advisor-mandated regression gate, `41` §6) — **The old direct
`ipc.createReminder` path from EP-2 stays live behind `dispatcher_enabled` until the dispatcher
path is verified byte-identical on a real build. Flipping the flag off is the rollback.**

---

## Why this phase exists

After EP-5, the LLM can *converse*, and it already emits validated `AssistantTurn` objects whose
`intent` can be an action — but EP-5 deliberately **drops** those actions and falls back to the
local parser, because there was nowhere safe to send them (`46`, `31` §5). Meanwhile reminders,
memory-save, deletions, and settings changes are all "actions the assistant may propose
mid-conversation" (`31` §1) and they must **all** flow through one choke point, or the safety
invariants (`31` §6) end up scattered across the renderer (`36` §1). EP-6 builds that choke
point. It is sequenced after EP-5 (needs LLM actions) and before EP-7 (voice confirm, edit,
delete workflow) per `41` §6.

`MVP DECISION` — **EP-6 replaces a working path** (EP-2's direct `ipc.createReminder`). That is
exactly why it carries the byte-identical regression gate and the `dispatcher_enabled` fallback
(`41` §6, §10): a re-route of a proven writer must be provably non-regressing before the old path
is retired.

---

## Current code that will be reused

Reused **unchanged** — the dispatcher is a **new front door to the same proven writer** (`36`
§5, §8):

| Reused as-is | Why |
| --- | --- |
| `reminders.create` + `validateBusinessRules` + `CreateReminderInput` (`ipc/index.ts:49,65`) | The Execution Layer calls the *same* writer. There is still exactly one writer per entity (`36` §7). |
| `reminders.update` / `reminders.delete` / `snooze` / `setPaused` (`ipc/index.ts`) | Execution Layer reuses these for `reminder_update`/`delete`; lifecycle `reminders:*` stay direct (`36` §6). |
| `core/parsing/*` (all of it) | Not deleted — **demoted** to the offline reminder executor + validator behind the dispatcher (`33` §6, `31` §7). Its scheduling math, ambiguity policy, and clarification catalog become guardrails on LLM output. |
| `core/scheduling/{rrule,next-occurrence}` | The model's ISO date is re-validated against the same rules a typed reminder passes (`36` §3). |
| The scheduler, `trigger-sink`, notifier, tray (`30` §13) | The reminder *lifecycle* is orthogonal to how a reminder is *created*; `scheduler.reconcile('mutation')` is called post-execute (`36` §5). |
| EP-5's `ConversationEngine`, `AssistantTurnSchema`, `chat:*` IPC | The engine now hands validated actions to the dispatcher instead of dropping them (`31` §5 step 6). |
| EP-2's proposal-as-bubble `ChatMessage.proposal` variant (`31` §4.1) | Finally carries a real, confirmable proposal. |
| The `conversations` table (`31` §4.2) | `reminder_id` now populated when a turn creates a reminder. |

---

## Code that must be refactored

| Refactor | Where | Detail |
| --- | --- | --- |
| **`Intent` → `ReminderIntent`** (`31` §2, `30` §3.1, `41` §4.2) | `core/parsing/types.ts` + all importers (`parse-reminder.ts:8`, `detect-intent.ts`, `extract-title.ts`, `clarification.ts`, `ChatScreen.tsx:6`) | Module-internal rename; the two-value reminder intent stops masquerading as the app's whole intent taxonomy. Pure renaming — no behaviour change. |
| **`parseReminder` demoted from router to executor** (`30` §9.2, `33` §6) | `core/parsing/parse-reminder.ts` unchanged internally; its *caller* changes | It is no longer the top of the pipeline; the dispatcher invokes it (a) offline, or (b) to re-validate LLM-proposed reminder fields before persistence. |
| **`ChatScreen` confirm path re-routed** (`36` §8) | `src/features/chat/*` | `Confirm` on a proposal now calls `action:confirm(turnId)`, not `ipc.createReminder`. Behind `dispatcher_enabled`; off keeps the EP-2 direct call. |
| **Provenance mapping** (`36` §5) | `electron/actions/execute.ts` | `ActionEnvelope.source` (`llm`/`local`/`ui`/`voice`) → the reminder `source` column enum (`ui`/`voice`→`manual`, `llm`→`llm`, `local`→`local`). |

---

## Files expected to change

| File | Change |
| --- | --- |
| `core/conversation/action-schemas.ts` | **New.** Per-intent Zod schemas: `ReminderCreateAction`/`ReminderUpdateAction`/`ReminderDeleteAction` (+ `MemorySave/Query`, `Settings`, `Research` declared for later) (`31` §3). |
| `core/actions/action.ts` | **New.** `Action` union + `ActionEnvelope` (`36` §2). |
| `electron/actions/dispatcher.ts` | **New.** `dispatch(env)` — the entry point + gate pipeline (`36` §2). |
| `electron/actions/normalise.ts` | **New.** Ref-resolution + ISO→epoch + re-validate vs `CreateReminderInput`; fails closed (`36` §3). |
| `electron/actions/confirmation-store.ts` | **New.** The pending-proposal store keyed by `turnId` (single-use, timeout=cancel) (`36` §4.3). |
| `electron/actions/execute.ts` | **New.** The Execution Layer switch; reuses the reminder repo + scheduler reconcile (`36` §5). |
| `electron/actions/settings-carveout.ts` | **New.** Optimistic-apply + Undo for the closed safe-settings subset (`36` §4.2). |
| `electron/conversation/conversation-engine.ts` | Action intents now hand a validated `ActionEnvelope` to the dispatcher (EP-5 drop → EP-6 dispatch) (`31` §5 step 6). |
| `electron/main/ipc/actions.ts` | **New.** `action:confirm` / `action:cancel` handlers on `guard()` (`32` §4, `36` §6). |
| `core/parsing/types.ts` + importers | `Intent` → `ReminderIntent` rename. |
| `src/features/chat/{ChatScreen.tsx,useConversation.ts}` | Confirm → `action:confirm`; render dispatcher proposals + resolved summary; settings "Done ✓ / Undo". |
| `src/lib/ipc.ts` + `electron/preload/index.ts` | Add `action.confirm/cancel` typed wrappers (named fns only). |
| `electron/database/settings-repository.ts` | Read/write the safe-settings subset via `mapSettingChange` (`36` §5). |

---

## New folders

- `core/actions/` — the `Action` union + `ActionEnvelope` (framework-free, behind the `core/`
  ESLint purity wall, `30` §2.1).
- `electron/actions/` — dispatcher, normalise, confirmation-store, execute, settings-carveout
  (main-only; where electron/network live, `33` §5).
- `core/conversation/action-schemas.ts` completes the `core/conversation/` folder started in
  EP-5 (`46`).

---

## New services

- **`ActionDispatcher` (main, `36` §2).** `normalise → validateShape (Gate 1) → validateSemantics
  (Gate 2) → scanForUnsafeContent (Gate 3) → requireCapabilityEnabled`. Then: `isPreConfirm` →
  `proposeAndAwaitConfirmation`; `settings` → `executeOptimistic`; read-only → `execute`.
- **`Normaliser` / ref-resolver (`36` §3).** `reminderRef` → resolved id by title/time match
  (0 → clarify; >1 → disambiguation; never a guess). `scheduledAt` (ISO+offset) → epoch-ms +
  IANA zone, re-validated against `CreateReminderInput` + `validateBusinessRules`.
- **`ConfirmationStore` (main, `36` §4.3).** Stores the *already-validated, normalised* action
  keyed by `turnId`; single-use; cleared on confirm/cancel/timeout (default 90 s = cancel).
- **`ExecutionLayer` (main, `36` §5).** The only mutator; the `switch (a.kind)` over the reminder
  repo + settings repo; post-mutation `broadcast(REMINDERS_CHANGED)` + `scheduler.reconcile`.
- **`SafeSettingsCarveout` (main, `36` §4.2).** Optimistic-apply + inline Undo for the closed
  subset (theme, `tts_enabled`, `reminders_paused`, voice) — never keys/consent/provider.
- **Offline `ReminderExecutor`** — the demoted `parseReminder`, now invoked by the dispatcher
  (`33` §6): the always-present, zero-network reminder producer.

---

## IPC changes

New (all `guard()`-wrapped, `32` §4, `36` §6). Existing `reminders:*` lifecycle channels are
**kept** — the trigger modal and Schedules screen still call them directly (`36` §6, the user's
click *is* the confirmation there):

| Channel | Kind | Payload → Returns | Validation |
| --- | --- | --- | --- |
| `action:confirm` | invoke | `{ turnId }` → `Result<DispatchResult>` | uuid (`36` §4) |
| `action:cancel` | invoke | `{ turnId }` → `void` | uuid |
| `chat:done` (extended) | broadcast | now may carry a display-ready `proposal` (`31` §4.1) | main → renderer |

`MVP DECISION` (`36` §4.3) — **`action:confirm` does NOT accept an action payload.** It executes
the *stored* pending proposal for that `turnId`. The renderer cannot submit a different action at
confirm time than what was shown; unknown/expired `turnId` is rejected. This closes the "renderer
fakes a confirmation to run an unshown action" hole.

---

## Database changes

- **No migration.** All schema already exists (reminders + `conversations`, migrations 001/002).
- **`reminders.source` provenance** now written from `ActionEnvelope.source` (`36` §5): `llm` →
  `'llm'`, `local` → `'local'`, `ui`/`voice` → `'manual'`. History can show "created by Yogi" vs
  "typed" (`09` §5 Gate 4).
- **`conversations.reminder_id`** is now populated when a turn creates a reminder (the existing
  `ON DELETE SET NULL` FK, `31` §4.2) — the slot EP-5 left `NULL`.
- **Byte-identical guarantee:** the row `reminders.create` writes via the dispatcher is identical
  to the EP-2 direct path except for `source` provenance (which the direct path also set) — see
  the Regression Tests.

---

## UI changes

- **Proposal card as a live message-bubble variant (`31` §4.1, `36` §4.1).** For
  `reminder_create/update/delete` the assistant bubble renders a card with the **resolved**
  summary (`resolvedSummary`, e.g. "Call Rahul · tomorrow 9:00 AM · one-time") + **Confirm /
  Cancel**. The user confirms *what will actually happen*, not the model's phrasing (`36` §3).
- **Confirmation weight scales with consequence (`36` §4.2):** delete → full card with the
  resolved target; create/update → full card with absolute+relative time + recurrence;
  `needsClarification` → card with **no Confirm button** (`09` §5 Gate 4).
- **Safe-settings carve-out (`36` §4.2):** "switch to dark mode" applies immediately with an
  inline **"Done ✓ · Undo"** instead of a blocking card.
- **Disambiguation card (`36` §3):** >1 matching reminder → a card listing candidates; 0 → a
  clarification ("I couldn't find a reminder like that — which one?").
- **Timeout affordance:** a pending card auto-cancels after 90 s (fails safe).

---

## Main process changes

- **Engine → dispatcher handoff (`31` §5 step 6).** On an action intent, the
  `ConversationEngine` builds an `ActionEnvelope { action, source: 'llm', turnId }` and calls
  `dispatch()`. The renderer receives a `chat:done` with a display-ready `proposal`, never raw
  JSON (`32` §4).
- **The four gates run in main (`31` §5, `36` §2).** Now including Gates 2/3 for actions (they
  were skipped in EP-5). Availability (`requireCapabilityEnabled`) is decided by the app, not the
  prompt — memory/research are refused here regardless of what the model returns (`31` §2).
- **Offline path also goes through the dispatcher (`33` §6).** When `ai_assist` is off, the local
  parser produces reminder fields → `ActionEnvelope { source: 'local' }` → same dispatcher →
  same confirm → same execute. One path to persistence (`36` §7).
- **`dispatcher_enabled` gate.** Off → the engine/`ChatScreen` fall back to EP-2's direct
  `ipc.createReminder` (`41` §10). The flag is the rollback.

---

## Renderer changes

- **`ChatScreen`/`useConversation`:** render dispatcher `proposal`s in the bubble; Confirm →
  `action.confirm(turnId)`; Cancel → `action.cancel(turnId)`. Settings changes render the inline
  Undo. Behind `dispatcher_enabled`; off keeps the EP-2 direct call.
- **No action validation in the renderer (`11` §8, `36` §1).** It only *renders* the proposal and
  *relays* the Confirm. A compromised renderer cannot execute by faking a confirmation — the
  dispatcher's pending-proposal state must match (`36` §4.3).
- **Voice confirmation is NOT wired here** — this phase is **button confirm only**; the voice
  "yes"/"no" phrase matcher is EP-7 (`36` §4.1, `41` §5).

---

## Provider changes

- **No new provider.** EP-6 consumes EP-5's `OpenAiLlmProvider` unchanged (`33` §4). The change
  is downstream of the provider: the engine now *dispatches* the actions the provider proposes
  rather than dropping them.
- **The local parser becomes the "fourth provider" of reminders (`33` §6)** — not an
  `LlmProvider`, but the always-present, zero-network reminder executor sitting behind the
  dispatcher. This is what guarantees the reminder workflow still works with no key and no
  network.

---

## Security considerations (`36` §7, `31` §6, `41` §8)

- **The LLM never actuates (`41` §8.5).** No path from `AssistantTurn` to `repo.*`. Only the
  Execution Layer writes, only after the Confirmation Layer resolves (`36` §7).
- **The LLM cannot name a reminder it wasn't shown (`31` §6, `36` §3).** It gets a titles-only
  summary and proposes a `reminderRef`; main resolves it and shows the resolved target before any
  delete/update. Fails closed on 0/>1.
- **The pending-proposal invariant (`36` §4.3).** `action:confirm(turnId)` executes the *stored*
  validated action, not a renderer payload — the renderer cannot execute an unshown action. This
  is the reason the confirmation gate is trustworthy even though the renderer is untrusted (`11`
  §2, `41` §8.3).
- **The LLM cannot change a privileged setting (`31` §6).** `SettingsAction` is a closed
  discriminated union of user-safe settings; `ai_key_ciphertext`/consent/provider keys are
  unreachable — even the safe-settings carve-out can't touch them (`36` §4.2).
- **Disabled capabilities refused in main (`31` §2).** `requireCapabilityEnabled` blocks
  memory/research regardless of the model.
- **Timeout = cancel, never auto-confirm (`36` §4.1).** Key never crosses IPC; all calls in main
  (`41` §8.4). No `child_process`/`eval` (`41` §8.7).

---

## Performance considerations

- **Normalisation cost is a small in-memory title/time match** over the active reminder set
  (already materialised for the context summary) — negligible at MVP scale (`30` §6).
- **One extra synchronous SQLite read** (resolve ref) + the existing write; main-thread SQLite is
  fine here and flagged for the EP-11 async-facade watch as history grows (`30` §6).
- **The confirmation hold adds no polling** — the pending proposal is event-driven
  (confirm/cancel) with a single timeout timer per proposal.
- **`scheduler.reconcile('mutation')` stays synchronous and reentrancy-safe** (`30` §13.5) — do
  not make it async.

---

## Risks

- `RISK` — **The re-route silently changes the created row.** *Mitigation:* the byte-identical
  Regression Test (below) compares dispatcher-created vs direct-created rows; `dispatcher_enabled`
  stays off in the shipped default until that test passes on a **real packaged build** (`41` §6).
- `RISK` — **Ref-resolution picks the wrong reminder.** *Mitigation:* fail closed — 0 → clarify,
  >1 → disambiguation card, never a guess (`36` §3). Verified in Edge Cases.
- `RISK` — **`Intent`→`ReminderIntent` rename breaks importers.** *Mitigation:* pure rename,
  typecheck-enforced across `parse-reminder.ts`/`detect-intent.ts`/`extract-title.ts`/
  `clarification.ts`/`ChatScreen.tsx`; no behaviour change.
- `RISK` — **The renderer tries to confirm an expired/forged `turnId`.** *Mitigation:* the
  pending-proposal store rejects unknown/expired ids; single-use (`36` §4.3).
- `RISK` — **Optimistic settings apply then the write fails.** *Mitigation:* Undo reverts the
  optimistic change if the write fails (`36` §5); the carve-out is limited to the trivially
  reversible safe subset.

---

## Rollback strategy

- **Primary: flip `dispatcher_enabled` off (`41` §6, §10).** The engine and `ChatScreen` revert
  to EP-2's direct `ipc.createReminder` after Confirm. **This is the advisor-mandated rollback**
  and is exercised as the safety net until the dispatcher path is verified byte-identical on a
  real build. A regression is a flag flip, not a code revert (`41` §2).
- **Cloud rollback:** `ai_assist_enabled` off → no LLM actions at all; the offline parser still
  routes through the dispatcher (if enabled) or the direct path (if not) — reminders keep working.
- **Full network kill:** all flags off → byte-for-byte the offline build; allowlist empty;
  Wireshark off→zero (`41` §8.2).

---

## Definition of Done

Re-asserts the `41` §8 invariants **plus** phase specifics:

1. **Full reminder loop works offline, no key** — now *through the dispatcher* when
   `dispatcher_enabled`, else through the direct path (`41` §8.1).
2. **Zero outbound packets with cloud off** (Wireshark SEC-10, `41` §8.2).
3. **The confirmation gate holds** — reminders, memory-save, and all deletions require a Confirm;
   only the safe-settings subset is optimistic-apply + Undo (`41` §8.3, `36` §4.2).
4. **The API key never crosses IPC**; all calls in main (`41` §8.4).
5. **The LLM never actuates** — it returns JSON; the dispatcher validates + a human confirms +
   the Execution Layer executes (`41` §8.5, `36` §7).
6. **Notification + history fire unconditionally and first** (`41` §8.6).
7. **No `child_process`/`eval`** (`41` §8.7).
8. **Byte-identical regression gate PASSES** on a real packaged build: a reminder created via the
   dispatcher is identical (minus id/timestamps) to one created via the EP-2 direct path (`41`
   §6). Only then is `dispatcher_enabled` the default.
9. **The pending-proposal invariant holds** — `action:confirm` executes only the stored proposal;
   forged/expired `turnId` rejected (`36` §4.3).
10. Phase checklist green + the `41` §8 regression suite green (`41` §11).

---

## Feature Checklist

**Already completed (prior phases):**
- `ConversationEngine`, `AssistantTurnSchema`, `chat:*` streaming, context window with
  `memories: []` (EP-5, `46`).
- Proposal-as-bubble `ChatMessage.proposal` variant, `useConversation` (EP-2).
- Reminder repo + `CreateReminderInput` + `validateBusinessRules` + scheduler reconcile (MVP).
- `LlmProvider` + factory + key mechanism + live `cloudEnabled` predicate (EP-1).

**New work (EP-6):**
- `core/actions/` + `core/conversation/action-schemas.ts`.
- `electron/actions/` dispatcher, normalise/ref-resolve, confirmation-store, execute,
  settings-carveout.
- `action:confirm`/`action:cancel` IPC + the pending-proposal invariant.
- Re-route reminder create through the dispatcher; demote `parseReminder`; `Intent` →
  `ReminderIntent`.
- Confirmation card (resolved summary), disambiguation card, safe-settings "Done ✓ / Undo".
- `dispatcher_enabled` flag with the EP-2 direct-path fallback.

**Deferred work (later phases):**
- Voice confirm/cancel ("yes"/"no" phrase matcher), reminder edit/delete conversation workflow
  v2 (EP-7, `48`).
- `MemorySave/Query` execution behind the dispatcher (EP-9).
- `Research` execution behind the dispatcher (EP-10).

**Future work:**
- `FUTURE OPTION` — richer disambiguation UX / multi-select confirmations, post-1.0.
- `FUTURE OPTION` — additional action intents behind the same dispatcher seam (the taxonomy is
  extensible without changing the turn contract, `31` §8).

---

## Manual Testing

Cloud on + keyed + consented, `dispatcher_enabled` on, unless noted.

| Step | Action | Expected Result |
| --- | --- | --- |
| 1 | "Remind me tomorrow at 9am to call Rahul" | Proposal card in the bubble with **resolved** summary ("Call Rahul · tomorrow 9:00 AM · one-time") + Confirm/Cancel. **Nothing saved.** |
| 2 | Press Confirm | `action:confirm(turnId)` → executed → reminder in Active Schedules; `source='llm'`; card → "confirmed/executed". |
| 3 | "Remind me at 8 to take medicine" (ambiguous meridiem) | `needsClarification` card with **no Confirm button** until resolved. |
| 4 | "Delete tomorrow's reminder" (one match) | Delete card showing the **resolved** target; Confirm required. |
| 5 | Confirm the delete | Reminder deleted; Active Schedules updates; history reflects it. |
| 6 | "Delete my reminder" with two candidates | **Disambiguation** card listing candidates; no delete until one is chosen + confirmed. |
| 7 | "Switch to dark mode" | Theme flips immediately with inline **"Done ✓ · Undo"** — no blocking card. |
| 8 | Press Undo | Theme reverts. |
| 9 | Let a proposal sit 90 s | Auto-cancels (fails safe); no write. |
| 10 | Turn `dispatcher_enabled` off; create a reminder | Uses EP-2's direct path; outcome identical; Active Schedules unchanged in shape. |
| 11 | Cloud off entirely | Offline parser routes through the dispatcher (if enabled) → same confirm → same create. |
| 12 | Wireshark 30 min, cloud off | Zero outbound packets. |

---

## Edge Cases

- **`reminderRef` matches 0 reminders** → clarification, never a guess (`36` §3).
- **`reminderRef` matches >1** → disambiguation card (`36` §3).
- **Model proposes a past `scheduledAt`** → Gate 2 (`validateBusinessRules`, `date_in_past`)
  rejects → the card cannot confirm; Yogi asks for a future time.
- **Model proposes >2 years out** → `date_too_far` rejection.
- **Model proposes an unsupported RRULE** → semantics gate rejects; offered daily/weekly (reusing
  the parser's catalog, `33` §6).
- **`settings` action outside the safe subset** (e.g. tries `ai_key_ciphertext`) → not in the
  discriminated union → rejected at Gate 1 (`31` §3, `36` §4.2).
- **`memory_*` / `research` action** → `requireCapabilityEnabled` refuses in main ("I can't do
  that yet") regardless of the model (`31` §2) — those light up in EP-9/EP-10.
- **`action:confirm` with an unknown/expired `turnId`** → rejected (`36` §4.3).
- **`needsClarification: true` with an action** → card with no Confirm button (`09` §5 Gate 4).
- **Two proposals pending, confirm the older** → each `turnId` is independent, single-use.

---

## Failure Cases

| Failure | Behaviour |
| --- | --- |
| Execution DB write fails | Sanitised assistant message + logged detail (`16` §5); never throws across IPC; proposal not left half-applied (`36` §5). |
| Settings optimistic write fails | Undo reverts the optimistic change (`36` §5). |
| LLM returns action for offline/failed cloud | Degrade to the local parser → same dispatcher path (reminder-shaped) or a "couldn't reach the assistant" notice (chat) (`32` §5). |
| Ref resolves but the row is deleted before confirm | Confirm re-checks; `not_found` → friendly "that reminder no longer exists" (reuses `ipc/index.ts:98`). |
| Timeout during confirm hold | Cancel; no write (`36` §4.1). |
| Forged confirm from a compromised renderer | Rejected — no matching stored proposal (`36` §4.3). |

---

## Recovery Tests

1. Confirm a create, kill the app mid-write → on restart the reminder is either fully present or
   fully absent (transactional repo); no half-row.
2. Optimistic theme change, force the settings write to fail → Undo restores the prior theme; no
   drift.
3. Delete-confirm a reminder that another action deleted a moment earlier → `not_found`, graceful
   message, no crash.
4. `dispatcher_enabled` off mid-session → next reminder uses the direct path without restart; flip
   back on → dispatcher path resumes (live re-bind).
5. Expire a proposal (90 s), then click its stale Confirm → rejected; the card shows "expired".

---

## Regression Tests (`41` §6, §8, §11)

1. **Byte-identical reminder create (the mandated gate).** Create the *same* reminder (a) via the
   dispatcher and (b) via the EP-2 direct path; diff the persisted rows. **They must be identical
   except id + created/updated timestamps** (`source` set the same on both). Must pass on a **real
   packaged build** before `dispatcher_enabled` ships on (`41` §6).
2. **Full offline reminder loop with cloud off** — create/confirm/schedule/notify+speak, through
   the dispatcher (`41` §8.1).
3. **Wireshark off→zero** — cloud off, 30 min, zero packets; on → `api.openai.com` only (`41`
   §8.2).
4. **Confirmation gate holds** — no reminder/memory/delete persists without a Confirm; only the
   safe-settings subset is optimistic-apply + Undo (`41` §8.3, `36` §4.2).
5. **Pending-proposal invariant** — `action:confirm` executes only the stored proposal; a payload
   sent with confirm is ignored; forged/expired `turnId` rejected (`36` §4.3).
6. **The LLM cannot name an unshown row** — context is titles-only; a `reminderRef` for a
   non-existent reminder fails closed (`31` §6).
7. **`Intent`→`ReminderIntent` rename is behaviour-neutral** — the 56 parser fixtures still pass
   (`30` §10).
8. **`settings:get` leaks nothing** — `hasApiKey` boolean only.

---

## Performance Tests

1. **Ref-resolution latency** — title/time match over the active set is sub-millisecond at MVP
   scale; no perceptible confirm delay.
2. **No polling from the confirmation hold** — one timer per pending proposal; CPU idle while
   waiting.
3. **Scheduler tick unaffected** — the 30 s reconcile and tray refresh stay smooth across
   confirm/execute (`30` §6).
4. **One extra SQLite read per action** — measured against the existing write; negligible.

---

## Expected App Behaviour (EP-5 → EP-6)

```text
BEFORE (v0.5, EP-5): action intents DROPPED, reminders on the EP-2 direct path
  user text ─▶ ConversationEngine ─▶ AssistantTurn
                 ├─ reply-only ─▶ reply
                 └─ ACTION intent ─▶ DROP ─▶ local parseReminder ─▶ ResultCard
                                              ─▶ ipc.createReminder (direct)

AFTER (v0.6, EP-6, dispatcher_enabled):
  user text ─▶ ConversationEngine ─▶ AssistantTurn
                 ├─ reply-only ─▶ reply
                 └─ ACTION intent ─▶ ActionEnvelope{source:'llm', turnId}
                       ▼
                 ACTION DISPATCHER (main)
                   normalise (resolve ref, ISO→epoch, re-validate CreateReminderInput)
                   → Gate1 shape → Gate2 semantics → Gate3 safety → capability
                       ├─ pre-confirm (reminder_*/memory_save) ─▶ proposal card
                       │        └─ action:confirm(turnId) ─▶ EXECUTE (same repo + reconcile)
                       ├─ settings ─▶ optimistic apply + "Done ✓ / Undo"
                       └─ read-only (memory_query/research) ─▶ execute ─▶ follow-up reply

  offline (no cloud): local parseReminder ─▶ ActionEnvelope{source:'local'} ─▶ SAME dispatcher
  (dispatcher_enabled OFF): revert to EP-2's direct ipc.createReminder  ← rollback
```

---

## Conversation Testing

Cloud on + keyed + consented, `dispatcher_enabled` on. Confirmation this phase is the card's
**Confirm button** (voice/text "yes" phrase matching is EP-7, `36` §4.1).

- **User:** "Hello"
  **Expected:** Streamed greeting; `intent: chat`; no action, no card. (Unchanged from EP-5.)
- **User:** "Who are you?"
  **Expected:** Streamed intro; no action. `intent: question`/`chat`.
- **User:** "Explain Docker"
  **Expected:** Streamed explanation from the model's knowledge. **No reminder, no card.**
  `intent: question`.
- **User:** "Tell me a joke"
  **Expected:** Streamed joke; conversation continues; no action. `intent: chat`.
- **User:** "Remind me tomorrow to call Rahul"
  **Expected:** `intent: reminder_create` → dispatcher normalises + gates → **proposal card**
  with resolved summary ("Call Rahul · tomorrow · one-time") + Confirm/Cancel. **NOT created.**
- **User:** press **Confirm** (the scripted "Yes")
  **Expected:** `action:confirm(turnId)` → the *stored* validated action executes → reminder
  created (`source='llm'`), appears in **Active Schedules**; card → "confirmed". *(Typed/voice
  "yes" phrase matching arrives in EP-7; here confirmation is the button.)*
- **User:** "Delete tomorrow's reminder"
  **Expected:** `intent: reminder_delete` → ref resolved to the real reminder → **confirmation
  required** (delete card showing the resolved target) → on Confirm, **deleted** from Active
  Schedules. (0 matches → clarify; >1 → disambiguation.)

---

## Voice Testing

Voice **capture** (STT) is unchanged (EP-3 owns cloud STT; sherpa offline). Voice
**confirmation** ("yes"/"no") is **EP-7**, not this phase.

1. Dictate "Remind me tomorrow to call Rahul" → transcript → dispatcher → **proposal card**;
   confirm with the **button** (voice "yes" not yet wired).
2. Dictate "Delete tomorrow's reminder" → transcript → dispatcher resolves the ref → delete card;
   confirm with the button.
3. Saying "yes" out loud while a card is pending does **nothing** in EP-6 — the local phrase
   matcher (`yes/yeah/yep/confirm/do it` vs `no/nope/cancel/stop`), matched in main and never
   sent to the LLM, lands in EP-7 (`36` §4.1).
4. A cloud failure during capture never blocks the composer; the dispatcher proposal (if any) is
   confirmed by button.
5. Confirm the pending-proposal invariant holds for any future voice path: voice "yes" will
   execute only the *stored* proposal for the pending `turnId`, never a renderer-supplied action
   (`36` §4.3).
```
