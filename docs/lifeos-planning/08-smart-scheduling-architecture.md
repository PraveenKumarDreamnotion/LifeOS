# 08 — Smart Scheduling Architecture

> The brief calls scheduling *"the highest-priority feature."* It has two halves that are usually conflated and must not be:
>
> 1. **Understanding** — turning `"remind me every Monday at 7 AM to exercise"` into a validated structure.
> 2. **Firing** — making that structure produce a notification at 7:00 AM next Monday, and the Monday after, across reboots, sleeps and DST transitions.
>
> They fail for entirely different reasons. This document treats them separately.

---

# Part I — Understanding

## 1. The pipeline

```text
raw text
   │
   ├─1─► normalize()            lowercase, collapse whitespace, expand "5min"→"5 minutes"
   │
   ├─2─► detectIntent()         allow-list: create_reminder | create_sing_reminder | unknown
   │        └─ unknown → refuse politely. STOP.
   │
   ├─3─► extractRecurrence()    ← chrono CANNOT do this. Custom keyword layer.
   │        └─ returns { rule, strippedText } or { rule: null, strippedText: text }
   │
   ├─4─► chrono.parse(strippedText, refDate, { forwardDate: true })
   │        └─ ParsedResult[] with isCertain() metadata
   │
   ├─5─► extractTitle()         remove the date phrase and the command prefix
   │
   ├─6─► detectAmbiguity()      the heart of the system. Uses isCertain().
   │        └─ ambiguous → ClarificationNeeded. STOP (do not persist, do not guess).
   │
   ├─7─► scoreConfidence()      0..1
   │        └─ < 0.55 AND aiAssist enabled → LLM fallback (09) → re-enter at step 8
   │
   ├─8─► validate()             Zod + business rules (future, non-empty, supported rule)
   │
   └─9─► ParsedReminder → ConfirmationCard → [user presses Confirm] → repository.create()
```

`MVP DECISION` — **Steps 1–8 are pure functions in `core/`.** No Electron, no Node, no I/O. `parseReminder(text, refDate, timezone)` is a deterministic total function. That is what makes it testable (`18-testing-strategy.md`) and portable (`05` §6.2).

## 2. Step 2 — Intent detection

`MVP DECISION` — The intent space is a **closed allow-list**. There is no `else` branch that does something.

```ts
export type Intent = 'create_reminder' | 'create_sing_reminder' | 'unknown';

const SING_PATTERNS = [
  /\bsing\b/i,
  /\bplay\b.*\b(yogi )?song\b/i,
  /\byogi song\b/i,
];

const REMIND_PATTERNS = [
  /\bremind me\b/i,
  /\bremind\b/i,
  /\bdon'?t let me forget\b/i,
  /\bmake sure i\b/i,
  /\bset a reminder\b/i,
  /\bwake me\b/i,
];

export function detectIntent(text: string): Intent {
  if (SING_PATTERNS.some(p => p.test(text)))   return 'create_sing_reminder';
  if (REMIND_PATTERNS.some(p => p.test(text))) return 'create_reminder';
  return 'unknown';
}
```

`MVP DECISION` — `unknown` produces a friendly refusal, never a guess:

> *"I only set reminders right now. Try: **remind me in 10 minutes to drink water**."*

`RISK (low)` — `"please sing after 2 minutes"` matches `sing` before `remind`. That ordering is intentional: sing is the more specific intent. `"remind me to sing"` is a genuine ambiguity the MVP resolves as `create_sing_reminder`; that is acceptable and documented.

## 3. Step 3 — Recurrence extraction (the layer chrono cannot provide)

`VERIFIED FACT` — **chrono-node does not parse recurrence.** Its README states this explicitly. Given `"every Monday at 7 AM"`, it extracts `Monday` and `7 AM` and silently discards `every`. Without this layer, *"remind me every Monday at 7 AM"* becomes a **one-time** reminder next Monday — a silent, plausible, wrong result. This is the highest-severity parser bug available to us.

```ts
const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5,
  saturday: 6, sat: 6, sunday: 7, sun: 7,
};

// "every Monday", "each monday", "every mon"
const WEEKLY_RE  = /\b(?:every|each)\s+(mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\b/i;
// "every day", "daily", "each day"
const DAILY_RE   = /\b(?:every\s*day|each\s*day|daily)\b/i;
// unsupported, but must be DETECTED so we can refuse honestly
const UNSUPPORTED_RE = /\b(?:every|each)\s+(?:month|year|other|\d+\s*(?:days?|weeks?|months?))\b/i;

export interface RecurrenceExtraction {
  kind: 'none' | 'daily' | 'weekly' | 'unsupported';
  weekday?: number;             // 1=Mon .. 7=Sun (ISO, matches Luxon)
  strippedText: string;         // recurrence phrase removed, for chrono
}

export function extractRecurrence(text: string): RecurrenceExtraction {
  if (UNSUPPORTED_RE.test(text)) return { kind: 'unsupported', strippedText: text };

  const weekly = text.match(WEEKLY_RE);
  if (weekly) {
    const key = weekly[1].toLowerCase();
    const weekday = WEEKDAYS[key] ?? WEEKDAYS[key + 'day'];
    // Strip only the "every|each" token. LEAVE the weekday for chrono, so it
    // anchors the time to the right day of week.
    return { kind: 'weekly', weekday, strippedText: text.replace(/\b(?:every|each)\s+/i, '') };
  }

  if (DAILY_RE.test(text)) {
    return { kind: 'daily', strippedText: text.replace(DAILY_RE, 'today') };
  }

  return { kind: 'none', strippedText: text };
}
```

`MVP DECISION` — `kind: 'unsupported'` (`"every month"`, `"every other Tuesday"`, `"every 3 days"`) produces an honest refusal, **not** a silently-degraded one-time reminder:

> *"I can only repeat daily or weekly right now. Would you like a one-time reminder instead?"*

`RISK (medium)` — Stripping `every` but keeping `Monday` relies on chrono resolving a bare weekday to the *next* one. That is exactly what `forwardDate: true` guarantees. **Test this pair together** — the two settings are load-bearing for each other.

## 4. Step 4 — chrono-node

`VERIFIED FACT` — chrono-node **2.9.1** (2026-05-06), actively maintained, 100% TypeScript. Locale sub-imports require `moduleResolution: node16`/`nodeNext`.

```ts
import * as chrono from 'chrono-node';

const results = chrono.parse(strippedText, refDate, { forwardDate: true });
```

`VERIFIED FACT` — **`forwardDate: true` is mandatory.** Without it, parsing `"Friday"` on a Saturday returns **last** Friday — a reminder in the past. Every reminder is, by definition, in the future.

`VERIFIED FACT` — Use `chrono.parse()`, never `chrono.parseDate()`. The latter returns a bare `Date` and throws away the `isCertain()` metadata that the entire ambiguity system depends on.

## 5. Step 6 — Ambiguity detection (the heart)

`VERIFIED FACT` — `ParsedComponents.isCertain(component)` returns `true` **only** when the value came from the user's input (`knownValues`), not when chrono defaulted it (`impliedValues`). Components: `year, month, day, hour, minute, second, meridiem, weekday, timezoneOffset`.

This single API implements the brief's entire §10 table without a regex in sight.

```ts
export type Ambiguity =
  | { kind: 'no_date_at_all' }
  | { kind: 'missing_time'; resolvedDate: DateTime }
  | { kind: 'ambiguous_meridiem'; hour: number }
  | { kind: 'vague_daypart'; daypart: 'morning'|'afternoon'|'evening'|'night'; resolvedDate: DateTime }
  | { kind: 'recurrence_without_time'; weekday: number }
  | { kind: 'unsupported_recurrence' };

export function detectAmbiguity(
  r: chrono.ParsedResult | null,
  rec: RecurrenceExtraction,
  text: string,
): Ambiguity | null {

  if (rec.kind === 'unsupported') return { kind: 'unsupported_recurrence' };

  // "remind me to call Rahul"  /  "remind me later"
  if (!r) return { kind: 'no_date_at_all' };

  const c = r.start;

  // "remind me at 6"  →  6 AM or 6 PM?  NEVER guess.
  if (c.isCertain('hour') && !c.isCertain('meridiem') && c.get('hour')! <= 12) {
    return { kind: 'ambiguous_meridiem', hour: c.get('hour')! };
  }

  // "remind me every Monday"  →  at what time?
  if (rec.kind !== 'none' && !c.isCertain('hour')) {
    return { kind: 'recurrence_without_time', weekday: rec.weekday ?? 0 };
  }

  // "remind me tomorrow morning"  →  propose 9 AM, but ASK.
  const daypart = matchDaypart(text);
  if (daypart && !c.isCertain('hour')) {
    return { kind: 'vague_daypart', daypart, resolvedDate: toLuxon(c) };
  }

  // "remind me Friday"  →  chrono defaulted the hour. Ask.
  if (!c.isCertain('hour')) {
    return { kind: 'missing_time', resolvedDate: toLuxon(c) };
  }

  return null;   // unambiguous
}
```

`MVP DECISION` — **The meridiem check comes first and has no override.** Auto-assigning AM/PM is the fastest way to produce a reminder that is exactly twelve hours wrong, and the user will not notice until the meeting is missed. Chrono ships a refiner *example* that force-assigns PM for hours 1–4; **do not use it.** A question costs three seconds. A missed 6 AM flight does not.

`RISK (medium)` — `"remind me at 18"` and `"at 6 PM"` both set `meridiem` certain (24-hour input, or explicit). Only bare `"at 6"` with `hour ≤ 12` is ambiguous. The `hour ≤ 12` guard matters.

### 5.1 The brief's §10 table, mapped

| User input | `Ambiguity.kind` | Yogi's response |
| --- | --- | --- |
| `remind me Friday` | `missing_time` | "I can set that for Friday, 17 July. What time?" |
| `remind me tomorrow morning` | `vague_daypart` | "You said tomorrow morning. Shall I set it for 9:00 AM?" |
| `remind me at 6` | `ambiguous_meridiem` | "Six in the morning, or six in the evening?" |
| `remind me next Friday` | `missing_time` | "That's Friday, 17 July. What time?" |
| `remind me later` | `no_date_at_all` | "I can set that. When should I remind you?" |
| `remind me after lunch` | `vague_daypart` (afternoon) | "What time after lunch? Around 1:00 PM?" |
| `remind me every Monday` | `recurrence_without_time` | "Every Monday — at what time?" |
| `remind me to call Rahul` | `no_date_at_all` | "I can remind you to call Rahul. When?" |
| `remind me every month on the 1st` | `unsupported_recurrence` | "I can only repeat daily or weekly right now." |

`MVP DECISION` — Answering a clarification **re-runs the full pipeline** with the merged slots. It never jumps straight to persistence. This guarantees one code path to the confirmation card, and therefore one place where the confirmation gate lives.

## 6. Step 7 — Confidence scoring

`ASSUMPTION` — These weights are a starting point, tuned against the fixture corpus in `18-testing-strategy.md` §3, not derived from theory.

```ts
export function scoreConfidence(r: chrono.ParsedResult | null, rec: RecurrenceExtraction, title: string): number {
  let s = 0.5;
  if (!r) return 0.0;

  if (r.start.isCertain('hour'))     s += 0.20;
  if (r.start.isCertain('minute'))   s += 0.05;
  if (r.start.isCertain('day'))      s += 0.10;
  if (r.start.isCertain('meridiem')) s += 0.10;
  if (rec.kind === 'weekly' || rec.kind === 'daily') s += 0.05;

  if (title.trim().length === 0)     s -= 0.40;   // parsed a time but no action
  if (title.trim().length < 3)       s -= 0.20;
  if (r.text.length / (r.text.length + title.length) > 0.8) s -= 0.15; // date ate the sentence

  return Math.max(0, Math.min(1, s));
}
```

| Score | Behaviour |
| --- | --- |
| ≥ 0.80 | Green dot. Confirmation card. |
| 0.55 – 0.80 | Amber dot. Confirmation card, but the **When** row is visually emphasised. |
| < 0.55, AI Assist **off** | Clarification card ("I didn't quite catch when — could you rephrase?") |
| < 0.55, AI Assist **on** | LLM fallback → `09-openai-ai-assist-architecture.md` → **still** produces a confirmation card |
| Any score, `unknown` intent | Polite refusal |

`MVP DECISION` — Confidence never bypasses confirmation. A 0.99 score and a 0.56 score both end at the same button. Confidence only controls *how loudly Yogi hedges*.

## 7. Step 5 — Title extraction

```ts
export function extractTitle(text: string, dateText: string, intent: Intent): string {
  if (intent === 'create_sing_reminder') return 'Play Yogi song';

  let t = text;
  if (dateText) t = t.replace(dateText, ' ');            // remove what chrono consumed
  t = t.replace(/^\s*(?:please\s+)?remind\s+me\s*/i, '') // command prefix
       .replace(/^\s*(?:that\s+)?i\s+(?:need|have)\s+to\s*/i, '')  // "that I need to give medicine"
       .replace(/^\s*(?:to|about|that)\s+/i, '')
       .replace(/\b(?:every|each)\s+\w+day\b/i, '')      // leftover recurrence
       .replace(/\s{2,}/g, ' ')
       .trim()
       .replace(/[.,;:!?]+$/, '');

  return t.charAt(0).toUpperCase() + t.slice(1);
}
```

Worked examples:

| Input | `dateText` | Title |
| --- | --- | --- |
| `remind me in 5 minutes to call my mother` | `in 5 minutes` | `Call my mother` |
| `remind me after 10 minutes that I need to give medicine to my grandfather` | `after 10 minutes` | `Give medicine to my grandfather` |
| `remind me every Monday at 7 AM to exercise` | `Monday at 7 AM` | `Exercise` |
| `please sing after 2 minutes` | `after 2 minutes` | `Play Yogi song` |

`RISK (medium)` — Title extraction is the flakiest step. It is also the **least dangerous to get wrong**, because the user sees and can edit the title on the confirmation card. `MVP DECISION` — an empty title after extraction is *not* an error; it is `no_date_at_all`'s sibling: ask *"What should I remind you about?"*

## 8. The output contract

```ts
export type ParseResult =
  | { ok: true;  reminder: ParsedReminder }
  | { ok: false; clarification: Clarification }
  | { ok: false; refusal: { reason: 'unknown_intent' | 'unsupported_recurrence'; message: string } };

export interface ParsedReminder {
  intent: Exclude<Intent, 'unknown'>;
  title: string;
  description: string | null;
  scheduledAt: string;        // ISO 8601 with offset, e.g. "2026-07-11T09:00:00+05:30"
  scheduledAtUtcMs: number;   // the value actually stored and compared
  timezone: string;           // IANA, e.g. "Asia/Kolkata"
  recurrenceRule: string | null;  // "FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0"
  actionType: 'notify' | 'sing';
  confidence: number;
  source: 'local' | 'llm';
}

export interface Clarification {
  ambiguity: Ambiguity;
  question: string;            // spoken verbatim by Yogi
  suggestions: TimeSuggestion[];
  partial: Partial<ParsedReminder>;   // merge the answer into this and re-parse
}
```

---

# Part II — Firing

## 9. Why the obvious design is wrong

The brief's §15 says: *"Calculate the nearest upcoming reminder. Create a timer for the nearest reminder."*

`VERIFIED FACT` — `setTimeout`'s delay is coerced to a **signed 32-bit integer**: max **2,147,483,647 ms ≈ 24.8 days**. Exceeding it sets the delay to **1**, so the callback **fires almost immediately**. (MDN; Node timers docs)

> *"Remind me on 25 December to buy gifts"* → `setTimeout(fire, 14_500_000_000)` → **fires now.**

`VERIFIED FACT` — During Windows sleep, a timer's clock **pauses**. On resume it fires at `originalDelay + timeAsleep`, not at the intended wall-clock moment. (nodejs/node#6763)

`RISK (high)` — Timers have been reported to **never fire at all** across some sleep/wake cycles. (nodejs/node#13168, #38108)

Three independent ways to silently miss a reminder. A reminders app that misses reminders has no reason to exist.

## 10. The design: wall-clock authoritative

> **The persisted `next_fire_at` column is the only source of truth. Timers are an optimisation and never a contract.**

```ts
// electron/scheduler/scheduler.ts  — MAIN PROCESS ONLY
const TICK_MS = 30_000;

export function startScheduler() {
  app.whenReady().then(() => reconcile('startup'));   // catch-up for time app was closed
  setInterval(() => reconcile('tick'), TICK_MS);      // self-healing backstop
  powerMonitor.on('resume',        () => reconcile('resume'));
  powerMonitor.on('unlock-screen', () => reconcile('unlock'));
  nativeTheme;                                        // (unrelated; listed to show main-process context)
}

function reconcile(cause: ReconcileCause) {
  if (settings.get('reminders_paused') === 'true') return;

  const now = Date.now();
  const due = repo.findDue(now);      // WHERE next_fire_at <= ? AND status = 'pending'

  for (const r of due) {
    const lateBy = now - r.next_fire_at;
    const missedWhileClosed = cause === 'startup' && lateBy > TICK_MS * 2;

    if (missedWhileClosed && !r.recurrence_rule) {
      repo.markMissed(r.id, now);                     // one-time: honest, not a fake alarm
    } else {
      fire(r);                                        // notify + speak + play
      history.record(r.id, now, 'triggered');
    }

    if (r.recurrence_rule) {
      repo.setNextFireAt(r.id, nextOccurrenceAfter(r, now));   // recompute PAST now
    } else if (!missedWhileClosed) {
      repo.markTriggered(r.id, now);
    }
  }

  if (cause === 'startup' && due.length) surfaceOverdueCatchupModal(due);
}
```

`VERIFIED FACT` — Electron's `powerMonitor` emits `suspend`, `resume`, `lock-screen`, `unlock-screen`, all supported on Windows. (https://www.electronjs.org/docs/api/power-monitor)

`MVP DECISION` — Worst-case lateness is one tick (**≤ 30 s**), satisfying NFR-3. This is invisible for human reminders and is documented in `23-known-limitations.md`.

`FUTURE OPTION` — For second-accuracy, layer a short `setTimeout` aimed at *only* the single imminent reminder when it is under `TICK_MS` away. The interval tick remains the backstop. Do not schedule a timer per reminder; do not schedule a timer more than 24 days out.

## 11. Overdue policy

The brief asks to *"handle overdue reminders after app restart."* The honest answer differs by type:

| Case | Policy | Why |
| --- | --- | --- |
| One-time, missed while app was **closed** | Mark `missed`. Show in the catch-up modal. **Do not fire.** | A 9 AM reminder announced at 6 PM is noise pretending to be a reminder. |
| One-time, missed while app was **running** (tick lag, sleep) | **Fire.** Late is fine; it's still today's intent. | The user expected the app to be watching. It was. |
| Recurring, missed one or more occurrences | **Do not fire the past ones.** Roll `next_fire_at` forward to the next future occurrence. Note it in the catch-up modal. | Firing four missed "Exercise" alarms at once is hostile. |
| Recurring, `next_fire_at` in the past by < 2 ticks | Fire once, then roll forward. | Normal lateness. |

`MVP DECISION` — "missed while closed" is detected as `cause === 'startup' && lateBy > 2 * TICK_MS`. The catch-up modal (`12` §10.2) is where the app is honest about its central limitation, rather than hiding it.

## 12. Recurrence: next-occurrence computation

`VERIFIED FACT` — `rrule` npm is **2.8.1, ~2023, no release in 12+ months**, and setting `tzid` **breaks `after()`/`all()`** on versions after 2.7.2 (jkbrzt/rrule#608). It returns floating zero-offset dates, and **Chrome returns offset dates while other engines return zero-offset** — so it behaves differently in Electron's renderer than in its main process.

`MVP DECISION` — **Store the RRULE string. Do not take the library.**

```ts
import { DateTime } from 'luxon';

export function nextOccurrenceAfter(r: ReminderRow, afterMs: number): number {
  const rule = parseRule(r.recurrence_rule!);   // our own tiny parser; MVP supports 2 shapes
  const from = DateTime.fromMillis(afterMs, { zone: r.timezone });

  if (rule.freq === 'DAILY') {
    let d = from.set({ hour: rule.hour, minute: rule.minute, second: 0, millisecond: 0 });
    if (d <= from) d = d.plus({ days: 1 });
    return d.toMillis();
  }

  if (rule.freq === 'WEEKLY') {
    let d = from.set({ weekday: rule.weekday, hour: rule.hour, minute: rule.minute, second: 0, millisecond: 0 });
    if (d <= from) d = d.plus({ weeks: 1 });
    return d.toMillis();
  }

  throw new UnsupportedRecurrenceError(r.recurrence_rule!);
}
```

Luxon's zone arithmetic is DST-correct: `plus({ weeks: 1 })` on a `ZonedDateTime` crossing a DST boundary yields the same *wall-clock* time, which is what *"every Monday at 7 AM"* means to a human.

### 12.1 Rule shapes supported in the MVP

```text
FREQ=DAILY;BYHOUR=7;BYMINUTE=0
FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0
```

`MVP DECISION` — `parseRule()` accepts exactly these two shapes and **throws on anything else**. It does not attempt to be an RFC-5545 parser. A row with an unparseable rule is quarantined: `status='error'`, surfaced in Active Schedules as *"This reminder needs attention"*, never silently dropped.

`FUTURE OPTION` — Swap `parseRule` + `nextOccurrenceAfter` for **`rrule-temporal`** (RFC-5545 + RFC-7529, Temporal-based, DST-correct by construction) when monthly, interval, COUNT or EXDATE support is needed. The stored strings are already valid RRULEs, so **no data migration is required.** That is the entire reason for storing the string rather than three columns.

## 13. Timezones

`MVP DECISION`

| Reminder kind | Stored as | Rationale |
| --- | --- | --- |
| One-time | `next_fire_at` = **absolute UTC epoch ms** | An instant is an instant. Travel and DST cannot move it. |
| Recurring | `recurrence_rule` + `timezone` (IANA), `next_fire_at` = derived cache | *"Every Monday at 7 AM"* means 7 AM **wherever you are**, or rather, in the zone you set it in. |

`RISK (medium)` — If the user creates *"every Monday at 7 AM"* in `Asia/Kolkata` and then flies to `America/New_York`, the reminder fires at 7 AM **Kolkata time** (= 9:30 PM New York). This is arguably correct (the rule was authored in a zone) and arguably surprising.

`MVP DECISION` — Accept the behaviour, store the zone so it is *explainable*, and display the zone in the Active Schedules row when it differs from the current system zone:

```text
🔁  Every Monday at 7:00 AM  (Asia/Kolkata)
    Exercise
    Next run: Monday, 13 July, 9:30 PM your time
```

`FUTURE OPTION` — A setting: *"When I travel, recurring reminders should follow (·) the zone I created them in  ( ) my current zone."*

`RISK (low)` — A DST transition can make a wall-clock time **not exist** (spring forward) or **occur twice** (fall back). Luxon resolves non-existent times forward and ambiguous times to the first occurrence. `MVP DECISION` — accept Luxon's defaults; add a unit test for both cases (`18` §3) so the behaviour is pinned rather than accidental. India has no DST, so this will not bite the primary user — which is exactly why it needs a test rather than a manual check.

## 14. Clock changes and adversarial time

`RISK (low)` — If the user moves the system clock backwards, `next_fire_at <= now` stops being true and the reminder silently waits. If they move it forward, everything fires at once.

`MVP DECISION` — Do not attempt to defend against clock manipulation; it is the user's own machine and the failure mode is self-inflicted. **Do** guard the pathological case: cap the number of reminders fired in a single reconcile at **20**, log a warning, and surface *"Your system clock changed — 47 reminders became due at once."* This prevents a notification storm.

## 15. The scheduler's contract with the rest of the app

```text
┌──────────────── MAIN PROCESS (Node event loop, never throttled) ──────────┐
│                                                                          │
│  setInterval(30s) ──┐                                                    │
│  powerMonitor       ├──► reconcile() ──► repo.findDue(now)               │
│  app.whenReady()  ──┘         │                                          │
│                               ├──► new Notification().show()   [always]   │
│                               ├──► audioWindow.send('tts:speak')  [best-effort]
│                               ├──► audioWindow.send('audio:play') [best-effort, sing]
│                               ├──► mainWindow?.send('reminder:trigger')   [if exists]
│                               └──► history.record(...)          [always]  │
└──────────────────────────────────────────────────────────────────────────┘
```

Read the annotations. The **notification and the history record are unconditional.** Speech and audio are best-effort and may fail without failing the reminder. The in-app modal requires a window that may not exist. Reliability decreases left to right, and nothing to the right can break anything to its left.

`MVP DECISION` — The scheduler **never** touches the renderer's state directly, and the renderer **never** schedules anything. The renderer's only scheduling-adjacent job is rendering a countdown, which it does from `next_fire_at` with a single shared 1-second ticker (`12` §6).

## 16. Testing the scheduler

Deterministic time is non-negotiable. See `18-testing-strategy.md` §4.

```ts
// The scheduler takes its clock as a dependency. Never calls Date.now() directly.
export function createScheduler(deps: { now: () => number; repo: ReminderRepo; sink: TriggerSink }) { … }

// Test: the 24.8-day trap
it('does not fire a reminder 30 days out', () => {
  const now = 1_752_000_000_000;
  const s = createScheduler({ now: () => now, repo: repoWith([reminderAt(now + 30 * DAY)]), sink });
  s.reconcile('tick');
  expect(sink.fired).toEqual([]);          // the setTimeout bug would have fired it
});

// Test: DST spring-forward, 2:30 AM does not exist
it('rolls a weekly 2:30 AM reminder forward across spring-forward', () => { … });

// Test: recurring missed while closed rolls forward, does not fire 4 times
it('collapses 4 missed weekly occurrences into 0 fires and 1 roll-forward', () => { … });
```

## 17. What the user sees

The brief is firm: **never say "cron" in the UI.** Internally the recurrence is an RRULE; externally it is English.

```ts
export function rruleToHuman(rule: string | null, tz: string): string {
  if (!rule) return 'Does not repeat';
  const r = parseRule(rule);
  const time = DateTime.fromObject({ hour: r.hour, minute: r.minute }, { zone: tz }).toFormat('h:mm a');
  if (r.freq === 'DAILY')  return `Every day at ${time}`;
  if (r.freq === 'WEEKLY') return `Every ${WEEKDAY_NAMES[r.weekday]} at ${time}`;
  return 'Custom schedule';
}
```

| Stored | Displayed |
| --- | --- |
| `FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0` | `Every Monday at 7:00 AM` |
| `FREQ=DAILY;BYHOUR=22;BYMINUTE=30` | `Every day at 10:30 PM` |
| `null`, `next_fire_at` tomorrow 09:00 | `Tomorrow at 9:00 AM` |
| `null`, `next_fire_at` in 118 s | `In 2 minutes` |

And the screen is called **Active Schedules**.
