# Long-Term Memory

> **Home:** [docs/README.md](./README.md) · **Related:** [AI_INTEGRATIONS](./AI_INTEGRATIONS.md) · [DATABASE](./DATABASE.md) · [ROADMAP](./ROADMAP.md)
>
> **Status: ⛔ Schema-only / Planned.** The scaffolding exists and is wired, but there is **no extraction, no recall, and no UI**. This page documents what is there so a contributor can build on it — not a working feature.

> ⚠️ Not to be confused with `docs/lifeos-planning/MEMORY.md`-style files, and unrelated to the assistant's per-session conversation history (which *is* implemented — see [AI_INTEGRATIONS §context](./AI_INTEGRATIONS.md)). "Long-term memory" here means durable, cross-conversation *facts about the user* (their name, preferences, family). That is the missing pillar.

## What exists today

### The `memories` table (M002)

Created in migration M002 (`electron/database/migrations.ts`):

```sql
CREATE TABLE memories (
  id, subject, fact, category,
  confidence REAL DEFAULT 1.0,
  source TEXT CHECK (source IN ('user_confirmed','inferred')),
  is_sensitive INTEGER DEFAULT 0,   -- health/family flagged
  created_at, updated_at
);
CREATE INDEX idx_memories_subject ON memories (subject, category);
```

The `is_sensitive` flag is intended to keep health/family facts out of any cloud prompt. **Nothing writes to this table today.**

### The wired-but-empty context slot

`ContextBuilder.build()` (`electron/conversation/context-builder.ts`) already ships a `memories: []` slot in the per-turn LLM input:

```ts
// EP-5 ships this empty; EP-9 fills it with non-sensitive matched facts (do-not-omit).
memories: [],
```

So the plumbing to *inject* recalled memories into the prompt exists; it just always receives an empty array.

## What is missing

To make memory real, a contributor needs to build:

1. **Extraction** — after a turn, detect durable facts ("my daughter's name is Aria", "I prefer 9 AM") and write them to `memories` with a `source` and `confidence`. Likely an LLM pass (gated) or a rules layer.
2. **Recall** — given the current turn, select relevant, **non-sensitive** memories and fill the `ContextBuilder` slot. Start with SQLite FTS on `(subject, category)`; add embeddings only if needed.
3. **UI** — a way to see, edit, and delete stored memories (privacy + trust). This is a hard requirement given the sensitivity flag.
4. **Consent & privacy** — respect `is_sensitive` (never send flagged facts to the cloud); make extraction opt-in and inspectable.

## Related unused scaffolding

- The **`conversations` table** (also M002) is a best-effort chat/intent telemetry table, distinct from the faithful `chat_turns` render source. It is created but **currently unwritten** (`ConversationRepository.record` exists but is unwired). It is *not* the memory system, but is another dormant M002 table.

## Why it matters

The status doc calls this "the biggest gap between 'chatbot' and 'companion'." It is the highest-leverage next feature: the table + the injection slot are already there, so the work is extraction + recall + a management UI, not schema. See [ROADMAP §high priority](./ROADMAP.md).

## Recommended build order (for a contributor)

1. Read `context-builder.ts` (the injection point) and the M002 schema.
2. Add a `MemoryRepository` (CRUD + FTS recall).
3. Add an extraction pass behind a new gated seam (reuse `makeLlmProvider`), writing `user_confirmed` facts on explicit statements first (lower hallucination risk than `inferred`).
4. Fill the `ContextBuilder` slot with recalled, non-sensitive facts.
5. Add a Settings → Memory management screen.
6. Add renderer + integration tests mirroring the reminder pipeline's test discipline.
