# 50 — Execution Phase EP-9: Memory Foundation

> **Ships:** v0.8 (`41` §7). **Cloud posture:** opt-in; **memory is never sent** to any
> provider and **sensitive facts are structurally excluded** from every outbound body.
> **Depends on:** EP-6 (Action Dispatcher, `36`/`47`) for the `memory_save`/`memory_query`
> dispatcher branches; **extends EP-5 backward** by filling the empty `memories: []` slot the
> LLM context window shipped since EP-5 (`31` §4.3, an *additive* change — not an EP-5 rewrite,
> `41` §6).
>
> **Authority:** `41` (build sequence). This doc owns the EP-9 phase checklist (`41` §11).
> **Governing constraints (decided while free):** `10` §8 and `24` v0.3 — the five
> non-negotiables reproduced verbatim in §"Why this phase exists".

---

## Objective

Turn the **dead `memories` schema** (migration 002, DDL-only — confirmed dead in `30` §3.2 /
§12) into a working, opt-in personal-memory capability that obeys the confirmation gate:

- Adopt the existing `memories` table as-is; add **migration 003 = an FTS5 virtual table +
  sync triggers** for retrieval (`24` v0.3: *"SQLite FTS5 … Start here"*).
- Light up the `memory_save` (data-modifying → confirmation gate) and `memory_query`
  (read-only → execute + reply) intents that `31`/`36` already defined and EP-6 already routes.
- Ship the **"What do you remember about me?" screen BEFORE any save path exists** (`10` §8.4,
  `24` v0.3 constraint 2 — read your profile before the app builds one).
- Fill the `memories: []` slot in the context window with **only non-sensitive, subject-matched
  facts** (`31` §4.3).
- Gate everything behind `memory_enabled` (default off ⇒ memory intents refused in the
  dispatcher, `31` §2 / `41` §10).

`MVP DECISION` — `source='user_confirmed'` is the **only** value ever written. `is_sensitive`
is **derived, not chosen**: `category ∈ {health, family} ⇒ 1` (`10` §8.3, `24` v0.3 constraint
4). Retrieval is **FTS5-first**; embeddings are a `FUTURE OPTION` reachable only on a
demonstrated FTS5 failure *with the failing query as evidence* (`24` v0.3).

---

## Why this phase exists

The schema was shipped in the MVP precisely so this phase would need **no migration on a live
user's reminders table** — only additive DDL (`10` §8: *"Ship migration 002 … Build no UI, no
extraction, no recall. Empty tables cost nothing; a schema migration on a user's live database
in v0.3 costs trust."*). EP-9 spends that saved trust exactly once, additively.

The five constraints, decided now while they are free (`10` §8.4, `24` v0.3), are the reason
memory is safe to build at all:

1. **Same confirmation gate as reminders.** Yogi never stores an inferred fact without asking.
2. **The "What do you remember about me?" screen ships _before_ any "remember this" feature.**
3. Every recall shows the **verbatim source utterance** + its date (a mis-transcribed medical
   fact recalled confidently months later is real harm; STT of casual speech is the least
   reliable channel this app has — `10` §8 `RISK (high, product)`).
4. `is_sensitive` is **derived** (`health`/`family` ⇒ sensitive); sensitive facts are **never
   sent to any AI provider**, and **redacted from logs**.
5. **Per-row delete, always visible.**

This is also the first backward-extension point `41` §6 flagged: EP-5 shipped the empty
`memories: []` slot; EP-9 *fills* it without changing the turn contract (`31` §8 — "new
capabilities = new intent + dispatcher branch; the turn contract does not change").

---

## Current code that will be reused

| Reused as-is | Why |
| --- | --- |
| `memories` table DDL (`electron/database/migrations.ts` `M002_MEMORY`) | Already has `subject, fact, category, confidence, source, is_sensitive, created_at, updated_at` + the `CHECK (source IN …)` / `CHECK (is_sensitive IN (0,1))` constraints. Adopt unchanged; add only the FTS5 companion. |
| `idx_memories_subject ON memories(subject, category)` | The subject/category lookup index; retained for exact-subject fallback when FTS5 is unavailable. |
| `SqliteDriver` seam + `d.transaction()` migration runner (`10` §4, `migrations.ts` `MIGRATIONS[]`) | Migration 003 appends one entry; `user_version` 2 → 3. Forward-only, transactional rollback already proven (`30` §2.5). |
| The Action Dispatcher + Confirmation/Execution layers (`36`, EP-6) | `memory_save` is already `isPreConfirm` (`36` §2); `memory_query` is already read-only. `execute.ts` already sketches `memoryRepo.create({…, source:'user_confirmed'})` and `memoryRepo.findBySubject(a.subject)` (`36` §5). |
| `MemorySaveAction` / `MemoryQueryAction` Zod schemas (`31` §3) | Shape+semantics gates already defined; EP-9 only wires the executor + repo behind them. |
| The pending-proposal invariant (`36` §4.3) | `memory_save` confirmation reuses the same stored-proposal / `action:confirm(turnId)` machinery as reminders — no new confirm IPC. |
| `SettingsRepository` typed accessors + `getAllSafe()` strip pattern (`settings-repository.ts`) | `memory_enabled` is a new key added to `SETTING_DEFAULTS`; consent + flag read in main exactly like `ai_assist_enabled`. |
| The context-window builder (`31` §4.3, built in main since EP-5) | The `memories: []` slot already exists; EP-9 populates it from a **non-sensitive, subject-matched** query. |
| Reset Local Data (`electron/services/reset-service.ts`) | Deletes the whole `%APPDATA%\LifeOS\` dir — memories included, for free (`10` §8.3). No change. |

---

## Code that must be refactored

| Refactor | Where | Note |
| --- | --- | --- |
| `MIGRATIONS[]` gains a third entry | `electron/database/migrations.ts` | Append `M003_MEMORY_FTS`; **do not** alter `M001`/`M002` (forward-only, `10` §4). |
| `execute.ts` memory branches go from sketch (`36` §5, `// v0.3`) to real calls | `electron/actions/execute.ts` | Wire `MemoryRepository.create` / `.search` behind the already-present `case 'memory_save'` / `case 'memory_query'`. |
| `requireCapabilityEnabled('memory_*')` | `electron/actions/dispatcher.ts` | Read `memory_enabled`; off ⇒ friendly refusal (`31` §2, `36` §7 "Disabled capabilities cannot run"). |
| Context-window build: fill `memories: []` | `electron/conversation/context-builder.ts` (EP-5) | Query **non-sensitive** rows subject-matched to the turn; **never** include `is_sensitive=1` rows. Additive; the field already exists. |
| Logger redaction gains a memory-fact rule | `electron/logging/logger.ts` (redaction pass, `30` §6) | Sensitive facts (and, to be safe, all `fact` text) redacted before write. |
| `SettingsDto` typed accessor for `memory_enabled` | `core/types` + `settings-repository.ts` | Reuses the EP-1 typed-accessor mechanism (`30` D6); Settings **UX** for the toggle is EP-8, EP-9 only needs the flag readable. |

`MVP DECISION` — No change to `M002_MEMORY` DDL. FTS5 arrives as a *separate* migration 003 so
a downgrade path and the transactional-rollback guarantee stay intact (`10` §4).

---

## Files expected to change

```
electron/database/migrations.ts            # + M003_MEMORY_FTS, append to MIGRATIONS[]
electron/database/memory-repository.ts      # NEW — create / search / listAll / deleteById
electron/actions/execute.ts                 # wire memory_save / memory_query executors
electron/actions/dispatcher.ts              # requireCapabilityEnabled('memory') branch
electron/conversation/context-builder.ts     # fill memories:[] (non-sensitive, matched)
electron/logging/logger.ts                  # redact fact text
electron/database/settings-repository.ts    # + memory_enabled default
electron/main/ipc/memory.ts                 # NEW — memory:list, memory:delete (guard()-wrapped)
electron/preload/index.ts                   # + window.lifeos.memory.{list,delete}
core/types/ipc.ts                           # + MemoryDto, MemoryListResult
core/types/channels.ts                      # + CH.MEMORY_LIST, CH.MEMORY_DELETE
src/features/memory/MemoryScreen.tsx        # NEW — "What do you remember about me?"
src/features/memory/useMemories.ts          # NEW — renderer cache + invalidation
src/app/App.tsx                             # + 'memory' nav view (see Renderer changes)
src/lib/ipc.ts                              # + memory list/delete wrappers
```

---

## New folders

- `src/features/memory/` — the Manage-Memories UI (`MemoryScreen.tsx`, `useMemories.ts`).
- (No new `core/` or `electron/` *folders*; `electron/database/` and `electron/actions/`
  already exist — `memory-repository.ts` and `execute.ts` live alongside their siblings.)

---

## New services

- **`MemoryRepository`** (`electron/database/memory-repository.ts`) — the single writer for
  `memories`, parameterised (`10` §6), mirroring `ReminderRepository`:
  - `create(input): Memory` — forces `source='user_confirmed'`, derives
    `is_sensitive = category ∈ {health,family} ? 1 : 0`, stamps `created_at/updated_at`,
    stores the **verbatim source utterance** (see Database changes), `randomUUID()` id.
  - `search(query, { limit }): Memory[]` — FTS5 `MATCH` join, returns all matched rows
    (sensitive included — this is the *user-facing* read path, not the LLM path).
  - `searchNonSensitive(query, { limit }): Memory[]` — FTS5 `MATCH` **with
    `AND m.is_sensitive = 0`** — the **only** query the context-window builder may call.
  - `listAll(): Memory[]` — for the Manage screen, newest first.
  - `deleteById(id): void` — per-row delete; also removes the FTS row via trigger.
- **No new provider.** Memory is a *local* capability; there is deliberately no network path
  and no `MemoryProvider` interface — FTS5 is in-SQLite (`24` v0.3 `MVP DECISION`).

---

## IPC changes

New channels, all `guard()`-wrapped (origin → Zod `.strict()` → `Result<T>`, `16` §5 / `30` §2.3):

| Channel | Dir | Purpose |
| --- | --- | --- |
| `memory:list` → `CH.MEMORY_LIST` | renderer→main | Returns `MemoryDto[]` for the Manage screen. **Includes** sensitive rows (this is the user reading their own profile locally — never leaves the device). |
| `memory:delete { id }` → `CH.MEMORY_DELETE` | renderer→main | Per-row delete; broadcasts `memory:changed`. |
| `memory:changed` | main→renderer | Cache-invalidation broadcast (mirrors `reminders:changed`). |

**Reused, not new:** `chat:send`/`chat:done` (carries a `memory_save` proposal like any other),
and `action:confirm { turnId }` / `action:cancel { turnId }` — memory-save confirmation flows
through the **existing** dispatcher confirm path (`36` §4.3). No memory-specific confirm IPC.

`MVP DECISION` — `memory:list` returns full facts (incl. sensitive) because it is the local
"read your own profile" surface; the **sensitive-never-sent** rule governs *outbound network
bodies*, not the local renderer the user is already trusted to see (`10` §8.3 lists the Manage
screen as an explicit, allowed sensitive surface).

---

## Database changes

**Migration 003 — FTS5 virtual table + sync triggers.** Appended to `MIGRATIONS[]`
(`user_version` 2 → 3). Additive only; `memories` table untouched.

```sql
-- M003_MEMORY_FTS  (electron/database/migrations.ts)

-- Verbatim source utterance, required by 10 §8 RISK + 24 v0.3 constraint 3.
-- ADD COLUMN is cheap and forward-only (10 §4).
ALTER TABLE memories ADD COLUMN source_utterance TEXT;   -- the raw thing the user said

-- Contentless-external-content FTS5 mirror over the searchable text.
CREATE VIRTUAL TABLE memories_fts USING fts5(
  subject,
  fact,
  content='memories',
  content_rowid='rowid'
);

-- Backfill any rows that predate the FTS table (there are none in practice — dead schema —
-- but the migration is correct even if a tester hand-inserted rows).
INSERT INTO memories_fts(rowid, subject, fact)
  SELECT rowid, subject, fact FROM memories;

-- Keep FTS in lock-step with the base table.
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, subject, fact) VALUES (new.rowid, new.subject, new.fact);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, subject, fact)
    VALUES ('delete', old.rowid, old.subject, old.fact);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, subject, fact)
    VALUES ('delete', old.rowid, old.subject, old.fact);
  INSERT INTO memories_fts(rowid, subject, fact) VALUES (new.rowid, new.subject, new.fact);
END;
```

- **New setting:** `memory_enabled` (default `'false'`) added to `SETTING_DEFAULTS`
  (`settings-repository.ts`). Off ⇒ memory intents refused in the dispatcher.
- **Retention:** memories are **not** swept (they are a permanent profile, unlike `app_logs`
  and `reminder_history` — `10` §9). Only Reset Local Data removes them.
- **No change** to `reminders`, `reminder_history`, `settings`, `app_logs`, or the
  `conversations` table.

`RISK` — FTS5 must be compiled into the bundled SQLite. `VERIFIED FACT` (`10` §1) Electron 43
bundles Node 24's `node:sqlite`; **DoD includes an explicit `CREATE VIRTUAL TABLE … USING
fts5` smoke test on the packaged build** — if FTS5 is absent, fall back to `LIKE`-based
subject search behind the same `MemoryRepository.search` surface (a one-method change, no
schema/UI change), and file the FTS5-availability finding.

---

## UI changes

- **New nav destination "Memory"** ("What do you remember about me?") — a `View` in `App.tsx`.
  It ships **enabled and visible even before `memory_enabled` is on**, showing an empty state:
  *"You haven't asked me to remember anything yet."* — because the read screen must exist
  *before* the write path (`10` §8.4).
- **`MemoryScreen`** lists each fact as a card: **subject · fact · category badge · the
  verbatim source utterance · the date** · a **Delete** button (per-row). A `🔒 Sensitive`
  badge marks `is_sensitive=1` rows with the copy *"Never sent to the cloud."*
- **The `memory_save` proposal renders inside the chat bubble** as a confirmation-card variant
  (`31` §4.1) — *"Would you like me to remember: **your grandfather has diabetes**?"* with
  Confirm / Cancel, exactly like a reminder proposal.
- Settings **UX** for the `memory_enabled` toggle + consent copy is **EP-8's** surface
  (`41` §5); EP-9 needs only the flag. If EP-8 already shipped, EP-9 adds the memory row there.

---

## Main process changes

- Register `MemoryRepository` in the DB wiring (alongside `ReminderRepository`), constructed
  with the shared `SqliteDriver`.
- Dispatcher: implement `requireCapabilityEnabled` for `memory_save`/`memory_query` reading
  `memory_enabled`; off ⇒ return the friendly refusal, drop the model's proposal (`31` §2).
- `execute.ts`: `case 'memory_save'` → `memoryRepo.create({...a, source:'user_confirmed',
  sourceUtterance: env.userText})`; `case 'memory_query'` → `memoryRepo.search(a.subject)`,
  format a follow-up reply with the verbatim utterance + date.
- Context-window builder: populate `memories` via `searchNonSensitive(subjectHint)` — **the
  only** place a fact can approach the network, and it is structurally filtered to `is_sensitive
  = 0`.
- Register `memory:list` / `memory:delete` handlers; broadcast `memory:changed`.
- Logger: extend the redaction pass to scrub `fact`/`source_utterance` text from `app_logs`.

---

## Renderer changes

- `App.tsx` `View` union gains `'memory'`; add a `NAV` entry `{ id:'memory', label:'Memory',
  icon:'🧠' }` (labeled emoji, see EP-11 a11y). Route `view === 'memory' && <MemoryScreen />`.
- `useMemories()` hook: loads `memory:list`, subscribes to `memory:changed`, exposes
  `remove(id)` → `memory:delete`. Mirrors `useReminders` cache/invalidation (`30` §1).
- The chat message list (EP-2) already renders proposal-cards; the `memory_save` variant is a
  copy/label change, not new plumbing.

---

## Provider changes

**None.** Memory is local-only by deliberate design (`24` v0.3). No `LlmProvider`,
`SpeechProvider`, or new provider is touched. The *only* interaction with a provider is
**exclusionary**: the context-window builder omits sensitive facts before the `LlmProvider`
call — a subtraction, not an addition, to the provider payload.

---

## Security considerations

- **Sensitive-never-sent, enforced structurally.** The context-window builder calls
  `searchNonSensitive` (SQL `WHERE is_sensitive = 0`), not a filter applied after the fact.
  `31` §4.3 / §6 invariant: *"sensitive memories never included."*
- **Payload-snapshot build gate.** A test seeds a `health`/`family` memory, drives a chat turn,
  captures the **exact outbound request body** handed to the `LlmProvider`, and **fails the
  build** if the sensitive `fact`, `subject`, or `source_utterance` string appears anywhere in
  it. This is the EP-9 security-specific gate required by `41`.
- **Logs redacted.** Fact + source-utterance text scrubbed before `app_logs` write (`10` §8.3).
- **Key never crosses IPC / LLM never actuates** — unchanged (`41` §8 invariants 4–5); memory
  adds no new network origin and no new actuation path.
- **Confirmation gate holds for `memory_save`** — it is `isPreConfirm`; nothing persists
  without a human/voice Confirm via the stored-proposal invariant (`36` §4.3).
- **`memory:list` is local-only** — sensitive facts surface only in the user's own renderer,
  never in an outbound body; this is the explicitly-allowed surface from `10` §8.3.

---

## Performance considerations

- **FTS5 replaces LIKE-scan.** Subject/fact search is index-backed; at the "hundreds of facts"
  scale (`24` v0.3) it is instantaneous. No embeddings, no model load, **zero installer bytes**
  added (`24` v0.3 `MVP DECISION`).
- **Synchronous SQLite on the main thread** (`30` §6) is untouched and adequate at this scale;
  memory queries are tiny and infrequent (once per `memory_query` turn + once per context
  build). EP-11 owns the utilityProcess/async-facade decision (`30` §6) — not EP-9.
- **Statement caching** (`30` D11) would help the per-turn context query; deferred to EP-11.
- Triggers add three tiny writes per memory mutation — negligible (single-digit writes/day,
  `10` §2).

---

## Risks

- `RISK` — **FTS5 not compiled into bundled SQLite.** Mitigation: packaged-build smoke test in
  DoD; `LIKE` fallback behind `MemoryRepository.search`. (`10` §1 anticipates a driver swap.)
- `RISK (high, product)` — **Mis-transcribed medical fact recalled confidently.** Mitigation:
  verbatim `source_utterance` shown on every recall + in the Manage screen (`10` §8, `24` v0.3
  constraint 3); per-row delete always visible.
- `RISK` — **A prompt-injected model tries to exfiltrate a stored fact.** Mitigation: it can
  only ever see non-sensitive, subject-matched rows built in main; it never receives ids,
  timestamps, or sensitive facts (`31` §4.3, §6).
- `RISK` — **Category mislabelled by the model** (e.g. a health fact tagged `other` ⇒ not
  sensitive). Mitigation: derivation is `category ∈ {health,family}`; **the model proposes the
  category, but the Confirm card shows it and the user confirms** — and a `FUTURE OPTION` is a
  local keyword heuristic that upgrades to sensitive on health/family terms. Documented, not
  silently trusted.
- `RISK` — **Embedding temptation.** Held off by the `24` v0.3 rule: reach for embeddings only
  with a *failing real query as evidence*.

---

## Rollback strategy

- **Primary: flip `memory_enabled` off** (`41` §10). Memory intents are then refused in the
  dispatcher; the Manage screen shows its empty state; **no code revert needed**.
- Migration 003 is **forward-only and additive** (a virtual table + one nullable column +
  triggers). It cannot corrupt `reminders`; a downgrade is handled by
  `DatabaseFromNewerVersionError` (`10` §4) — a v0.7 binary opening a v0.8 DB refuses safely
  rather than running backward.
- The pre-first-migration `.bak-v2` copy (`10` §4) provides a file-level restore point.
- Because memory is opt-in and off by default, a v0.8 shipped with `memory_enabled` forced off
  is **byte-identical in behaviour to v0.7** for every existing user.

---

## Definition of Done

Re-asserts the `41` §8 cross-cutting invariants, plus EP-9 specifics:

1. **Full offline reminder loop works** (create → confirm → schedule → notify + speak) with no
   OpenAI key and `memory_enabled` off (`41` §8.1).
2. **Zero outbound packets with all cloud features off** — Wireshark off→zero (`41` §8.2).
3. **Confirmation gate holds** — `memory_save` requires a human/voice Confirm via the stored
   proposal; nothing persists otherwise (`41` §8.3, `36` §4.3).
4. **API key never crosses IPC; LLM never actuates** (`41` §8.4–8.5).
5. **Notification + history fire unconditionally and first** (`41` §8.6).
6. **No `child_process`/`eval`/dynamic import** added (`41` §8.7, ESLint-enforced).
7. **Payload-snapshot test green** — a seeded sensitive fact never appears in any outbound
   LLM body; **the build fails if it does**.
8. The **Manage screen ships and works before the save path is enabled** (verified by shipping
   order + a test that the screen renders with `memory_enabled` off).
9. FTS5 `CREATE VIRTUAL TABLE` smoke test passes on the **packaged** build.
10. Migration 002→003 is transactional; a forced mid-migration failure rolls back cleanly
    (mirrors the existing migration-rollback test, `30` §2.5).
11. The EP-9 phase checklist (this doc) is green and referenced by `53` (`41` §11).

---

## Feature Checklist

**Already completed (pre-EP-9):**
- `memories` table + `idx_memories_subject` (migration 002, `M002_MEMORY`).
- `MemorySaveAction` / `MemoryQueryAction` Zod schemas (`31` §3).
- Dispatcher `isPreConfirm` classification of `memory_save`; read-only `memory_query` (`36` §2).
- The empty `memories: []` context slot shipped by EP-5 (`31` §4.3).
- Stored-proposal confirm invariant + `action:confirm/cancel` IPC (EP-6, `36` §4.3).

**New work (EP-9):**
- Migration 003: FTS5 virtual table + triggers + `source_utterance` column.
- `MemoryRepository` (create/search/searchNonSensitive/listAll/deleteById).
- `execute.ts` memory branches wired live.
- `memory_enabled` flag + dispatcher capability gate.
- Context-window fill with non-sensitive, subject-matched facts.
- `memory:list`/`memory:delete`/`memory:changed` IPC + preload + renderer wrappers.
- `MemoryScreen` + `useMemories` + nav entry.
- Logger fact redaction.
- Payload-snapshot build gate.

**Deferred work (later EPs):**
- Memory-toggle **UX** + consent copy polish → EP-8 Settings surface (if not already shipped),
  and general a11y/animation polish → EP-11.
- Statement caching / async DB facade for the context query → EP-11 (`30` §6, D11).

**Future work (post-1.0, `FUTURE OPTION`):**
- Local embeddings (`transformers.js` all-MiniLM + `sqlite-vec`) — **only** on a demonstrated
  FTS5 failure with the failing query as evidence (`24` v0.3).
- Memory *extraction* from natural speech (defensible only with a local LLM, `24` v0.4).
- A keyword heuristic that force-upgrades `is_sensitive` on health/family terms.

---

## Manual Testing

| Step | Action | Expected Result |
| --- | --- | --- |
| 1 | Fresh v0.8 install, `memory_enabled` off. Open the **Memory** nav item. | Screen renders; empty state *"You haven't asked me to remember anything yet."* No error. |
| 2 | In chat, say/type *"remember that my grandfather has diabetes"* with memory off. | Dispatcher refuses: *"Turn on Memory in Settings to let me remember things."* Nothing stored. |
| 3 | Enable `memory_enabled` (+ consent). Repeat step 2's message. | A confirmation card appears in the bubble: *"Would you like me to remember: **your grandfather has diabetes**?"* [Confirm] [Cancel]. Nothing stored yet. |
| 4 | Click **Confirm**. | Reply *"Okay, I'll remember that."* Row persists: `subject='grandfather'`, `category='health'`, `is_sensitive=1`, `source='user_confirmed'`, `source_utterance` = the exact text. |
| 5 | Open **Memory**. | Card shows subject, fact, `health` badge, `🔒 Sensitive · Never sent to the cloud`, the verbatim utterance, the date, and a **Delete** button. |
| 6 | Ask *"what health condition does my grandfather have?"* | Reply recalls *"You told me on 12 Jul 2026 that your grandfather has diabetes,"* showing the verbatim utterance. |
| 7 | Inspect the outbound LLM request body for step 6 (dev proxy). | The sensitive fact does **not** appear anywhere in the body (it was answered via `memory_query`, not by feeding the fact to the model). |
| 8 | Save a **non**-sensitive fact (*"remember I prefer tea over coffee"* → `preference`). Then start any chat turn. | The context window's `memories` array contains the tea/coffee fact (non-sensitive), and **not** the diabetes fact. |
| 9 | Delete the grandfather memory (per-row Delete). | Row gone from `memories` and `memories_fts`; `memory:changed` refreshes the screen; a subsequent recall finds nothing. |
| 10 | Reset Local Data. | All memories gone with the data dir; app relaunches empty. |

---

## Edge Cases

- **Duplicate save** — user asks to remember the same fact twice. Expected: a second row is
  allowed (facts can legitimately repeat with different utterances); the Manage screen shows
  both; `FUTURE OPTION` de-dup by (subject,fact). No silent merge.
- **Empty/whitespace subject or fact** — rejected by `MemorySaveAction` Zod (`min(1).trim()`);
  the card never appears; the model is asked to clarify.
- **Very long fact (>500 chars)** — `max(500)` in the schema truncates the proposal to a
  clarification; nothing stored.
- **Category the model can't decide** — `needsClarification=true` ⇒ a card with **no Confirm**
  button (`36` §4.1); nothing stored.
- **FTS5 special characters in a query** (`"`, `*`, `AND`) — `MemoryRepository.search` quotes
  the query as an FTS5 string literal; a stray operator can't crash the match.
- **`memory_query` with zero matches** — friendly *"I don't have anything saved about that."*
- **Memory toggled off while a save card is pending** — the pending proposal is dropped on
  confirm because `requireCapabilityEnabled` re-checks in main at execute time.
- **Sensitive fact that the user explicitly asks to send** — refused; there is no path; the
  rule is structural, not a preference.

---

## Failure Cases

- **DB write fails on `memory_save`** — execution error becomes a sanitised assistant message
  (*"I couldn't save that just now."*) + a redacted log; the proposal is not left
  half-applied (`36` §5).
- **FTS5 unavailable at runtime** — `MemoryRepository.search` catches the FTS error and falls
  back to `LIKE '%subject%'`; recall still works, degraded; a warning is logged.
- **Migration 003 fails mid-way** — the wrapping `d.transaction()` rolls back; `user_version`
  stays 2; app opens on the old schema; the `.bak-v2` copy is available (`10` §4).
- **Context-window query throws** — the builder returns `memories: []` (fails safe to *no*
  memory) rather than aborting the chat turn; the turn proceeds without memory context.
- **`memory:delete` for a non-existent id** — no-op, `changes:0`; `Result.ok` with a benign
  message; no throw across IPC.

---

## Recovery Tests

1. Kill the app immediately after **Confirm** on a `memory_save` (before the reply renders).
   Reopen → the fact is present (the write committed in the synchronous execute path).
2. Corrupt/rename `lifeos.db`, reopen → app recreates schema through migration 003; empty
   memory; no crash.
3. Force `CREATE VIRTUAL TABLE fts5` to fail (simulate no-FTS build) → migration falls to the
   `LIKE`-fallback path (or, if wired as hard-fail, the app refuses to start with a clear
   message and the `.bak-v2` is intact) — verify the chosen path matches the DoD decision.
4. Downgrade to a v0.7 binary against the v0.8 DB → `DatabaseFromNewerVersionError` shown; no
   backward migration; reminders intact.

---

## Regression Tests

- **Full offline reminder loop** (create → confirm → schedule → notify + speak), no key,
  `memory_enabled` off — **byte-identical to v0.7** (`41` §8.1).
- **Confirmation gate** — `memory_save` and every reminder action still require an explicit
  Confirm; timeout = cancel; renderer cannot execute an unshown action (`36` §4.3).
- **Wireshark off → zero packets** with all cloud features and memory off (`41` §8.2).
- **Payload-snapshot** — sensitive fact absent from every outbound body (build gate).
- Existing 96 core tests + the migration-rollback test still green (`30` §10).
- Context window without memory (memory off) is identical to the EP-5 shape (empty
  `memories: []`).

---

## Performance Tests

- Seed 500 memories; `memory_query` p95 latency well under one 30 s scheduler tick; UI stays
  responsive (main-thread SQLite budget, `30` §6).
- Context-window `searchNonSensitive` adds < a few ms to turn setup at 500 rows.
- `MemoryScreen` `listAll` renders 500 cards without jank (virtualise only if it does —
  `FUTURE OPTION`).
- Trigger overhead: inserting/deleting a memory with the three FTS triggers stays sub-millisecond.

---

## Expected App Behaviour (Current → EP-9)

```text
Current (v0.7):
  user text ─▶ ConversationEngine ─▶ LLM turn ─▶ dispatcher
                                                    ├─ reminder_* → confirm → execute
                                                    ├─ settings   → optimistic + Undo
                                                    ├─ memory_*    → REFUSED (capability off, 31 §2)
                                                    └─ research    → REFUSED
  context window sent to LLM: { …, memories: [] }   ← empty slot since EP-5

EP-9 (v0.8, memory_enabled ON):
  user text ─▶ ConversationEngine ─▶ LLM turn ─▶ dispatcher
                                                    ├─ memory_save  → confirm card → execute → MemoryRepository.create
                                                    │                                   (source='user_confirmed',
                                                    │                                    is_sensitive derived, verbatim utterance)
                                                    └─ memory_query → execute → MemoryRepository.search → recall reply
  context window sent to LLM: { …, memories: searchNonSensitive(subjectHint) }  ← slot FILLED, sensitive EXCLUDED
  NEW "Memory" screen: read your profile + per-row delete (shipped before the save path lit up)
  memory_enabled OFF  ⇒  behaviour byte-identical to v0.7
```

---

## Conversation Testing

- **User:** *"My grandfather has diabetes."*
  **Expected:** offer to remember — a confirmation card *"Would you like me to remember: **your
  grandfather has diabetes**?"* [Confirm] [Cancel]. On **yes** ⇒ stored with `category='health'`,
  `is_sensitive=1`, `source='user_confirmed'`, verbatim utterance kept.
- **User:** *"What health condition does my grandfather have?"*
  **Expected:** recall — *"You told me on 12 Jul 2026 that your grandfather has diabetes,"* with
  the verbatim source utterance shown. This is answered from local FTS5; **the fact is NOT sent
  to the cloud** (verified by the payload-snapshot gate).
- **User (memory disabled):** *"Remember that I'm allergic to penicillin."*
  **Expected:** *"Turn on Memory in Settings first, then I can remember things for you."* Nothing
  stored.
- **User:** *"Forget what I told you about my grandfather."*
  **Expected:** points to the Memory screen's per-row Delete (or, `FUTURE OPTION`, a
  `memory_delete` intent) — deletion is an explicit, visible action, not a silent one.
- **User:** *"Remember I like window seats."* → **Confirm.** Later **User:** *"Where do I like
  to sit?"*
  **Expected:** non-sensitive recall; and this fact **may** appear in the LLM context window
  (it is `preference`, `is_sensitive=0`).

---

## Voice Testing

- Speak *"remember that my grandmother has high blood pressure."* → STT finalises → the same
  `memory_save` confirmation card appears. Say **"yes"** → the local voice-confirmation matcher
  (`36` §4.1, closed phrase set, never sent to the LLM) confirms → stored as `health`/sensitive.
- With a `memory_save` card pending, say an **ambiguous "hmm, maybe later"** → the matcher
  classifies it as `neither` (`48` EP-7 row 4, the matcher's authority) → the card stays
  pending; timeout = cancel (`36` §4.1). (A clear negation like "no thanks" would instead
  `negate` → cancel per `48` — either way nothing is saved.) Verify no accidental save.
- Speak a recall — *"what does my grandmother have?"* → spoken/on-screen reply with the verbatim
  utterance; confirm via the audio path that **no** sensitive fact text was placed in any
  outbound request.
- Confirm the voice-confirmation phrase set is matched **locally in main** and a prompt-injected
  model cannot turn an ambiguous transcript into a memory save (`36` §7).
```
