# 31 — Conversation Engine Architecture

> **This document is the canonical source for the shared vocabulary** the rest of the v2
> plan depends on: the **Intent taxonomy**, the **assistant-turn / structured-action JSON
> schema**, and the **conversation data model**. Docs `32`–`39` reference the definitions
> here rather than re-declaring them. Where this doc and an older design doc disagree, this
> doc wins for v2.
>
> **Governing principle (unchanged from `09`, `30` §13):**
> *The LLM is a suggestion engine, not an actuator. It returns structured JSON. The
> application validates every field, and a human confirms anything consequential that modifies
> data (the one bounded exception is the reversible safe-settings carve-out — `36` §4.2).
> There is exactly one path to persistence, and it runs through a button.*

---

## 1. Why this exists

Today `parseReminder(text)` **is** the whole pipeline: text in, a `ParseResult` (reminder /
clarification / refusal) out. It assumes every utterance is a reminder (`30` §3.1). The new
product is conversation-first: most turns are chat, questions, or research; reminders,
memory, and settings are *actions* the assistant may propose mid-conversation.

The Conversation Engine is the new top of the pipeline. It owns dialogue state, calls the
LLM, receives a structured turn, and hands any action to the **Action Dispatcher** (`36`).
The existing deterministic parser is **not deleted** — it becomes the offline fallback and
the reminder validator behind the dispatcher (`30` §9, `33` §6).

```text
Voice/Text ─▶ Conversation Engine ─▶ LLM (structured JSON) ─▶ Intent + optional Action
                    │                                                    │
              Conversation History                              Action Dispatcher (36)
              (in-memory + SQLite)                                       │
                    ▲                                          Confirmation Layer (36 §4)
                    └──────────── assistant reply ◀────────────────────  │
                                                                  Execution Layer
                                                                         │
                                                                    SQLite / providers
```

---

## 2. The Intent taxonomy (canonical)

The brief lists: CHAT, QUESTION, RESEARCH, REMINDER_CREATE, REMINDER_UPDATE,
REMINDER_DELETE, MEMORY_SAVE, MEMORY_QUERY, SETTINGS, UNKNOWN. Codified as a closed union
that **supersedes** the two-value `Intent` in `core/parsing/types.ts` (which is renamed to
`ReminderIntent` and kept internal to the reminder module):

```ts
// core/conversation/intent.ts
export type ConversationIntent =
  | 'chat'             // smalltalk, greeting, acknowledgement — reply only, no action
  | 'question'         // answerable from the model's own knowledge — reply only
  | 'research'         // needs a live/external source (weather, web, a document) — v0.5
  | 'reminder_create'
  | 'reminder_update'
  | 'reminder_delete'
  | 'memory_save'      // v0.3
  | 'memory_query'     // v0.3
  | 'settings'         // "turn on dark mode", "use the calm voice"
  | 'unknown';         // refuse gracefully, offer examples

export const REPLY_ONLY_INTENTS = ['chat', 'question'] as const;      // no action, no gate
export const ACTION_INTENTS = [
  'reminder_create', 'reminder_update', 'reminder_delete',
  'memory_save', 'memory_query', 'settings', 'research',
] as const;
```

Rules:
- **Reply-only intents** (`chat`, `question`) produce an assistant message and nothing else.
- **Action intents** produce an assistant message **plus** an `action` object routed to the
  dispatcher. Actions that modify data pass through the Confirmation Layer (`36` §4).
- `research`, `memory_*` are **defined now, implemented later** (`37` phases). The engine and
  schema carry them from day one so the contract never changes when they light up — the same
  discipline `10`/`24` used for the `memories` table.
- Availability is enforced in **main**, not by the prompt: if a capability is disabled (e.g.
  memory in v0.2, or research), the dispatcher returns a friendly "I can't do that yet" and
  the LLM's proposal is dropped. The model may *think* it can; the app decides it can't.

---

## 3. The assistant turn — structured output (canonical schema)

Every LLM call returns **one** `AssistantTurn` object. This is the single contract between
the model and the app. It is used verbatim as the OpenAI Structured-Outputs `json_schema`
(`strict:true`) **and** as the Zod validator on the way back in (the `09` pattern, one
schema, two uses).

```ts
// core/conversation/turn-schema.ts
import { z } from 'zod';

export const AssistantTurnSchema = z.object({
  intent: z.enum([
    'chat','question','research',
    'reminder_create','reminder_update','reminder_delete',
    'memory_save','memory_query','settings','unknown',
  ]),

  // What Yogi says out loud / on screen. ALWAYS present, even for actions.
  reply: z.string().trim().min(1).max(2000),

  // Present only for action intents; null for chat/question/unknown.
  // Discriminated by `intent`; validated by a per-intent sub-schema AFTER shape parse.
  action: z.unknown().nullable(),

  // The model's own confidence that it understood the request. Advisory only —
  // it NEVER bypasses the confirmation gate (mirrors 09 §4.1).
  confidence: z.number().min(0).max(1),

  // If the model needs one detail before it can propose a complete action.
  // When true, `action` stays null and `reply` IS the question.
  needsClarification: z.boolean(),
}).strict();   // unknown keys are a REJECTION (09 §5 Gate 1)

export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;
```

`action` is deliberately `z.unknown()` at the top level and validated by a **second**
per-intent schema, so the shape gate and the semantics gate stay separate (`09` §5). The
per-intent action schemas reuse the existing `core/types/ipc.ts` inputs wherever possible:

```ts
// core/conversation/action-schemas.ts
export const ReminderCreateAction = z.object({
  kind: z.literal('reminder_create'),
  // The model proposes ISO + zone; the app converts to epoch-ms and re-validates
  // against CreateReminderInput (15 §2) — the model NEVER supplies epoch-ms directly.
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable(),
  scheduledAt: z.string().datetime({ offset: true }),
  timezone: ISO_ZONE,
  recurrenceRule: SUPPORTED_RRULE.nullable(),
}).strict();

export const ReminderUpdateAction = z.object({
  kind: z.literal('reminder_update'),
  reminderRef: z.string().min(1),          // a title/relative reference the app RESOLVES,
  patch: z.object({ /* title?, scheduledAt?, recurrenceRule? */ }).strict(),
}).strict();                                //   never a raw DB id from the model (see §6)

export const ReminderDeleteAction = z.object({
  kind: z.literal('reminder_delete'),
  reminderRef: z.string().min(1),
}).strict();

export const MemorySaveAction = z.object({   // v0.3
  kind: z.literal('memory_save'),
  subject: z.string().trim().min(1).max(120),
  fact: z.string().trim().min(1).max(500),
  category: z.enum(['health','family','work','preference','other']),
}).strict();

export const MemoryQueryAction = z.object({   // v0.3
  kind: z.literal('memory_query'),
  subject: z.string().trim().min(1).max(120),
}).strict();

export const SettingsAction = z.object({
  kind: z.literal('settings'),
  // Closed set of user-safe settings the assistant may change. NOT arbitrary keys —
  // it can never touch ai_key_ciphertext, consent flags, or provider internals.
  change: z.discriminatedUnion('setting', [
    z.object({ setting: z.literal('theme'), value: z.enum(['system','light','dark']) }),
    z.object({ setting: z.literal('tts_enabled'), value: z.boolean() }),
    z.object({ setting: z.literal('reminders_paused'), value: z.boolean() }),
    z.object({ setting: z.literal('voice'), value: z.string().max(40) }),
  ]),
}).strict();

export const ResearchAction = z.object({      // v0.5
  kind: z.literal('research'),
  query: z.string().trim().min(1).max(500),
  provider: z.enum(['weather','web','document']).nullable(),
}).strict();
```

**Why references, not ids (§6 expands):** the model receives a *summarised* view of the
user's reminders (title + relative time), never raw UUIDs, and proposes a `reminderRef`
(e.g. "the dentist reminder"). The app resolves the ref to a real id and shows the resolved
target in the confirmation card. A model can never name a row it wasn't shown.

---

## 4. Conversation data model

### 4.1 In-memory (renderer)

The renderer gains the message model it lacks today (`30` §3.1):

```ts
// src/features/chat/conversation-types.ts
export interface ChatMessage {
  id: string;                          // client-generated
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  // For assistant messages that proposed an action, the pending/settled proposal
  // renders INSIDE the bubble (the confirmation card becomes a message variant, 30 §3.1).
  proposal?: {
    intent: ConversationIntent;
    action: unknown;                   // already validated; display-ready
    status: 'pending' | 'confirmed' | 'cancelled' | 'executed' | 'failed';
    resolvedSummary?: string;          // e.g. "Call Rahul · tomorrow 9:00 AM · one-time"
  };
  streaming?: boolean;                 // assistant text still arriving (32 §5)
}
```

A new `useConversation()` hook owns `ChatMessage[]`, append/update, and the streaming
lifecycle — replacing the single `result: ParseResult | null` slot in `ChatScreen`.

### 4.2 Persisted (main, SQLite)

The **already-existing** `conversations` table (`10`, `30` §3.2 — dead schema today) is
adopted as-is; no migration needed for the columns it has:

```sql
-- migration 002, ALREADY PRESENT
conversations(id, user_text, assistant_response, intent, reminder_id, created_at)
```

- One row per completed turn: `user_text`, `assistant_response` (the `reply`), `intent`, and
  `reminder_id` when the turn created a reminder (the existing `ON DELETE SET NULL` FK).
- **What is NOT stored:** the raw model JSON, tool traces, or any secret. Just the human-
  readable turn, so History/PII exposure is bounded and a user can read their own log.
- Retention piggybacks on the sweep `10` already specifies (conversations follow the same
  policy as history; default: keep 365 days — a settings knob, off-limits to the LLM).
- **A future migration (e.g. `004`) may be required** for a `role`-less design refinement only
  if we decide to store multi-message context; the MVP conversation persists one row per turn
  and needs no schema change. (Migration `003` is claimed by memory FTS5 in `37` Phase 6, so a
  conversation-schema change would take the next free number.)

### 4.3 Context window sent to the LLM

```ts
// What the model sees per call (built in MAIN, from validated state only):
{
  system: SYSTEM_PROMPT,               // static; describes Yogi + the closed action set
  now: nowIso, timezone: tz,           // so it can resolve "tomorrow"
  reminders: activeRemindersSummary,   // title + relative time ONLY, no ids, capped at N
  messages: lastK turns (role+text),   // sliding window, K from settings (default 12)
  memories: []                         // v0.3: only NON-sensitive, subject-matched facts
}
```

`MVP DECISION` — sensitive memories (`is_sensitive=1`, i.e. health/family) are **never** put
in the context window (`10`/`24` rule). The reminder summary is titles + relative times, not
rows, so a prompt-injected model cannot exfiltrate ids or timestamps it was never given.

---

## 5. Engine control flow

```text
1. User submits text (typed, or finalised STT transcript).
2. Renderer appends a user ChatMessage; calls window.lifeos.chat.send(text)  (32 §4).
3. MAIN builds the context window (§4.3) from validated state.
4. MAIN calls the active LLM provider (33 §4). Reply streams back token-by-token
   (32 §5) → broadcast on chat:delta → renderer appends to the streaming bubble.
5. On completion MAIN has the full AssistantTurn JSON:
     a. Shape gate:      AssistantTurnSchema.parse()      (reject → generic clarify)
     b. If intent ∈ REPLY_ONLY → persist turn, done. No action, no gate.
     c. If action intent → per-intent action schema.parse()  (09 §5 Gate 1)
        → semantics gate (dates in future, supported RRULE, resolvable ref …) (09 §5 Gate 2)
        → safety scan (09 §5 Gate 3) on all user-visible strings
        → hand the validated action to the Action Dispatcher (36).
6. Dispatcher decides (36 §2): reminders / memory-save / deletions → Confirmation Layer
   (render a proposal in the bubble; wait for Confirm via button or voice) → Execution Layer.
   Safe-settings subset → optimistic-apply + instant Undo (the one carve-out, 36 §4.2).
   Read-only (memory_query, research) → execute, return a follow-up assistant message.
7. Persist the turn to `conversations`. Broadcast any resulting reminders:changed.
```

`MVP DECISION` — Steps 5a–5c run in **main**. The renderer is never trusted to have
validated an action (`11` §8, `16` §4). The renderer only *renders* the proposal and relays
the Confirm click.

`MVP DECISION` — If the LLM call fails at any point (no key, offline, timeout, rejected
JSON), the engine degrades exactly like `09` §6: for a reminder-shaped utterance it falls
back to the **local deterministic parser**; for a pure chat/question it shows a plain
"I couldn't reach the assistant" notice. **The app is never worse than the offline MVP.**

---

## 6. Safety invariants specific to conversation

Restating the invariants a reviewer can grep for, extended from `09` §10 to the wider
action set:

| Invariant | Enforced by |
| --- | --- |
| The LLM cannot create/edit/delete a reminder directly | No path from `AssistantTurn` to `repo.*`. Only the dispatcher's Execution Layer writes, only after the Confirmation Layer resolves. |
| The LLM cannot name a reminder it wasn't shown | It gets a summary without ids and proposes a `reminderRef`; the app resolves it and shows the resolved target before any delete/update. |
| The LLM cannot change a privileged setting | `SettingsAction` is a closed discriminated union of user-safe settings; `ai_key_ciphertext`/consent/provider keys are unreachable. |
| The LLM cannot exfiltrate data | Context window is built in main from a titles-only summary; sensitive memories never included; no ids/timestamps sent. |
| The LLM cannot execute anything | No `eval`/`new Function`/`child_process` anywhere (`11` §7, ESLint-enforced). Every action is data, rendered as text. |
| A schema-valid but wrong action still can't persist silently | Confirmation Layer: reminders, memory, and deletions require a human Confirm (card or voice "yes"); `needsClarification` renders a card with no Confirm button. The one carve-out is the closed *safe-settings* subset — optimistic-apply + instant Undo (`36` §4.2, `30` §13.1). |
| Availability is decided by the app, not the prompt | Disabled capabilities (memory pre-v0.3, research pre-v0.5) are refused in the dispatcher regardless of what the model returns. |

---

## 7. What changes, concretely

- **New:** `core/conversation/` (intent, turn-schema, action-schemas), a main-process
  `ConversationEngine`, IPC `chat:send` + `chat:delta`/`chat:done` (`32` §4), a renderer
  `useConversation` hook, a message-list UI with the confirmation card as a message variant.
- **Refactored:** `core/parsing/types.ts` `Intent` → `ReminderIntent` (module-internal);
  `parseReminder` demoted from router to the reminder executor behind the dispatcher (`30`
  §9.2); `ChatScreen` rewritten around the message list.
- **Reused unchanged:** the confirmation gate, `CreateReminderInput` + business rules (`15`),
  the scheduling math (`rrule`, `next-occurrence`), the ambiguity/clarification catalog as
  guardrails on LLM output, the `conversations` table, the security envelope.
- **Untouched:** the scheduler, notifier, tray, trigger fan-out, reset — the reminder
  *lifecycle* is orthogonal to how a reminder gets *created*.

---

## 8. Scalability check (previewing the §-review in `39`)

- **Long conversations:** bounded by the sliding-window `K` (§4.3); persisted turns are
  read-only history, not replayed. Cost/latency stay flat regardless of total history.
- **Multiple providers / local LLM:** the engine calls an `LlmProvider` interface (`33`
  §4), so OpenAI / Ollama / Anthropic / Gemini are swaps, not rewrites. Streaming is optional
  on the interface (mirrors `supportsPartials` for STT).
- **New capabilities (memory, research, integrations):** each is a new intent + action schema
  + a dispatcher branch; the turn contract does not change. This is the extensibility the
  taxonomy in §2 buys.

The architecture scales for the brief's full list; the detailed argument, including where it
would *not* scale without change, is in `39` §Architecture Review.
