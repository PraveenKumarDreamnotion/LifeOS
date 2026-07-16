# 43 — Execution Phase EP-2: Conversation Shell

> **EP-2 · ships in v0.3 · offline · the conversation SHELL only.** This phase rewrites
> `ChatScreen` from a single-shot parse→card into a **scrolling message list** (user /
> assistant bubbles) driven by a `useConversation` hook and `chat:*` IPC, but it **wraps the
> EXISTING reminder flow** — local parser → confirmation card rendered as a message-bubble
> variant → the EXISTING `ipc.createReminder`. **NO dispatcher (that is EP-6), NO LLM (that
> is EP-5).** Non-reminder input shows the honest placeholder. Reminders must work **exactly**
> as today. Honest demo (`41` §9): *"the reminder app now shows a conversation,"* **not**
> "chat with Yogi." Authority for build order is `41`; the conversation data model is `31`.

---

## Objective

Give the app the message model it lacks (`30` §3.1) without adding any intelligence. Replace
the `result: ParseResult | null` slot in `ChatScreen` (`ChatScreen.tsx:17`) with a
`ChatMessage[]` conversation, a `useConversation()` hook, and a thin main-process `chat:send`
handler that — for this phase — simply calls the **existing** `parseReminder` and returns a
turn whose reply/proposal renders as a bubble. The confirmation card becomes a message
variant. Reminders execute through the **existing** `ipc.createReminder` path, unchanged.
Everything non-reminder returns the fixed placeholder. Adopt the existing `conversations`
table (no migration). End state: same reminder behaviour, now shown as a scrolling
conversation; still zero network; gated behind `conversation_ui_enabled`.

## Why this phase exists

`30` §3.1 is blunt: **there is no conversation model anywhere.** `ChatScreen` holds exactly
one `ParseResult`; a new parse overwrites the last; clarification is faked by re-parsing a
reconstructed string (`ChatScreen.tsx:40` `ask(\`${lastAsked} at ${label}\`)`). There are no
roles, no bubbles, no scrollback. The v2 product is conversation-first, and every later phase
(EP-5 LLM chat, EP-6 dispatcher, EP-7 voice-confirm) needs a message list to render into. `41`
sequences the **shell before the intelligence** deliberately (`41` §1): shipping the scrolling
conversation now, wrapping the working reminder flow, lets EP-5 later drop a real LLM into an
existing surface rather than building UI and model at once. `31` §4.1 specifies the exact
`ChatMessage` shape and the `useConversation` hook this phase builds; `31` §7 lists what stays
reused (the confirmation gate, `CreateReminderInput`, scheduling math). EP-2 is the smallest
honest step: the UI becomes conversational; the brain does not (yet).

## Current code that will be reused

- **The entire reminder pipeline, unchanged** — `parseReminder` (`core/parsing/*`), the
  `ParseResult` discriminated union, `CreateReminderInput` + business rules, `ipc.createReminder`
  (`src/lib/ipc.ts:45`), the scheduler, notifier, tray, trigger fan-out. EP-2 wraps, never
  rewrites (`31` §7). Reminders fire, notify, and speak exactly as in v0.2.
- **The confirmation gate** — the parse card's Confirm/Cancel logic (`ChatScreen.tsx:47-67`,
  `116-220`) is **relocated** into a bubble variant, not reimplemented; the gate semantics are
  identical (`30` §13.1).
- **`useSpeech` + `MicButton`** (`src/hooks/useSpeech.ts`, `MicButton.tsx`) — dictation feeds
  the composer exactly as today; the message list just gives its output a place to land.
- **`core/time/format.ts`** (`formatAbsolute`/`formatRelative`/`rruleToHuman`) — used to render
  the reminder proposal summary inside the bubble.
- **The `conversations` table** (migration 002, `settings-repository`-adjacent DB) — adopted
  as-is (`31` §4.2); columns already present.
- **The provider seam + factory from EP-1** — EP-2 does **not** call the LLM, but the
  `chat:send` handler is written against the seam shape so EP-5 slots in without re-plumbing.

## Code that must be refactored

| Refactor | Location | Ref |
| --- | --- | --- |
| `ChatScreen` single-shot → scrolling message list | `src/features/chat/ChatScreen.tsx` (rewrite) | `30` §3.1, `41` §4.2 |
| Extract the parse card into a bubble variant `<ProposalBubble>` | new `src/features/chat/MessageBubble.tsx` | `31` §4.1 |
| Introduce `useConversation()` owning `ChatMessage[]` | new `src/features/chat/useConversation.ts` | `31` §4.1 |
| Split `App.tsx` router seam (start only) | `src/app/App.tsx` | `41` §4.2 (EP-2 start, EP-8/EP-11 finish) |
| Add a thin `ChatTurnService` in main wrapping `parseReminder` | new `electron/main/chat/chat-turn-service.ts` | `31` §5 (shell subset) |

**Explicitly NOT built in EP-2** (deferred so an agent doesn't over-build): the full
`ConversationEngine` control flow (`31` §5), `AssistantTurnSchema`/`action-schemas.ts` (`31`
§3), the Action Dispatcher (`36`/EP-6), any `LlmProvider` call (EP-5), streaming deltas
(`chat:delta` exists as a channel but carries only the local parser's synchronous result in
EP-2). `parseReminder` is **not** yet demoted to a dispatcher executor — that is EP-6.

## Files expected to change

**New**
- `src/features/chat/useConversation.ts` — the hook owning `ChatMessage[]`, append/update,
  submit, and proposal lifecycle (`31` §4.1).
- `src/features/chat/conversation-types.ts` — the `ChatMessage` interface (`31` §4.1) for the
  renderer.
- `src/features/chat/MessageList.tsx` — the scrolling list (auto-scroll to newest, `aria-live`).
- `src/features/chat/MessageBubble.tsx` — user bubble, assistant text bubble, and the
  `ProposalBubble` variant that hosts the reminder confirmation card + Confirm/Cancel.
- `electron/main/chat/chat-turn-service.ts` — `handleTurn(text)` → runs `parseReminder`,
  returns a shell turn (reply + optional reminder proposal), persists to `conversations`.
- Tests: `tests/electron/chat/chat-turn-service.test.ts`, `tests/renderer/useConversation.test.tsx`
  (needs the jsdom vitest project, `30` §10 / `41` — added here).

**Modified**
- `src/features/chat/ChatScreen.tsx` — rewritten around `useConversation` + `MessageList` +
  composer; the old `ResultCard`/`result` slot is removed (logic moved to `ProposalBubble`).
- `core/types/channels.ts` — add `CHAT_SEND`, `CHAT_DELTA`, `CHAT_DONE`.
- `electron/preload/index.ts` — add `chat.send` / `chat.onDelta` / `chat.onDone`.
- `src/lib/ipc.ts` — add `chat` wrappers.
- `electron/main/ipc/index.ts` + `guard.ts` — register `chat:send` (guarded, Zod `.strict()`).
- `electron/main/index.ts` — instantiate `ChatTurnService(parse, reminders, conversations,
  settings)`; wire the `conversation_ui_enabled` flag.
- `electron/database/` — a small read/write repository for `conversations` (adopting the
  existing table; **no migration**).
- `src/app/App.tsx` — behind `conversation_ui_enabled`, render the new `ChatScreen`; off →
  render the old single-shot screen (kept for one release as the rollback path, `41` §10).

## New folders

- `src/features/chat/` already exists — new files land in it (no new renderer folder).
- `electron/main/chat/` — the main-side `ChatTurnService` (thin; the full engine folder
  `core/conversation/` is created in **EP-5**, not here).

## New services

- **`ChatTurnService`** (`electron/main/chat/chat-turn-service.ts`) — the EP-2 stand-in for the
  future `ConversationEngine`. `handleTurn(text): ShellTurn` runs the existing `parseReminder`:
  - reminder parse `ok` → returns `{ reply: 'Here's what I understood', proposal: <ParseResult> }`
    (the proposal renders as the confirmation bubble; the app still requires a Confirm click).
  - clarification → `{ reply: <question>, proposal: <clarification card>, needsClarification:true }`
    (no Confirm — gate holds).
  - refusal / non-reminder → `{ reply: PLACEHOLDER }` where PLACEHOLDER is the exact honest
    string **"Connect OpenAI in Settings to chat and answer questions."** (`41` §9).
  It persists one row per completed turn to `conversations` (`user_text`, `assistant_response`,
  `intent`, `reminder_id` on create). **No LLM, no network, fully synchronous.**
- **`ConversationRepository`** — minimal insert/read over the existing `conversations` table.

## IPC changes

**Added:**
- `chat:send` (invoke, renderer→main) — `{ text: string }`, Zod `.strict()`, guarded. Returns
  the completed `ShellTurn` (synchronous local parse; no streaming needed in EP-2). Confirm is a
  **separate** existing call: the `ProposalBubble`'s Confirm still invokes the existing
  `reminders:create` (`ipc.createReminder`), **not** a new `action:confirm` (that is EP-6).
- `chat:delta` (broadcast, main→renderer) — declared now for forward-compat (`32` §5 / `31`
  §5), but in EP-2 it is unused or carries the single final reply in one shot; EP-5 lights up
  real token streaming.
- `chat:done` (broadcast) — signals turn completion; in EP-2 fires immediately after the
  synchronous parse.

**Unchanged:** `reminders:create` is still the persistence path for a confirmed reminder — EP-2
does **not** re-route it through a dispatcher (that regression-gated swap is EP-6, `41` §6).

## Database changes

`MVP DECISION` — **Adopt the existing `conversations` table; NO migration.** Migration 002
already ships `conversations(id, user_text, assistant_response, intent, reminder_id, created_at)`
as dead schema (`30` §3.2, `31` §4.2). EP-2 gives it its first reader/writer via
`ConversationRepository`. One row per completed turn; the `reminder_id` FK (`ON DELETE SET
NULL`) links a turn that created a reminder. **Not stored:** raw parser internals, no secrets —
just the human-readable turn (`31` §4.2). Retention piggybacks on the existing history sweep
policy (default keep 365 days). Migration `003` stays reserved for memory FTS5 (`31` §4.2 note).

## UI changes

- **Chat screen becomes a scrolling conversation.** User input renders as a right-aligned user
  bubble; Yogi's response as a left-aligned assistant bubble. A reminder parse renders the
  confirmation card **inside** an assistant bubble (`ProposalBubble`) with Confirm/Cancel — the
  card is now a message variant (`31` §4.1), not a floating section.
- **Auto-scroll** to the newest message; the live-transcript strip (`ChatScreen.tsx:72`) moves
  above the composer and still shows sherpa partials.
- **Non-reminder input** shows the placeholder assistant bubble: *"Connect OpenAI in Settings
  to chat and answer questions."* — the honest EP-2 framing (`41` §9). No fake chat.
- **Confirmed / cancelled proposals settle in place** — the bubble shows a resolved summary
  ("✓ Saved — Call the dentist · tomorrow 9:00 AM") rather than clearing, so scrollback is a
  real transcript.
- Schedules / History / Settings / onboarding **unchanged**. The "🔒 Local · Offline" chip
  stays (copy audit is EP-8).

## Main process changes

- Instantiate `ChatTurnService` with the existing `parseReminder`, `ReminderRepository`,
  `ConversationRepository`, and `SettingsRepository`.
- Register `chat:send` through `guard()` + Zod.
- Persist each turn to `conversations`.
- **No scheduler/notifier/tray change.** A reminder created via the conversation flow reaches
  the scheduler through the **unchanged** `reminders:create` handler → same `onChanged`
  broadcast + reconcile + tray refresh (`index.ts:151-174`). The reminder *lifecycle* is
  untouched (`31` §7).
- The `conversation_ui_enabled` flag (read from settings) selects new vs old ChatScreen at the
  renderer; main serves `chat:send` regardless (harmless if unused).

## Renderer changes

- `useConversation()` owns `ChatMessage[]`, exposes `send(text)`, `confirm(proposal)`,
  `cancel(id)`. `send` appends a user message, calls `ipc.chat.send`, appends the assistant
  bubble from the returned `ShellTurn`.
- `confirm` calls the **existing** `ipc.createReminder` with the parsed reminder fields (same
  payload as `ChatScreen.tsx:50-58`), then updates the proposal bubble status to `executed` with
  the saved summary. **This is the EP-2 direct path that EP-6's dispatcher will later replace
  behind `dispatcher_enabled`** (`41` §6/§10) — kept deliberately simple here.
- Clarification answers no longer reconstruct a string blindly; they append a new user turn and
  re-`send` (the same parser handles it), but now the prior turns stay visible as history.
- `App.tsx`: branch on `conversation_ui_enabled` — on (default at v0.3) → new ChatScreen; off →
  the retained single-shot screen.

## Provider changes

**None.** EP-2 consumes EP-1's provider seams but adds **no** new provider and makes **no**
cloud call. STT is still `SherpaSpeechProvider`; TTS still `WebSpeechTtsProvider`; the
`LlmProvider` seam exists but is not invoked — `ChatTurnService` uses the local `parseReminder`
only. This is what keeps EP-2 fully offline (`31` §5 fallback: with no LLM, a reminder-shaped
utterance uses the local parser; a non-reminder shows the placeholder).

## Security considerations

- **Invariant §8.2 — zero network.** EP-2 makes no outbound call at all; `chat:send` runs the
  local parser synchronously in main. Wireshark stays clean start-to-finish.
- **Invariant §8.5 — the LLM never actuates** is preserved *structurally by absence*: there is
  no LLM path in EP-2, so there is no way for model output to reach a repo. When EP-5 adds the
  LLM, it inherits a UI that already routes every persistence through the Confirm button.
- **Invariant §8.3 — the confirmation gate.** The card moving into a bubble does **not** relax
  the gate: a reminder still persists only on an explicit Confirm click; `needsClarification`
  renders a bubble with no Confirm; refusal/placeholder bubbles have no action.
- `chat:send` is guarded + Zod `.strict()` like every other handler; text is length-capped
  (reuse the 1000-char cap from `ChatScreen.tsx:81`). Nothing user-supplied is persisted beyond
  the turn text and the parser's own validated output.
- No new `child_process`/`eval`/dynamic import (§8.7).

## Performance considerations

- The conversation is in-memory (`ChatMessage[]`) plus one synchronous INSERT per turn. At MVP
  scale this is trivial; the `31` §8 sliding-window bound (`K` turns) is a **read** concern that
  only matters once the LLM context window ships (EP-5) — EP-2 stores all turns but replays
  none.
- Auto-scroll uses a ref + `scrollIntoView`, not a re-layout loop.
- `SELECT *` on `conversations` is never done for the live UI (the transcript is the in-memory
  list); history reads are paginated. The main-thread SQLite concern (`30` §6) is unaffected at
  this scale and remains an EP-11 item.

## Risks

- `RISK (medium)` — **Rewriting `ChatScreen` is the highest-churn change and touches the
  untested renderer layer** (`30` §10). Mitigation: add the jsdom vitest project here; the old
  screen stays behind `conversation_ui_enabled` for one release as an instant fallback.
- `RISK (medium)` — **The confirmation gate could regress** when the card moves into a bubble
  (e.g. a proposal auto-confirming, or a clarification gaining a Confirm). Mitigation: the gate
  regression test is mandatory in the DoD; `ProposalBubble` renders Confirm only for `ok`
  parses, never for clarification.
- `RISK (low)` — **Clarification-as-history** changes the interaction feel (old flow re-parsed a
  reconstructed string in place). Mitigation: the parser is unchanged; only the presentation
  differs; conversation tests assert the same reminders result.
- `RISK (low)` — **`conversations` write on every turn** grows the table. Mitigation: reuse the
  existing retention sweep (`31` §4.2); it is bounded and already specified.

## Rollback strategy

`MVP DECISION` — **Feature flag `conversation_ui_enabled`** (`41` §10). It defaults **on** at
v0.3 with the old single-shot `ChatScreen` **one flag away**. If the message-list UI regresses,
flip `conversation_ui_enabled` **off** → the renderer renders the retained v0.2 single-shot
parse→card screen; `chat:send` simply stops being called (it stays registered but idle). No
code revert, no reminder-path change — because reminders still flow through the unchanged
`reminders:create`, turning the flag off cannot break reminder creation. This is exactly the
"regression = flag flip" discipline (`41` §2). The old screen is removed only after v0.3 is
verified on a real build (a subsequent release), mirroring the EP-6 regression-gate pattern.

## Definition of Done

Re-asserting the `41` §8 invariants relevant to EP-2:

- **§8.1** The full offline reminder loop works via the conversation UI (create → confirm →
  schedule → notify + speak), no key, byte-identical outcome to v0.2.
- **§8.2** Zero outbound packets — EP-2 makes no network call (Wireshark-verified).
- **§8.3** The confirmation gate holds — a reminder persists only on explicit Confirm;
  clarification bubbles have no Confirm; placeholder/refusal bubbles have no action.
- **§8.5** The LLM-never-actuates posture is preserved (no LLM path exists; the Confirm-button
  persistence path is the only writer, ready for EP-5 to inherit).
- **§8.6** Notification + history fire unconditionally and first (unchanged lifecycle).

Plus EP-2-specific: `ChatScreen` is a scrolling message list; `useConversation` owns
`ChatMessage[]`; reminders work **exactly** as today through the existing `ipc.createReminder`;
non-reminder input shows the exact placeholder string; `conversations` adopted with **no
migration**; `conversation_ui_enabled` flag switches new/old screen; **96 existing tests green**
plus new `chat-turn-service` + `useConversation` tests; jsdom vitest project added; typecheck +
lint clean.

## Feature Checklist

**Already completed (reused from v0.2)**
- `parseReminder` pipeline, `ParseResult` union, `CreateReminderInput` + business rules.
- `ipc.createReminder` persistence path; scheduler/notifier/tray/fan-out.
- The confirmation gate (Confirm/Cancel + no-Confirm clarification).
- `useSpeech` + `MicButton` dictation; `core/time/format` renderers.
- Provider seams + factory (EP-1); the `conversations` table (dead schema, migration 002).

**New work (EP-2)**
- `useConversation()` hook + `ChatMessage[]` model (renderer).
- `MessageList` + `MessageBubble` + `ProposalBubble` (card as a bubble variant).
- `ChatScreen` rewrite around the message list.
- `chat:send`/`chat:delta`/`chat:done` IPC (delta/done declared; delta idle in EP-2).
- `ChatTurnService` (main) wrapping `parseReminder`; `ConversationRepository`.
- Honest placeholder for non-reminder input.
- `conversation_ui_enabled` flag + retained old screen; jsdom vitest project + renderer tests.

**Deferred work (later EPs)**
- Real `LlmProvider` call + streaming `chat:delta` + `ConversationEngine` + `AssistantTurnSchema`
  — **EP-5**.
- Action Dispatcher; Confirm re-routed `reminders:create` → `action:confirm` → dispatcher;
  `parseReminder` demoted to executor — **EP-6**.
- Voice confirm/cancel, edit, delete via conversation — **EP-7**.
- Memory save/recall bubbles — **EP-9**; research — **EP-10**.

**Future work (post-v1.0)**
- Rich message types (cards, tables, media) beyond text + reminder proposal.
- Conversation search / export.

## Manual Testing

| Step | Action | Expected Result |
| --- | --- | --- |
| 1 | Launch v0.3 (flag on) | Chat shows an empty scrolling conversation + composer + mic |
| 2 | Type "remind me tomorrow at 9am to call the dentist" → send | User bubble appears; assistant `ProposalBubble` shows the reminder summary + Confirm/Cancel |
| 3 | Click **Confirm** | Bubble settles to "✓ Saved — Call the dentist · tomorrow 9:00 AM"; reminder in Schedules |
| 4 | Type "remind me at 5" → send | Assistant clarification bubble with AM/PM chips, **no Confirm** |
| 5 | Click a chip (e.g. "5 PM") | New user turn appended; assistant proposes 5:00 PM reminder; prior turns stay visible |
| 6 | Type "what's the capital of France" → send | Assistant bubble: "Connect OpenAI in Settings to chat and answer questions." |
| 7 | Type several turns | List scrolls; auto-scrolls to newest; scrollback shows full transcript |
| 8 | Flip `conversation_ui_enabled` off, relaunch | Old single-shot parse→card screen renders; reminders still work |
| 9 | Trigger a created reminder | Notification + history first; Yogi speaks — unchanged lifecycle |
| 10 | `npm test` | 96 + new tests green |

## Edge Cases

- Empty / whitespace-only submit → no turn created (same guard as `ChatScreen.tsx:25`).
- Rapid double-send → each is its own turn; no lost/merged bubbles; Confirm targets the right proposal.
- Very long input (>1000 chars) → capped at the composer + Zod boundary.
- Clarification answered with an unrelated new request → parser handles it as a fresh turn; old
  proposal stays visible but inert (Cancel available).
- Reminder confirmed then its row deleted elsewhere → `conversations.reminder_id` FK sets null;
  the settled bubble still shows the historical summary (read-only transcript).
- Placeholder path must never create a `conversations` row that looks like a reminder
  (`intent` = `unknown`/`chat`, `reminder_id` null).

## Failure Cases

- `chat:send` malformed payload → guarded refusal, sanitised; no bubble poisoning.
- `parseReminder` throws (should not, but) → assistant bubble shows a graceful "I couldn't read
  that — try rephrasing," turn not persisted; app never crashes (`31` §5 degrade rule).
- `ipc.createReminder` fails at Confirm (e.g. DB busy) → bubble shows the error inline, stays
  `pending`, Confirm re-enabled; no partial write (existing transactional guarantee).
- `ConversationRepository` insert fails → the reminder still persists (notification/history/
  reminder are first-class; the conversation log is best-effort, §8.6 ordering).

## Recovery Tests

- Kill app mid-turn (after Confirm, before conversation-row write) → on relaunch the reminder
  exists (it was the unconditional write); the conversation may lack that turn's log row — an
  acceptable, documented asymmetry (reminder is authoritative, transcript is best-effort).
- Flip `conversation_ui_enabled` off→on→off → each renders the correct screen; no lost reminders.
- Reopen the app after many turns → Schedules reflects every confirmed reminder regardless of
  conversation-log state.

## Regression Tests

Required (`41` §8/§11), all must pass:
- **The full offline reminder loop still works** — via the conversation UI: type → proposal
  bubble → Confirm → schedule → notify + speak, no key, no network.
- **Wireshark zero packets with cloud off** — EP-2 makes no network call at all; capture from
  launch through reminder fire shows **zero** outbound packets.
- **The confirmation gate holds** — no reminder persists without an explicit Confirm; a
  clarification bubble has no Confirm button; the placeholder bubble triggers nothing.
- **96 existing tests green** — plus new `chat-turn-service` and `useConversation` tests;
  typecheck + lint clean.

## Performance Tests

- Sending 100 turns keeps the list responsive; auto-scroll stays smooth; no memory growth beyond
  the bounded `ChatMessage[]`.
- Per-turn latency is dominated by the synchronous parser (unchanged from v0.2); no added network
  or async wait.
- Conversation INSERT does not stall the UI thread at MVP volume (single-user, small table).

## Expected App Behaviour

**Current → EP-2** (arrow-flow, `41` §9 style):

```text
v0.2 (Current)                               EP-2 (v0.3)
──────────────                               ───────────
Type reminder                                Type reminder
   │                                            │  (user bubble)
parse → single-shot card (overwrites)    ─▶   chat:send → parseReminder
   │                                            │  (assistant ProposalBubble, in a list)
Confirm → ipc.createReminder             ─▶   Confirm → ipc.createReminder   (SAME path)
   │                                            │
schedule → notify + Windows voice             schedule → notify + Windows voice (UNCHANGED)

Non-reminder → refusal card              ─▶   Non-reminder → placeholder bubble
                                              "Connect OpenAI in Settings to chat and
                                               answer questions."
No history / no scrollback               ─▶   Scrolling transcript; turns persist to
                                               the conversations table (no migration)
```

Demo framing (`41` §9): **"the reminder app now shows your requests and Yogi's responses as a
scrolling conversation"** — NOT "chat with Yogi." The intelligence lands in EP-5; EP-2 ships the
surface it will render into, while the reminder app it wraps works exactly as before.

## Conversation Testing

- **User:** "remind me every Monday at 7am to exercise"
  **Expected:** user bubble; assistant `ProposalBubble` — "Exercise · Mondays 7:00 AM ·
  repeats weekly" + Confirm/Cancel; Confirm → saved; recurring reminder in Schedules. Identical
  reminder outcome to v0.2, now in a bubble.
- **User:** "remind me tomorrow to call mom" (missing time is fine; missing title path)
  **Expected:** if the parser needs a detail, a clarification bubble with **no Confirm**; the
  gate holds.
- **User:** "at 5" after a "remind me to stretch" turn
  **Expected:** treated as a new turn by the parser (EP-2 does not thread multi-turn context —
  that is EP-5); prior turns remain visible as history.
- **User:** "tell me a joke" / "what's 2+2" / "who won the game"
  **Expected:** the exact placeholder bubble "Connect OpenAI in Settings to chat and answer
  questions." — **no** fabricated answer, no chat. This is the honest EP-2 boundary (`41` §9).
- **User:** "delete my dentist reminder"
  **Expected:** placeholder bubble — reminder *update/delete via conversation* is EP-7, not EP-2;
  the parser doesn't handle it, so it falls to the placeholder.

## Voice Testing

- Press mic → sherpa loads lazily; live partials tick above the composer; on stop the final
  transcript populates the composer (from `speech:stop`'s return, EP-1's cleaned path).
- Dictate "remind me in five minutes to stretch" → composer fills → send → user bubble +
  `ProposalBubble` → Confirm → saved. The voice path feeds the **same** `chat:send` as typing.
- **No voice confirmation in EP-2** — Confirm is a button click only. Saying "yes" does nothing;
  voice confirm/cancel is EP-7 (`voice_confirm_enabled`). The mic in EP-2 is dictation-only,
  exactly as v0.2.
- Trigger a confirmed reminder while the app sits in the tray → Yogi speaks via the Windows
  voice (`WebSpeechTtsProvider`, `kind:'in-window'`) — unchanged lifecycle.
- Verify dictating a non-reminder ("what's the weather") transcribes into the composer and, on
  send, yields the placeholder bubble — voice does not unlock chat.
