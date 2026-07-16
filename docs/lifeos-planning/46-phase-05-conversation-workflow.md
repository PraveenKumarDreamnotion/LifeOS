# 46 — Execution Phase EP-5: Conversation Workflow (real chat / Q&A)

> **Ships:** v0.5 (`41` §7). **Cloud:** opt-in, per-feature, consented. **Flag:**
> `ai_assist_enabled` (+ `ai_consent_accepted_at`). **Depends on:** EP-1 (LlmProvider
> interface + factory + `safeStorage` key mechanism + the live `cloudEnabled` predicate that
> replaced the dead `() => false` probe, `30` D1 / `32` §3.1) and EP-2 (the conversation shell
> — `ChatScreen` rewritten as a message list, `useConversation`, the proposal-as-bubble
> variant, `30` §3.1). **Authority for sequencing:** `41`. **Does NOT depend on any later phase.**
>
> **One-line objective:** wire the real `OpenAiLlmProvider` (`33` §4) into a new main-process
> `ConversationEngine` so Yogi actually *converses* — but keep reminders on the existing local
> path, because the Action Dispatcher is EP-6.

---

## Objective

Make Yogi hold a real conversation. Concretely: for **reply-only intents** (`chat`,
`question` — `31` §2), the `ConversationEngine` calls `OpenAiLlmProvider.stream()` (`33` §4),
streams the reply token-by-token over `chat:delta` (`32` §5), and validates the assembled
`AssistantTurn` through the four gates (`31` §5). This is the phase where the honest demo flips
from "the reminder app, now with better voice" to **"ask Yogi anything — it converses"** (`41`
§9).

`MVP DECISION` — **In EP-5 the LLM is trusted for reply-only intents ONLY.** When the
validated `AssistantTurn.intent` is an **action intent** (`reminder_*`, `settings`, `memory_*`,
`research`), EP-5 **discards the model's proposed `action`** and routes the *original user
text* to the **existing local reminder path** (`parseReminder` → `ResultCard` → the EP-2 direct
`ipc.createReminder` confirm). The Action Dispatcher that would validate/confirm/execute an
LLM-proposed action is **EP-6** (`47`). Therefore **reminders are byte-for-byte unchanged this
phase** — the LLM adds conversation on top of an untouched reminder loop.

`MVP DECISION` (do-not-omit, `41` §6) — **EP-5 ships the empty `memories: []` slot** in the
context window built in main (`31` §4.3). It is wired end-to-end (built, sent, ignored by the
prompt) so **EP-9 fills it additively** rather than editing EP-5's context builder.

---

## Why this phase exists

Today `parseReminder(text)` **is** the whole pipeline (`30` §3.1, `31` §1): every utterance is
assumed to be a reminder, and anything non-reminder is refused with "I only set reminders right
now" (`parse-reminder.ts:35`). EP-2 gave the app a conversation *shell* (a scrolling message
list) but no intelligence behind it — non-reminder input still shows the honest placeholder
"Connect OpenAI in Settings to chat and answer questions" (`41` §9). EP-5 is the phase that puts
a real model behind that shell so greetings, questions, and open chat get real answers, while
the proven offline reminder loop keeps working untouched with no key and no network (`41` §8.1).

It is sequenced here (not earlier) because it needs both EP-1's key mechanism and EP-2's
message-list scaffolding (`41` §6 dependency graph), and it is sequenced *before* EP-6 because
conversation must exist before there are LLM actions worth dispatching.

---

## Current code that will be reused

Reused **unchanged** (`30` §13, `31` §7):

| Reused as-is | Why |
| --- | --- |
| `core/parsing/*` (`parse-reminder.ts`, `detect-intent.ts`, `extract-*`, `clarification.ts`) | Still the reminder path this phase. **Not** demoted yet — that is EP-6. `parseReminder` remains the reminder router for action-intent input. |
| `ChatScreen` message list + `useConversation` + proposal-as-bubble (from EP-2) | EP-5 plugs real streaming replies into the existing shell; it does not rebuild the UI. |
| `src/hooks/useSpeech.ts`, `MicButton.tsx` | STT capture into the composer is unchanged; the finalised transcript is the same string EP-5 sends to `chat:send`. |
| `electron/main/ipc/index.ts` `CH.REMINDERS_CREATE` + `validateBusinessRules` + `reminders.create` | The action-intent branch still lands here (the EP-2 direct path). Byte-identical reminder creation. |
| EP-1's `LlmProvider` interface + factory (`33` §4/§5), `safeStorage` key store, `settings:setApiKey/clearApiKey/validateApiKey` (`32` §3.3/§4), the live `cloudEnabled` predicate + re-installable session security (`32` §3.1) | EP-5 supplies the concrete `OpenAiLlmProvider` and consumes all of this; it builds none of it. |
| The secure `webPreferences`, navigation locks, default-deny network, CSP (`30` §7) | Extended by exactly the one origin EP-1 already gated (`api.openai.com`), never weakened. |
| The `conversations` table DDL (migration 002, `31` §4.2) | Adopted as-is; EP-5 is the first writer. No migration. |

---

## Code that must be refactored

EP-5 is deliberately **additive** — the only "refactor" is turning EP-2's stubbed chat path
into a real one:

- **`ChatScreen`/`useConversation` send path (EP-2 stub → real stream).** In EP-2, `chat:send`
  either routed to the local parser or returned the offline placeholder. EP-5 makes `chat:send`
  drive the `ConversationEngine`; the renderer now appends a `streaming: true` assistant bubble
  and grows it from `chat:delta` events (`31` §4.1, `32` §5).
- **The reply/placeholder branch in the shell.** The single "Connect OpenAI to chat"
  placeholder becomes conditional on the gate: shown only when `ai_assist_enabled` is off /
  unconsented / the call failed (`32` §2); otherwise a real streamed reply renders.

No rename of `Intent`, no dispatcher, no parser demotion — those are **EP-6** (`41` §4.2, kept
out of this phase on purpose).

---

## Files expected to change

| File | Change |
| --- | --- |
| `core/conversation/intent.ts` | **New.** `ConversationIntent` union + `REPLY_ONLY_INTENTS` / `ACTION_INTENTS` (`31` §2). |
| `core/conversation/turn-schema.ts` | **New.** `AssistantTurnSchema` (Zod `.strict()`) + `AssistantTurn` type (`31` §3). Shape gate only this phase. |
| `core/conversation/system-prompt.ts` | **New.** The static `SYSTEM_PROMPT` describing Yogi + the closed action set (`31` §4.3). |
| `core/llm/openai-llm-provider.ts` | **New.** `OpenAiLlmProvider implements LlmProvider` — `complete()`/`stream()` against `POST /v1/chat/completions` Structured Outputs (`32` §1, `33` §4). |
| `electron/conversation/conversation-engine.ts` | **New.** Main-process engine: builds context, calls the provider via the factory, streams deltas, runs gates, persists the turn. |
| `electron/conversation/context-builder.ts` | **New.** Builds `LlmTurnInput` from validated state incl. the empty `memories: []` slot (`31` §4.3). |
| `electron/database/conversation-repository.ts` | **New.** First writer of the existing `conversations` table (`31` §4.2). |
| `electron/main/ipc/chat.ts` | **New.** `chat:send`/`chat:cancel` handlers on `guard()`; `chat:delta`/`chat:done` broadcasts (`32` §4). |
| `electron/main/index.ts` | Construct + inject `ConversationEngine`; register `chat.ts` handlers in the startup sequence. |
| `src/features/chat/useConversation.ts` | Consume real `chat:delta`/`chat:done`; drive the streaming bubble (EP-2 stub → live). |
| `src/features/chat/ChatScreen.tsx` | Gate the offline placeholder vs the streamed reply. |
| `src/lib/ipc.ts` | Add `chat.send/cancel` + `onChatDelta/onChatDone` typed wrappers. |
| `electron/preload/index.ts` | Expose `chat.send/cancel` + the two receive-only subscriptions (named fns only, `30` §7). |

---

## New folders

- `core/conversation/` — intent taxonomy, turn schema, system prompt (framework-free; stays
  behind the `core/` ESLint purity wall, `30` §2.1). **`action-schemas.ts` is deferred to
  EP-6** — EP-5 needs only the shape gate.
- `core/llm/openai/` — the OpenAI request/response mapping for chat (kept separate from the
  pure `LlmProvider` type in `core/llm/`).
- `electron/conversation/` — the main-process `ConversationEngine` + `context-builder`.

---

## New services

- **`ConversationEngine` (main).** Owns per-turn flow (`31` §5): append context → call provider
  → stream deltas → assemble → **Gate 1 shape** (`AssistantTurnSchema.parse`) → branch on
  intent → persist. Reply-only → emit `chat:done` with the reply. Action intent → emit a
  `chat:done` that tells the renderer to fall to the local reminder path (no `proposal` yet;
  that's EP-6).
- **`OpenAiLlmProvider` (main).** Concrete `LlmProvider` (`33` §4). `stream()` forwards token
  deltas; the full object is re-validated after the stream ends (`32` §5). `complete()` is the
  non-streamed fallback if Structured-Outputs+streaming interact awkwardly.
- **`ConversationRepository` (main).** One row per completed turn into `conversations`
  (`user_text`, `assistant_response`, `intent`, `reminder_id` nullable) — **never** the raw
  model JSON (`31` §4.2).
- **`ContextBuilder` (main).** Assembles `LlmTurnInput` from validated state: `system`, `now`,
  `timezone`, a **titles-only** reminder summary (no ids), the last-K turns, and **`memories:
  []`** (the reserved EP-9 slot).

---

## IPC changes

New/activated channels (all `guard()`-wrapped, `32` §4). Key-management channels
(`settings:setApiKey/clearApiKey/validateApiKey`) already exist from EP-1 and are reused:

| Channel | Kind | Payload → Returns | Validation |
| --- | --- | --- | --- |
| `chat:send` | invoke | `{ text }` → `{ turnId }` | `z.string().trim().min(1).max(4000)` |
| `chat:delta` | broadcast | `{ turnId, delta }` | main → renderer only |
| `chat:done` | broadcast | `{ turnId, message, proposal? }` (`proposal` always `undefined` in EP-5) | main → renderer only |
| `chat:cancel` | invoke | `{ turnId }` → `void` | uuid |

`MVP DECISION` — `chat:delta`/`chat:done` mirror the proven `speech:partial` streaming pattern
(`32` §4, `31` §5). The renderer **never** receives raw model JSON — only the validated `reply`
text (streamed) and, from EP-6 onward, a display-ready `proposal`.

---

## Database changes

- **No migration.** The `conversations` table already exists (migration 002, `31` §4.2, `30`
  §3.2 — dead schema until now). EP-5 is its **first writer** via `ConversationRepository`.
- One row per completed turn: `user_text`, `assistant_response`, `intent`, `reminder_id`
  (stays `NULL` in EP-5 — the reminder still comes from the local direct path, not a turn-linked
  execution; EP-6 begins populating it). Retention piggybacks on the existing history sweep
  (`31` §4.2).
- **Not stored:** raw model JSON, tool traces, the API key, or any secret (`31` §4.2, `32`
  §3.3).

---

## UI changes

- **Streaming reply bubble.** Assistant messages now render progressively (`streaming: true`
  until `chat:done`), matching the live-transcript pattern users already know from STT (`31`
  §4.1).
- **Conditional placeholder.** The EP-2 "Connect OpenAI in Settings to chat and answer
  questions" copy shows only when the chat gate is closed (off / unconsented / failed); with the
  gate open, real answers replace it (`41` §9).
- **Chat consent modal.** First use of `ai_assist_enabled` shows the disclosure headline
  **"Your command text is sent to OpenAI."** plus the titles-only-reminder-summary note (`32`
  §2). Consent is per-feature and revocable in Settings; enabling chat does **not** enable cloud
  STT or TTS (`32` §2, "consent is not transitive").
- **Reminder proposals unchanged.** Action-intent input still renders the existing `ResultCard`
  (Confirm / Cancel), because reminders are on the EP-2 path this phase.

---

## Main process changes

- **Startup wiring (`electron/main/index.ts`).** After DB+settings and before/with the IPC
  registration step (`30` §1), construct the provider factory result for LLM, the
  `ConversationEngine`, `ConversationRepository`, and register `chat.ts`.
- **The four gates run in main (`31` §5).** Gate 1 (`AssistantTurnSchema.parse`) always;
  reply-only intents stop there. Action intents are **not** gated-2/3 here (no dispatcher) —
  they hand off to the local path. The renderer is never trusted to have validated anything
  (`31` §5, `11` §8).
- **All OpenAI `fetch` in main (`32` §3.3).** The key is read at call time from `safeStorage`,
  attached to the `Authorization` header, and dropped. Never logged (the `sk-` redaction in
  `logger.ts` stays as defence in depth).
- **Failure degradation (`32` §5, `31` §5 MVP DECISION).** No key / offline / 401 / 429 /
  timeout (chat 20 s) → for reminder-shaped input fall to the local parser; for pure chat/Q&A
  show the "I couldn't reach the assistant" notice. **Never worse than the offline MVP.**

---

## Renderer changes

- **`useConversation` consumes real streams.** Subscribe to `chat:delta` (append to the
  streaming bubble) and `chat:done` (finalise + clear `streaming`). Send via `chat.send`; expose
  `cancel` → `chat:cancel`.
- **`ChatScreen` routing.** Submit → `chat.send`. On a `chat:done` that signals an action-intent
  fall-through, invoke the existing local reminder path (`ipc.parse` → `ResultCard`) exactly as
  EP-2 did. Reply-only → render the finalised bubble.
- **No new confirmation UI.** Confirm/Cancel remain the existing `ResultCard` controls; the
  dispatcher's proposal card is EP-6.

---

## Provider changes

- **`OpenAiLlmProvider` is the concrete cloud LLM (`33` §4).** `id: 'openai'`, `isLocal:
  false`, `supportsStreaming: true`. `complete()` returns `unknown` **by design** (`33` §4, `09`
  §9) — the type system forces the engine through `AssistantTurnSchema.parse`. Structured
  Outputs (`response_format: json_schema, strict:true`) constrains decoding; the gates still run.
- **Factory + fallback (`33` §5).** `makeLlmProvider(settings)` returns `OpenAiLlmProvider`
  only when `ai_assist_enabled && hasApiKey() && ai_consent_accepted_at`; otherwise there is **no
  cloud LLM** and chat degrades to the placeholder / the local parser. Re-run on
  `settings:changed` (the same live re-bind that fixed `30` D1).
- **STT/TTS providers untouched** — EP-3/EP-4 own those.

---

## Security considerations

- **The LLM never actuates (`31` §6, `36` §7, `41` §8.5).** In EP-5 the model literally cannot
  touch a reminder: action intents are dropped and the *local parser* produces the reminder,
  which still passes through the existing Confirm button. There is no path from `AssistantTurn`
  to `repo.*`.
- **Key never crosses IPC (`32` §3.3, `41` §8.4).** Stored via `safeStorage` (DPAPI); every call
  in main; `settings:get` returns `hasApiKey: boolean` only (`ipc/index.ts:191`).
- **No ids / sensitive data in the context window (`31` §4.3).** Reminders are summarised as
  titles + relative time (no UUIDs, no epoch-ms); `memories: []` is empty and, from EP-9,
  sensitive facts are **never** included. A prompt-injected model cannot exfiltrate a row it was
  never shown (`31` §6).
- **Pending-proposal invariant (`36` §4.3) — pre-satisfied.** EP-5 emits no executable proposal,
  so the renderer has nothing to "confirm into execution." When EP-6 introduces proposals, the
  invariant (confirm executes the *stored* validated action, not a renderer payload) is what
  keeps the renderer from executing an unshown action.
- **One origin only (`32` §3.2).** `api.openai.com` and nothing else; with chat off the
  allowlist is empty and the Wireshark off→zero test holds (`41` §8.2).
- **No `child_process`/`eval`/dynamic import (`41` §8.7).** Every model output is data rendered
  as text.

---

## Performance considerations

- **Bounded context (`31` §4.3, §8).** Cost and latency stay flat regardless of total history
  because only the sliding window (`K`, default 12) is sent; persisted turns are read-only.
- **Streaming perceived latency (`32` §5).** First `chat:delta` should render within the
  network round-trip; the spinner→text gap matches STT's existing "Processing…" affordance.
- **Main-thread synchronous SQLite (`30` §6).** Writing one small `conversations` row per turn is
  negligible now; flagged for the EP-11 async-facade watch as history grows.
- **Timeout budget (`32` §5).** Chat 20 s hard cap → abort → degrade. No unbounded awaits across
  IPC.

---

## Risks

- `RISK` — **Structured Outputs + streaming interaction.** If token streaming corrupts strict
  JSON assembly, replies validate as broken. *Mitigation:* re-validate the whole assembled object
  after the stream ends; fall back to non-streamed `complete()` (`32` §5). The interface allows
  both.
- `RISK` — **The model returns an action intent for a reminder-shaped utterance.** Expected and
  handled: EP-5 drops the action and uses the local parser, so reminder behaviour is unchanged.
  The risk is a *worse* reminder result than the pure-parser path — avoided precisely because we
  do **not** trust the LLM's fields this phase.
- `RISK` — **Consent-copy drift.** Reminder-first "nothing uploaded" copy still lives in ≥3 UI
  places (`30` §3.1). Enabling chat contradicts it. *Mitigation:* the chat consent modal states
  the exact leak; the full copy audit is EP-8 (`34`).
- `RISK` — **`memories: []` quietly diverges from EP-9's expectation.** *Mitigation:* it is
  shipped wired and asserted by a Regression Test below, so EP-9 is an additive fill.

---

## Rollback strategy

- **Primary: flip `ai_assist_enabled` off (or revoke consent).** The gate closes, the factory
  returns no cloud LLM, chat/Q&A degrade to the offline placeholder, reminders keep using the
  local parser (`32` §2, `41` §10). **A regression is a flag flip, not a code revert** (`41` §2).
- **Reminders are never at risk:** they never left the EP-2 path this phase, so no rollback can
  affect the reminder loop.
- **Network kill:** with the flag off, `cloudEnabled()` is false, the allowlist is empty, and
  the app is byte-for-byte the offline v0.3 build (`41` §8.2).

---

## Definition of Done

Re-asserts the `41` §8 cross-cutting invariants **plus** phase specifics:

1. **Full reminder loop works offline, no key** (create → confirm → schedule → notify + speak)
   — unchanged from v0.3 (`41` §8.1).
2. **Zero outbound packets with chat off** (Wireshark 30-min, SEC-10) (`41` §8.2).
3. **The confirmation gate holds** — reminders still require the Confirm button; the LLM
   proposes nothing executable (`41` §8.3, §8.5).
4. **The API key never crosses IPC**; all OpenAI calls in main (`41` §8.4).
5. **The LLM never actuates** — action intents are dropped; only the local parser creates
   reminders (`41` §8.5).
6. **Notification + history fire unconditionally and first** (`41` §8.6).
7. With chat **on + keyed + consented**, `chat:send` streams a real reply for `chat`/`question`
   and traffic goes to `api.openai.com` **only** (`32` §8.4).
8. **`memories: []` is present, wired, and empty** in every context window (asserted below).
9. The chat consent disclosure ("Your command text is sent to OpenAI.") is shown before first
   use and consent is revocable (`32` §8.6).
10. Phase checklist green + the `41` §8 regression suite green (`41` §11).

---

## Feature Checklist

**Already completed (prior phases):**
- `LlmProvider` interface + factory + `withFallback` decorator (EP-1, `33` §4/§5).
- `safeStorage` key store + `settings:setApiKey/clearApiKey/validateApiKey` (EP-1, `32` §3/§4).
- Live `cloudEnabled` predicate + re-installable session security (EP-1, `30` D1 / `32` §3.1).
- Conversation shell: message list, `useConversation`, proposal-as-bubble variant, offline
  placeholder (EP-2, `30` §3.1).

**New work (EP-5):**
- `OpenAiLlmProvider` (`complete`/`stream`) against Structured Outputs (`32` §1, `33` §4).
- `ConversationEngine` + `ContextBuilder` (with the `memories: []` slot) + `ConversationRepository`.
- `core/conversation/{intent,turn-schema,system-prompt}.ts`; Gate 1 shape validation.
- `chat:send/delta/done/cancel` IPC + streaming bubble UI.
- Chat consent modal + gated placeholder.

**Deferred work (later phases):**
- Action Dispatcher, `core/conversation/action-schemas.ts`, `core/actions/`, validate→confirm→
  execute for LLM actions, parser demotion, `Intent`→`ReminderIntent` (EP-6, `47`).
- Voice/text "yes" confirmation of proposals (EP-7).
- `memories: []` **filled** with non-sensitive subject-matched facts (EP-9).
- Research/weather intents lighting up (EP-10).

**Future work:**
- `FUTURE OPTION` — Ollama local LLM behind the same `LlmProvider` seam, post-1.0 (`33` §4,
  `41` §7).
- `FUTURE OPTION` — Anthropic / Gemini providers as separate consented origins (`32` §7).

---

## Manual Testing

| Step | Action | Expected Result |
| --- | --- | --- |
| 1 | Fresh install, no key, open Ask Yogi | Composer + offline placeholder for non-reminder input; reminder input works fully (v0.3 behaviour). |
| 2 | Settings → enable AI Assist without a key | Blocked; prompt to add a key; chat stays off. |
| 3 | Add a valid key; enable AI Assist | Consent modal shows "Your command text is sent to OpenAI." + titles-only note. Accept. |
| 4 | Type "Hello" | Streamed greeting reply; no reminder created; a `conversations` row is written. |
| 5 | Type "Explain Docker in one line" | Streamed explanation; **no** reminder card. |
| 6 | Type "Remind me tomorrow at 9am to call Rahul" | Existing `ResultCard` proposal (Confirm/Cancel); **nothing saved yet**; identical to v0.3. |
| 7 | Press Confirm on the card | Reminder created; appears in Active Schedules; "✓ Saved". |
| 8 | Have a 15-message back-and-forth | Later replies stay coherent within the last-K window; latency flat. |
| 9 | Revoke chat consent in Settings | Non-reminder input reverts to the placeholder; reminders still work. |
| 10 | Turn AI Assist off; run Wireshark 30 min | Zero outbound packets. |

---

## Edge Cases

- **Empty / whitespace-only submit** → rejected by `z.string().trim().min(1)`; no call.
- **4000-char input** → accepted at the cap; over → rejected client- and main-side.
- **Model returns `needsClarification: true` on a reply-only intent** → `reply` *is* the
  question; no action; rendered as a normal assistant bubble.
- **Model returns an action intent for clearly-chat input** ("thanks!") → action dropped; local
  parser refuses gracefully; user sees the reminder-examples refusal (existing behaviour), which
  is acceptable this phase (EP-6 fixes the routing).
- **Reminder-shaped input while cloud is ON** → still routed to the local parser (action-intent
  branch); result byte-identical to cloud-off.
- **Unknown extra key in the model JSON** → `AssistantTurnSchema.strict()` rejects → generic
  clarify (`31` §3, Gate 1).
- **`reminder_update` / `reminder_delete` by chat** → no local executor exists for these (the
  parser only creates); Yogi replies it can't change reminders by chat yet and points to Active
  Schedules (EP-6 delivers this).

---

## Failure Cases

| Failure | Behaviour (`32` §5) |
| --- | --- |
| No network / offline | Reminder-shaped → local parser; chat/Q&A → "Yogi's online features need a connection." |
| 401 invalid key | Offline provider; Settings banner "Your API key was rejected."; chat disabled this session. |
| 429 / 5xx | One backoff retry → then offline provider / notice. |
| Timeout (chat 20 s) | Abort → degrade; composer never blocked. |
| Rejected/broken JSON | Reminder-shaped → local parser; chat → "couldn't reach the assistant"; log reason code + a **hash** of input, never the input. |
| Stream corrupts mid-flight | Discard partial; retry once non-streamed `complete()`; else degrade. |

---

## Recovery Tests

1. Kill Wi-Fi mid-reply → reply aborts, "needs a connection" notice, composer usable; reminders
   still work.
2. Rotate to an invalid key mid-session → next chat 401 → banner → chat off → reminders
   unaffected → fix key → chat recovers without restart (live re-bind).
3. Force a 20 s timeout (throttle) → abort → degrade → next request after network returns
   succeeds.
4. Crash-restart during a streaming turn → no partial `conversations` row persisted (row written
   only on completion); no orphaned state.

---

## Regression Tests (`41` §8, §11)

1. **Full offline reminder loop with cloud off** — create/confirm/schedule/notify+speak all
   pass (`41` §8.1).
2. **Wireshark off→zero** — 30 min, chat off, zero packets (`41` §8.2). On→`api.openai.com`
   only.
3. **Confirmation gate holds** — no reminder persists without the Confirm button; the LLM
   proposes nothing executable (`41` §8.3, §8.5).
4. **Reminder outcome identical cloud-on vs cloud-off** — same utterance, compare the created
   row (minus id/timestamps): identical. (This is the pre-image of EP-6's byte-identical
   re-route gate.)
5. **`memories: []` present + empty** — snapshot the built `LlmTurnInput`: `memories` is `[]`,
   present on every call. (Guards EP-9's additive fill.)
6. **`settings:get` leaks nothing** — returns `hasApiKey` boolean, never ciphertext (`30` §7,
   `ipc/index.ts:191`).
7. **No ids/timestamps in context** — the reminder summary contains titles + relative time only.

---

## Performance Tests

1. **First-delta latency** ≈ network RTT; spinner shows until first token.
2. **Flat cost/latency across a long conversation** — turn 2 and turn 30 send the same-sized
   window; measure request size is bounded by `K`.
3. **Main-thread jank** — one `conversations` INSERT per turn keeps the 30 s scheduler tick and
   tray refresh unaffected (`30` §6).
4. **Timeout enforcement** — a stalled request aborts at 20 s, not later.

---

## Expected App Behaviour (Current → EP-5)

```text
BEFORE (v0.3, EP-2 shell, offline):
  user text ─▶ ChatScreen ─▶ ipc.parse ─▶ ParseResult
                 │                         ├─ reminder  → ResultCard → ipc.createReminder
                 │                         └─ non-reminder → OFFLINE PLACEHOLDER

AFTER (v0.5, EP-5, chat on + keyed + consented):
  user text ─▶ chat:send ─▶ ConversationEngine (main)
                 │            ├─ build context {system, now, tz, remindersSummary,
                 │            │                  lastK, memories: []}     ← EP-9 fills memories
                 │            ├─ OpenAiLlmProvider.stream ─▶ chat:delta ─▶ streaming bubble
                 │            └─ assemble ─▶ Gate 1 (AssistantTurnSchema)
                 │                 ├─ reply-only (chat/question) ─▶ chat:done ─▶ reply
                 │                 └─ ACTION intent ─▶ DROP action ─▶ local parseReminder
                 │                                     ─▶ ResultCard ─▶ ipc.createReminder  (UNCHANGED)
  (chat off / failed) ─▶ offline placeholder (chat) / local parser (reminder)
```

---

## Conversation Testing

Chat on + keyed + consented unless noted. Reminders still use the local path (EP-2), so their
confirmation is the **`ResultCard` Confirm button** — voice/text "yes" confirmation is EP-6/EP-7.

- **User:** "Hello"
  **Expected:** Streamed friendly greeting (e.g. "Hi! I'm Yogi — how can I help?"). No reminder,
  no card. `intent: chat`.
- **User:** "Who are you?"
  **Expected:** Streamed intro — Yogi, a private reminder + conversation assistant. No action.
  `intent: question`/`chat`.
- **User:** "Explain Docker"
  **Expected:** Streamed explanation from the model's own knowledge. **No reminder created, no
  card.** `intent: question`.
- **User:** "Tell me a joke"
  **Expected:** Streamed joke; conversation continues naturally; no action. `intent: chat`.
- **User:** "Remind me tomorrow to call Rahul"
  **Expected:** `intent: reminder_create` → action **dropped** → local parser → `ResultCard`
  proposal ("Call Rahul · tomorrow · one-time"). **NOT created yet.**
- **User:** press **Confirm** on the pending card (the scripted "Yes")
  **Expected:** Reminder created; appears in Active Schedules; "✓ Saved". *(A typed bare "Yes"
  goes to the LLM as chat this phase; wired voice/text "yes" confirmation is EP-6/EP-7.)*
- **User:** "Delete tomorrow's reminder"
  **Expected:** `intent: reminder_delete` has no local executor yet → Yogi replies it can't
  change reminders by chat yet and points to Active Schedules to delete it there. *(Conversational
  delete with a confirmation gate arrives in EP-6.)*

---

## Voice Testing

STT capture is unchanged (EP-3 owns cloud STT; sherpa offline otherwise). EP-5 only consumes the
**finalised transcript** string.

1. Mic → dictate "Hello" → transcript lands in composer → submit → same streamed greeting as
   typed. (`useSpeech` → `chat:send`.)
2. Dictate "Explain Docker" → transcript → streamed explanation; no reminder.
3. Dictate "Remind me tomorrow to call Rahul" → transcript → local parser → `ResultCard`; confirm
   via the button. (No voice "yes" yet — EP-7.)
4. Cloud chat failure mid-turn does **not** affect STT capture; the composer stays usable.
5. There is **no** voice confirmation of proposals in EP-5 — pending cards are confirmed by
   button only (voice "yes"/"no" matching is EP-7, `36` §4.1).
```
