# 36 — Action Dispatcher, Confirmation & Execution Layers

> **v2 addition:** the reminder popup ([55](55-reminder-popup-workflow.md) §5, P2) drives
> `reminder_complete`/`reminder_update`(snooze)/`reminder_delete` by natural language ("I already
> called him" / "snooze 30 min" / "cancel this"). It flows through THIS dispatcher (delete confirms
> via EP-7's matcher); reference resolution is trivial there — the popup is already about one
> specific reminder, so there is no `reminderRef` ambiguity.
>
> **Goal:** one central place where every action — from any source (LLM, local parser, a UI
> button, a voice confirmation) — is validated, confirmed if it consequentially modifies data
> (with the one reversible safe-settings carve-out, §4.2), and executed.
> **No component talks to a repository or a provider directly to perform a user action; they
> all go through the dispatcher.** This is the structural home of the product's identity: the
> confirmation gate (`24`: *"the confirmation gate is the product's identity"*).
>
> Depends on the canonical intent taxonomy and action schemas in `31` §2–§3.

---

## 1. Why a central dispatcher

Today there is no dispatcher: `ChatScreen` calls `ipc.createReminder` directly after Confirm;
the trigger modal calls `ipc.complete/dismiss/snooze` directly. That is fine for one intent
and one screen. With a conversation engine emitting `reminder_*`, `memory_*`, `settings`, and
`research` actions, a single choke point is what keeps the safety invariants (`31` §6)
enforceable in *one* place instead of scattered across the renderer.

```text
Source of an action ─────────────────────────────────────────────┐
  • Conversation Engine (LLM AssistantTurn.action)                │
  • Local parser (ParseResult.ok reminder)                        ▼
  • UI affordance (edit form, delete button, trigger modal)   ┌───────────────────────┐
  • Voice confirmation ("yes")                                │  ACTION DISPATCHER     │  (main)
                                                              │  1. normalise → Action │
                                                              │  2. validate (gates)   │
                                                              │  3. authorize (avail.) │
                                                              └──────────┬────────────┘
                                          data-modifying?                │
                              ┌───────────── yes ──────────────┐   no (read-only)
                              ▼                                 │        │
                      CONFIRMATION LAYER                        │        ▼
              (render proposal; await Confirm via              │   EXECUTION LAYER
               button OR voice OR timeout)                      │   (repo / provider call)
                              │ confirmed                       │        │
                              └─────────────►  EXECUTION LAYER ◄┘        ▼
                                                     │             follow-up reply
                                                     ▼
                                        SQLite · providers · settings
                                                     │
                                        broadcast reminders:changed etc.
```

`MVP DECISION` — The dispatcher lives in **main**. The renderer only *renders* a proposal and
*relays* a Confirm. A compromised renderer cannot execute an action by faking a confirmation,
because execution requires the dispatcher's own pending-proposal state to match (`§4.3`).

---

## 2. The `Action` type and the dispatch entry point

```ts
// core/actions/action.ts
export type Action =
  | ReminderCreateAction | ReminderUpdateAction | ReminderDeleteAction   // 31 §3
  | MemorySaveAction | MemoryQueryAction
  | SettingsAction | ResearchAction;

export interface ActionEnvelope {
  action: Action;
  source: 'llm' | 'local' | 'ui' | 'voice';   // provenance → recorded on the reminder/history
  turnId?: string;                             // ties an LLM proposal to its conversation turn
}
```

```ts
// electron/actions/dispatcher.ts  (main)
async function dispatch(env: ActionEnvelope): Promise<DispatchResult> {
  const a = normalise(env.action);                 // e.g. ISO+zone → epoch-ms; resolve refs
  validateShape(a);                                // per-intent Zod (09 Gate 1)
  validateSemantics(a);                            // future date, supported RRULE… (09 Gate 2)
  scanForUnsafeContent(a);                         // safety scan on strings (09 Gate 3)
  requireCapabilityEnabled(a.kind);                // availability decided by the app (31 §2)

  if (isPreConfirm(a.kind))   return proposeAndAwaitConfirmation(env, a);  // §4 — hold, then execute
  if (a.kind === 'settings')  return executeOptimistic(env, a);           // §4.2 — apply now + Undo
  return execute(env, a);                                                  // §5 — read-only
}
```

`isPreConfirm` = `reminder_create | reminder_update | reminder_delete | memory_save` — these
**hold** until a human/voice Confirm. `settings` is data-modifying but takes the bounded
optimistic-apply carve-out (below). Read-only = `memory_query | research`.

`MVP DECISION` — A `settings` change (e.g. "switch to dark mode") is the **one carve-out** from
"hold until Confirm": it applies immediately with an inline **"Done ✓ / Undo"** rather than a
blocking card, because it is trivially reversible, immediately visible, and limited to the
closed safe subset (`31` §3 — never keys/consent/provider). The visible change + instant Undo
*is* the confirmation for a reversible preference (`30` §13.1). Everything else
(reminders, memory-save, all deletions) holds until an explicit Confirm. Confirmation weight
scales with consequence (`§4.2`).

---

## 3. Normalisation — resolving what the model was never given

The LLM proposes references, not database ids (`31` §3, §6). Normalisation resolves them in
main against real state and **fails closed**:

- `reminderRef` ("the dentist reminder", "my 9am one") → resolved against the user's active
  reminders by title/time match. **0 matches** → the dispatcher returns a clarification
  ("I couldn't find a reminder like that — which one?"). **>1 match** → a disambiguation
  proposal listing the candidates. Never a guess.
- `scheduledAt` (ISO+offset) → epoch-ms + IANA zone, then re-validated against
  `CreateReminderInput` (`15`) and the business rules — the model's date is treated as
  hostile input until it passes the same gate a typed reminder passes.
- The resolved, human-readable target is what the confirmation card shows
  (`resolvedSummary`, `31` §4.1) — the user confirms *what will actually happen*, not the
  model's raw phrasing.

---

## 4. The Confirmation Layer

### 4.1 Confirmation methods (brief requirement)

| Method | How | Notes |
| --- | --- | --- |
| **Button** | Confirm / Cancel in the proposal card (a message-bubble variant, `31` §4.1) | The always-available default |
| **Voice** | user says "yes"/"confirm"/"do it" or "no"/"cancel" while a proposal is pending | Only accepted while a proposal is pending; matched against a small closed phrase set, never sent to the LLM to interpret |
| **Timeout** | a pending proposal auto-cancels after N seconds (default 90) | Fails **safe** — a timeout is a *cancel*, never an auto-confirm |
| **Clarification** | if `needsClarification`, the card has **no Confirm button** (`09` §5 Gate 4) | The model cannot escape a clarification by claiming confidence |

`MVP DECISION` — **Voice confirmation is matched locally**, in main, against a fixed phrase
list (`yes/yeah/yep/confirm/do it/go ahead` vs `no/nope/cancel/stop/don't`). The transcript
is **not** round-tripped to the LLM to decide "did they mean yes?" — that would let a
prompt-injected model turn an ambiguous "no thanks" into a confirmation. Anything not clearly
affirmative or negative is treated as neither, and the card stays pending.

### 4.2 Confirmation weight scales with consequence

| Action | Confirmation |
| --- | --- |
| `reminder_delete` | Full card, explicit Confirm; shows the resolved reminder |
| `reminder_create` / `reminder_update` | Full card, Confirm; shows resolved absolute+relative time, recurrence |
| `memory_save` | Card: "Would you like me to remember: *<fact>*?" Confirm; marks `is_sensitive` if health/family (`10`) |
| `settings` | **Carve-out (not pre-confirm):** inline "Done ✓ · Undo" — applied optimistically because it is trivially reversible and limited to the safe subset (`31` §3, `30` §13.1) |
| `memory_query` / `research` | None — read-only; execute and reply |

### 4.3 The pending-proposal invariant (security)

`MVP DECISION` — When the dispatcher proposes a data-modifying action it stores a
**pending proposal** keyed by `turnId` in main, containing the *already-validated, normalised*
action. `action:confirm(turnId)` executes **that stored action** — it does **not** accept an
action payload from the renderer. So:

- The renderer cannot submit a *different* action at confirm time than what was shown.
- A confirm for an unknown/expired `turnId` is rejected.
- The pending proposal is single-use and cleared on confirm/cancel/timeout.

This closes the "renderer fakes a confirmation to run an unshown action" hole and is the
reason the confirmation gate is trustworthy even though the renderer is untrusted (`11` §2).

---

## 5. The Execution Layer

The only place that mutates data or calls a provider for an action:

```ts
// electron/actions/execute.ts (main)
switch (a.kind) {
  case 'reminder_create': return reminderRepo.create(toCreateInput(a, source));  // reuses 15
  case 'reminder_update': return reminderRepo.update(a.id, a.patch);
  case 'reminder_delete': return reminderRepo.delete(a.id);
  case 'memory_save':     return memoryRepo.create({ ...a, source: 'user_confirmed' }); // v0.3
  case 'memory_query':    return memoryRepo.findBySubject(a.subject);                   // v0.3
  case 'settings':        return settingsRepo.set(mapSettingChange(a.change));
  case 'research':        return researchProvider.answer(a.query);                      // v0.5
}
// then, for anything that changed reminders:
broadcast(CH.REMINDERS_CHANGED); scheduler.reconcile('mutation');
```

- **Reminder execution reuses the existing repository + `CreateReminderInput` + business
  rules + scheduler reconcile** unchanged (`30` §13.4, §13.5). The dispatcher is a new front
  door to the *same* proven writer — there is still exactly one writer per entity.
- **Provenance:** the envelope `source` (`'llm' | 'local' | 'ui' | 'voice'`) is mapped to the
  reminder's `source` column enum (`15`: `'local' | 'llm' | 'manual'`; `ui`/`voice` → `'manual'`,
  `llm` → `'llm'`, `local` → `'local'`) and stored, so History can show "created by Yogi" vs
  "typed" (`09` §5 Gate 4).
- **Result:** execution returns a `DispatchResult` the engine turns into a follow-up
  assistant message ("Done — I'll remind you tomorrow at 9." / "You have 3 reminders about
  the dentist.").
- **Failure:** an execution error (DB write fail, provider error) becomes a sanitised
  assistant message + a logged detail (`16` §5); it never throws across IPC, never leaves the
  proposal half-applied (settings `Undo` reverts an optimistic change if the write fails).

---

## 6. IPC and wiring

New/changed channels (all `guard()`-wrapped, `16` §5):

| Channel | Purpose |
| --- | --- |
| `chat:send` → `chat:delta`/`chat:done` | drive the engine; a `chat:done` may carry a `proposal` (`32` §4) |
| `action:confirm` `{ turnId }` | confirm the stored pending proposal (§4.3) |
| `action:cancel` `{ turnId }` | cancel it |
| existing `reminders:*` (complete/dismiss/snooze/pause/delete/update) | **kept** — the trigger modal and Schedules screen still use them directly for *lifecycle* actions that are not conversational proposals |

`MVP DECISION` — The dispatcher governs **conversational/proposed** actions. Direct lifecycle
actions from an explicit UI control (pressing Snooze on a fired reminder, deleting from the
Schedules list) remain direct `reminders:*` calls — the user's click *is* the confirmation
there. The rule is: *an action proposed by software (LLM or parser) needs the dispatcher's
confirmation gate; an action the user performs directly by pressing its own dedicated control
is already confirmed by the press.*

---

## 7. Safety invariants (checklist for review)

| Invariant | Enforced by |
| --- | --- |
| Exactly one path to persistence per entity | Execution Layer is the only mutator; repos have one writer |
| No action executes without validation | `dispatch()` runs all gates before confirm/execute |
| No consequential/irreversible action executes without a human/voice confirm | `proposeAndAwaitConfirmation` + the pending-proposal invariant (§4.3) for reminders/memory-save/deletions; the safe-settings subset is the one carve-out — optimistic-apply + instant Undo (§4.2, `30` §13.1) |
| The renderer cannot execute an unshown action | Confirm executes the *stored* validated proposal, not a renderer payload |
| Disabled capabilities cannot run | `requireCapabilityEnabled` checked in main regardless of the model |
| Voice "yes" can't be spoofed by the model | Confirmation phrases matched locally, never interpreted by the LLM |
| Timeout can't auto-confirm | Timeout = cancel, always |
| Deletes/updates target only real, resolved rows | Normalisation resolves refs and fails closed on 0/>1 matches |

---

## 8. What changes vs today

- **New:** `core/actions/` (types) + `electron/actions/` (dispatcher, confirmation store,
  execution), the `action:confirm/cancel` IPC, the voice-confirmation matcher, the proposal-
  as-message-variant UI.
- **Reused unchanged:** every reminder repository method, `CreateReminderInput` + business
  rules, the scheduler reconcile, the trigger modal's direct lifecycle calls, the confirmation
  *concept* (now generalised beyond reminders).
- **Retired:** `ChatScreen`'s direct `ipc.createReminder` after Confirm — that call now goes
  `Confirm → action:confirm → dispatcher → execute`.
