# 15 — Data Models and Schemas

> Three representations of the same thing, deliberately kept distinct:
> **Row** (what SQLite stores) → **Domain** (what `core/` reasons about) → **DTO** (what crosses IPC).
> Conflating them is how `Date` objects end up in `postMessage` and `undefined` ends up in a `NOT NULL` column.

---

## 1. The domain model

```ts
// core/types/reminder.ts
export type ActionType = 'notify' | 'sing';
export type ReminderStatus =
  | 'pending' | 'triggered' | 'completed' | 'dismissed'
  | 'cancelled' | 'missed' | 'error';
export type ReminderSource = 'local' | 'llm' | 'manual';

export interface Reminder {
  id: string;                     // uuid v4
  title: string;
  description: string | null;

  /** What the user originally asked for. Never changes after creation. UTC epoch ms. */
  scheduledAt: number;
  /** What the scheduler compares against Date.now(). Rolls forward on recurrence. UTC epoch ms. */
  nextFireAt: number;

  timezone: string;               // IANA, e.g. 'Asia/Kolkata'
  recurrenceRule: string | null;  // 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0'
  actionType: ActionType;
  status: ReminderStatus;
  source: ReminderSource;
  isPaused: boolean;

  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  lastTriggeredAt: number | null;
}
```

### Why `scheduledAt` and `nextFireAt` are both present

This is the most important modelling decision in the app and the easiest to get wrong.

```text
User: "remind me every Monday at 7 AM to exercise"     [created Fri 10 July]

  scheduledAt  = Mon 13 July 07:00   ← the user's original intent. FROZEN.
  nextFireAt   = Mon 13 July 07:00

  ...Monday arrives, reminder fires...

  scheduledAt  = Mon 13 July 07:00   ← still frozen. "You created this for the 13th."
  nextFireAt   = Mon 20 July 07:00   ← rolled forward. The scheduler reads THIS.
```

Collapse them into one column and you must choose between losing the original intent or corrupting the schedule. `MVP DECISION` — keep both. `nextFireAt` is the only column the scheduler queries; `scheduledAt` is provenance.

### Why times are `number` (epoch ms), not `Date` or ISO string

| | `Date` | ISO string | **epoch ms** |
| --- | --- | --- | --- |
| Survives `structuredClone` over IPC | ✅ | ✅ | ✅ |
| Survives JSON round-trip | ❌ becomes a string | ✅ | ✅ |
| Integer-indexed comparison in SQL | ❌ | ⚠️ lexicographic, offset-dependent | ✅ |
| Unambiguous instant | ✅ | ⚠️ only with offset | ✅ |
| Timezone-carrying | ❌ | ⚠️ offset ≠ zone | ❌ (stored separately) |

`MVP DECISION` — **epoch ms + a separate IANA `timezone` column.** An offset (`+05:30`) is not a timezone; it cannot tell you what `+05:30` will be after a DST change. `Asia/Kolkata` can.

`MVP DECISION` — `Date` objects **never cross IPC** and never appear in a DTO. They are created at the edges, by Luxon, for rendering.

## 2. Row types (the SQLite shape)

```ts
// electron/database/rows.ts — never leaves the main process
export interface ReminderRow {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: number;
  next_fire_at: number;
  timezone: string;
  recurrence_rule: string | null;
  action_type: string;
  status: string;
  source: string;
  is_paused: 0 | 1;              // SQLite has no boolean
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  last_triggered_at: number | null;
}

export function toDomain(r: ReminderRow): Reminder {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    scheduledAt: r.scheduled_at,
    nextFireAt: r.next_fire_at,
    timezone: r.timezone,
    recurrenceRule: r.recurrence_rule,
    actionType: r.action_type as ActionType,
    status: r.status as ReminderStatus,
    source: r.source as ReminderSource,
    isPaused: r.is_paused === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    lastTriggeredAt: r.last_triggered_at,
  };
}
```

`RISK (low)` — The `as ActionType` casts are the one place types are asserted rather than proven. They are safe because the `CHECK` constraints in migration 001 make any other value impossible to store. `MVP DECISION` — an integration test writes a bad value with raw SQL and asserts SQLite rejects it, which is what licenses the cast.

## 3. DTOs (the IPC shape)

`MVP DECISION` — DTOs are **structurally identical to the domain model** for reminders, because the domain model is already a plain serialisable object. That is not an accident; it is why the domain model was designed with `number` timestamps.

The exception is settings, where the DTO is deliberately **narrower** than the row:

```ts
// core/types/settings.ts
export interface SettingsDto {
  onboardingCompleted: boolean;
  trayNoticeShown: boolean;
  remindersPaused: boolean;
  theme: 'system' | 'light' | 'dark';

  ttsEnabled: boolean;
  ttsVoiceId: string;
  ttsRate: number;
  ttsDegraded: boolean;

  sttProvider: string;
  notificationSound: boolean;
  snoozeMinutes: number;
  tickIntervalMs: number;
  closeAction: 'tray' | 'quit';

  aiAssistEnabled: boolean;
  aiProvider: 'openai';
  aiModel: string;
  aiOnlyWhenUncertain: boolean;
  aiConsentAcceptedAt: number | null;
  aiLastUsedAt: number | null;

  /** ◄── The API key NEVER crosses IPC. Only its existence does. */
  hasApiKey: boolean;
}
```

`MVP DECISION` — There is no `apiKey` field on any type that the renderer can name. The absence is enforced by a test (`16` §6) and by the type system: `SettingsDto` is what `settings:get` returns, and it has no such property.

## 4. Zod schemas — the IPC boundary

`MVP DECISION` — Every IPC payload is `unknown` until Zod says otherwise. TypeScript types do not survive `structuredClone`; only runtime validation does.

```ts
// core/types/ipc.ts
import { z } from 'zod';

const ISO_ZONE = z.string().refine(z => DateTime.local().setZone(z).isValid, 'unknown timezone');

/** The two rule shapes the MVP supports. Anything else is a rejection. */
export const SUPPORTED_RRULE = z.string().regex(
  /^FREQ=(?:DAILY;BYHOUR=(?:[01]?\d|2[0-3]);BYMINUTE=(?:[0-5]?\d)|WEEKLY;BYDAY=(?:MO|TU|WE|TH|FR|SA|SU);BYHOUR=(?:[01]?\d|2[0-3]);BYMINUTE=(?:[0-5]?\d))$/,
  'unsupported recurrence rule',
);

export const CreateReminderInput = z.object({
  title:            z.string().trim().min(1, 'Give the reminder a name').max(200),
  description:      z.string().trim().max(1000).nullable().default(null),
  scheduledAtUtcMs: z.number().int().positive(),
  timezone:         ISO_ZONE,
  recurrenceRule:   SUPPORTED_RRULE.nullable().default(null),
  actionType:       z.enum(['notify', 'sing']),
  source:           z.enum(['local', 'llm', 'manual']),
}).strict();                       // ◄── unknown keys are a REJECTION

export const UpdateReminderInput = CreateReminderInput
  .partial()
  .extend({ id: z.string().uuid() })
  .strict();

export const SnoozeInput = z.object({
  id: z.string().uuid(),
  minutes: z.number().int().min(1).max(1440),
}).strict();

export type CreateReminderInput = z.infer<typeof CreateReminderInput>;
```

`MVP DECISION` — `.strict()` on every input schema. If a compromised renderer sends `{ ...valid, actionType: 'notify', __proto__: {...} }` or an extra `action: 'exec'`, the parse **throws** rather than silently dropping the key. Silently dropping is how a future refactor that starts reading that key becomes a vulnerability.

### Business rules Zod cannot express

These run **after** `.parse()`, in the handler:

```ts
// electron/main/ipc/reminders.ts
function validateBusinessRules(input: CreateReminderInput, now: number): void {
  if (input.scheduledAtUtcMs <= now)
    throw new ValidationError('date_in_past', 'That time has already passed.');

  if (input.scheduledAtUtcMs > now + TWO_YEARS_MS)
    throw new ValidationError('date_too_far', "I can't schedule more than two years out.");

  if (input.actionType === 'sing' && input.recurrenceRule)
    throw new ValidationError('sing_not_recurring', 'The Yogi song is a one-time thing.');

  if (input.recurrenceRule) parseRule(input.recurrenceRule);   // throws on unsupported shape
}
```

`RISK (medium)` — `scheduledAtUtcMs <= now` at the *handler* means a user who stares at the confirmation card for 90 seconds before pressing Confirm on an "in 60 seconds" reminder gets an error. `MVP DECISION` — allow a 5-second grace: `<= now - 5_000`. Anything more recent than that fires on the next tick anyway.

## 5. The parse pipeline's types

```ts
// core/parsing/types.ts
export type Intent = 'create_reminder' | 'create_sing_reminder' | 'unknown';

export type ParseResult =
  | { ok: true;  reminder: ParsedReminder }
  | { ok: false; kind: 'clarification'; clarification: Clarification }
  | { ok: false; kind: 'refusal'; refusal: Refusal };

export interface ParsedReminder {
  intent: Exclude<Intent, 'unknown'>;
  title: string;
  description: string | null;
  scheduledAtUtcMs: number;
  scheduledAtIso: string;        // for display and for the LLM contract
  timezone: string;
  recurrenceRule: string | null;
  actionType: ActionType;
  confidence: number;            // [0, 1]
  source: 'local' | 'llm';
  /** Verbatim, for the confirmation card's transparency. */
  matchedDateText: string;
}

export type Ambiguity =
  | { kind: 'no_date_at_all' }
  | { kind: 'missing_time';            resolvedDateUtcMs: number }
  | { kind: 'ambiguous_meridiem';      hour: number }
  | { kind: 'vague_daypart';           daypart: Daypart; resolvedDateUtcMs: number }
  | { kind: 'recurrence_without_time'; weekday: number }
  | { kind: 'unsupported_recurrence' }
  | { kind: 'missing_title' };

export interface Clarification {
  ambiguity: Ambiguity;
  /** Spoken verbatim by Yogi and rendered verbatim on the card. */
  question: string;
  suggestions: TimeSuggestion[];
  /** Merge the user's answer into this and re-enter the pipeline. Never persisted. */
  partial: Partial<ParsedReminder>;
}

export interface TimeSuggestion { label: string; hour: number; minute: number; isPreselected: boolean; }

export interface Refusal {
  reason: 'unknown_intent' | 'unsupported_recurrence';
  message: string;
  examples: string[];            // the quick-command chips to re-offer
}
```

`MVP DECISION` — `ParseResult` is a **discriminated union with no `null` and no thrown exception** for the normal cases. Ambiguity and refusal are *results*, not errors. Only a genuine bug throws. This means the confirmation-gate invariant is checkable by reading a type: **only the `ok: true` branch carries a `ParsedReminder`, and only a `ParsedReminder` can become a `CreateReminderInput`.**

```ts
// The only bridge from "understood" to "persistable". There is no other.
export function toCreateInput(p: ParsedReminder): CreateReminderInput { … }
```

Grep for `toCreateInput` and you find every path to persistence. There are two: the Confirm button, and the Edit form's Save. Neither is reachable from a `Clarification` or a `Refusal`.

## 6. The LLM response schema

Fully specified in `09` §5. Restated here as the contract:

```ts
// core/ai/llm-response-schema.ts
export const LlmReminderSchema = z.object({
  intent:                z.enum(['create_reminder', 'create_sing_reminder', 'unknown']),
  title:                 z.string().trim().min(1).max(200),
  description:           z.string().trim().max(1000).nullable(),
  scheduledAt:           z.string().datetime({ offset: true }),
  timezone:              ISO_ZONE,
  recurrenceRule:        SUPPORTED_RRULE.nullable(),
  confidence:            z.number().min(0).max(1),
  needsClarification:    z.boolean(),
  clarificationQuestion: z.string().max(300).nullable(),
  assistantResponse:     z.string().max(500),
}).strict();
```

`MVP DECISION` — This schema is reused verbatim as the OpenAI `json_schema` in the Structured Outputs request **and** as the local validator. One definition, two enforcement points. The model is constrained at decode time *and* we still validate, because a schema-valid object can carry a past date, an unsupported rule, or a shell command in the title.

## 7. History

```ts
export type HistoryAction = 'triggered' | 'dismissed' | 'completed' | 'snoozed' | 'missed' | 'failed';

export interface ReminderHistoryEntry {
  id: string;
  reminderId: string;
  /** Denormalised. History must not change when a reminder's title is edited. */
  titleAtTime: string;
  triggeredAt: number;
  actionTaken: HistoryAction;
  dismissedAt: number | null;
  completedAt: number | null;
  snoozedTo: number | null;
}
```

`MVP DECISION` — `titleAtTime` is copied at write time. Editing *"Exercise"* to *"Morning run"* must not retroactively rewrite six months of history to claim you went running. History is a log, not a view.

`MVP DECISION` — `ON DELETE CASCADE` on `reminder_id`. Deleting a reminder deletes its history. `RISK (low, accepted)` — a user might want to keep the record of a deleted reminder. The alternative (orphaned history rows referencing a nonexistent reminder) is worse for an MVP, and Clear History exists.

## 8. Memory (schema only, no feature)

```ts
// core/types/memory.ts — defined, never constructed in the MVP
export type MemoryCategory = 'health' | 'family' | 'preference' | 'other';

export interface Memory {
  id: string;
  subject: string;                    // 'grandfather'
  fact: string;                       // 'Has diabetes'
  category: MemoryCategory;
  confidence: number;
  source: 'user_confirmed' | 'inferred';   // 'inferred' is currently unreachable
  isSensitive: boolean;
  createdAt: number;
  updatedAt: number;
}
```

`MVP DECISION (forward-binding)` — `isSensitive` is **derived, not chosen**: `category === 'health' || category === 'family'` ⇒ `true`. A sensitive memory is never sent to any AI provider, is redacted from logs, and appears in a Manage Memories screen with a per-row delete. This constraint is written down now, while it is free, rather than in v0.3 when a feature deadline is arguing against it.

## 9. Errors

```ts
// core/types/errors.ts
export class ValidationError extends Error {
  constructor(public readonly code: ValidationCode, public readonly userMessage: string) { super(code); }
}

export type ValidationCode =
  | 'empty_title' | 'date_in_past' | 'date_too_far' | 'invalid_date'
  | 'unsupported_recurrence' | 'unsupported_intent' | 'unsafe_content'
  | 'sing_not_recurring' | 'clarification_without_question';

export class SecurityError extends Error {}        // bad origin, no frame
export class UnsafeResetPathError extends Error {}
export class DatabaseFromNewerVersionError extends Error {}
export class ConsentRequiredError extends Error {}
export class EncryptionUnavailableError extends Error {}
```

`MVP DECISION` — Errors crossing IPC are **sanitised to `{ code, message }`.** A stack trace tells a compromised renderer the app's filesystem layout. The full error stays in `app_logs`.

```ts
function toIpcError(e: unknown): { code: string; message: string } {
  if (e instanceof ValidationError) return { code: e.code, message: e.userMessage };
  if (e instanceof z.ZodError)      return { code: 'invalid_input', message: 'That input was not valid.' };
  log.error('ipc', String(e));
  return { code: 'internal_error', message: 'Something went wrong.' };
}
```

`MVP DECISION` — Every `ValidationCode` maps to a user-facing sentence in `17-error-handling-and-edge-cases.md` §2. A code with no sentence is an incomplete error.

## 10. Type-flow summary

```text
  SQLite                main process                    IPC                  renderer
 ────────              ──────────────                  ─────                ──────────
ReminderRow ──toDomain──►  Reminder  ─────structuredClone─────►  Reminder
                              ▲                                     │
                              │                                     │ user edits, presses Confirm
                              │                                     ▼
                          repo.create ◄──Zod.parse──── unknown ◄── CreateReminderInput
                                         .strict()

  ParsedReminder ──toCreateInput──► CreateReminderInput
       ▲
       │ only from ParseResult{ok:true}
       │
  parseReminder(text)  ──or──  LlmReminderSchema.parse(unknown) + 4 gates
```

Read the diagram for the invariant: **nothing reaches `repo.create` without passing through `Zod.parse().strict()` in the main process, and nothing becomes a `CreateReminderInput` without first being a `ParsedReminder` the user saw and confirmed.**
