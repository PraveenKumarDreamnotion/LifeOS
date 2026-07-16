# 57 — Tool-Calling / Capability Layer (web search, then weather/maps/calendar…)

> **Goal:** when OpenAI mode is on, Yogi answers questions that need **live information** (a college
> phone number, today's weather, current news) by calling **tools** — and stays a pure local-model
> answer for things it already knows (explain Docker). A **generic capability layer** where the LLM
> decides a tool is needed, the **app executes it**, and the LLM writes the final answer. Provider-
> agnostic; extensible to Weather, Maps, Gmail, Calendar; **web search is not hard-wired to OpenAI**.
>
> **Status:** ARCHITECTURE (document-before-implement, per the request). One decision (§7) blocks
> the build. Fits the ConversationEngine (`31`/`46`) + Action Dispatcher (`36`/`47`); this is the
> concrete shape of the roadmap's Research Foundation (EP-10, `51`).

---

## 1. The core: an app-controlled tool-use loop

Standard agentic function-calling, with the app — never the model — executing the tool:

```
user turn ─▶ ConversationEngine
  build context + attach AVAILABLE TOOL DEFINITIONS (name, description, JSON-schema args)
  ┌────────────────────────────────────────────────────────────────────┐
  │ LLM call (with tools)                                               │
  │   ├─ model returns a FINAL answer  ───────────────▶ done            │
  │   └─ model returns TOOL CALL(s): web_search{query:"…"}              │
  │         app executes the tool via the ToolRegistry (NOT the model)  │
  │         append the tool RESULT to the messages                      │
  │         loop ▲ (bounded: max 3 iterations)                          │
  └────────────────────────────────────────────────────────────────────┘
  final answer ─▶ chat:done (+ spoken)
```

- **The LLM decides**; **the app executes.** A prompt-injected model can only *request* a tool the
  registry exposes; it can never run code, reach the network directly, or execute a write without
  the dispatcher's confirm gate (§4). This is the same "LLM never actuates" invariant as `36` §7.
- **Bounded loop** (≤3 tool rounds, per-turn timeout) so a turn can't spin.

---

## 2. Contracts (provider-agnostic, `core/tools/`)

```ts
export interface Tool {
  name: string;                       // 'web_search'
  description: string;                // when to use it (the model reads this)
  parameters: object;                 // JSON schema for the args
  /** Read-only? (search/weather) execute directly. Write? (calendar/gmail) go via the dispatcher. */
  kind: 'read' | 'write';
  /** Capability gate — only offered when enabled + consented (e.g. web_search needs cloud + consent). */
  isAvailable(ctx: CapabilityContext): boolean;
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolResult { ok: boolean; content: string; /* fed back to the model */ citations?: Source[] }
```

- **`ToolRegistry`** — the set of tools; filters by `isAvailable` per turn. Web search first;
  weather/maps/calendar/gmail register the same way with **zero engine changes** (extensibility).
- **Search is a seam, not OpenAI:** the `web_search` tool calls a **`SearchProvider`**
  (`core/search/search-provider.ts`): `search(query) → SearchResult[]`. Concrete providers:
  `BraveSearchProvider` / `TavilySearchProvider` / `OpenAiSearchProvider` — swappable, keyed
  independently. The tool never imports OpenAI. **This is what keeps web search decoupled.**

---

## 3. LLM provider changes (`33` §4)

The current `LlmProvider.complete()` returns one strict-JSON `AssistantTurn`. Tool use needs the
model to be able to return **tool calls**. Add a capability, don't break the old path:

```ts
interface LlmProvider {
  complete(input, signal): Promise<unknown>;                 // unchanged (classification path)
  completeWithTools?(input, tools, onToolCall, signal): Promise<{ reply: string; used: string[] }>;
  readonly supportsTools?: boolean;
}
```

- `OpenAiLlmProvider.completeWithTools` uses chat-completions `tools` + `tool_calls`. **Ollama /
  Anthropic** implement the same method against their function-calling APIs → provider-agnostic.
- **Composition with intent classification:** the reply-only path (`chat`/`question`) generates its
  answer via `completeWithTools` (so it can search); the **intent taxonomy is unchanged** (`31`
  §2). Action intents still route to the dispatcher. A model with no tool support falls straight
  back to `complete()` (today's behaviour) — offline/Ollama degrade gracefully.

---

## 4. Dispatcher integration (read vs write tools, `36`)

- **Read tools** (`web_search`, `weather`, `maps.lookup`) — no user confirmation; execute inside
  the loop and feed results back. They only *read*, so the confirmation gate doesn't apply.
- **Write tools** (`calendar.createEvent`, `gmail.sendDraft`) — a tool call becomes an
  **`ActionEnvelope`** through the **existing Action Dispatcher**: validate → **confirm card** →
  execute (`36` §2/§4). So "add it to my calendar" still shows a Confirm, exactly like a reminder.
  The tool layer and the dispatcher meet here: **reads flow through the engine loop; writes flow
  through the dispatcher.** No new actuation path.

---

## 5. Consent, privacy, safety

- **Per-capability consent** (mirrors STT/TTS/AI-assist, `32` §2): enabling **Web Search** shows
  "your query and page snippets are sent to <search provider>." Off ⇒ the tool isn't offered and
  Yogi answers "from what I know" (today's behaviour). Consent is not transitive.
- **Provider allow-list:** each search backend is its own consented origin (`32` §3.2) — the
  Wireshark off→zero proof still holds when web search is off.
- **The model can only reach registered tools**; no `web_search` = no browsing. Tool args are
  validated (JSON schema) before execute. Results are treated as untrusted text (rendered, never
  eval'd) — a searched page cannot inject an action (only the human-confirmed dispatcher writes).

---

## 6. What lands (phased)

| Phase | Ships |
| --- | --- |
| **T1 — Loop + web search** | `core/tools/` + `ToolRegistry`; `completeWithTools` on the OpenAI provider; the bounded tool-use loop in the engine for reply-only turns; the `web_search` **read** tool + a `SearchProvider` with ONE backend (see §7); Web-Search consent. → *answers "college contact number", "today's weather", "latest news".* |
| **T2 — More read tools** | `weather`, `maps/places` as read tools behind the same registry. |
| **T3 — Write tools via dispatcher** | `calendar.createEvent`, `gmail.createDraft` as **write** tools → dispatcher confirm card. (Gmail/Calendar MCP-style.) |

Local knowledge (explain Docker / what is React) never triggers a tool — the model answers directly
because the system prompt says "use web_search ONLY for current/factual-lookup questions you can't
answer reliably from training." (Test 4.)

### T1 as SHIPPED (structured-decision variant)

For a SINGLE tool, T1 realizes "the LLM decides → app executes → app answers" through the existing
strict `AssistantTurn` instead of a native `tool_calls` loop (which can't combine with strict
json_schema): the model returns `needsWebSearch` + `searchQuery` in its turn; if true (and web
search is on), the engine runs the `SearchProvider`, uses the grounded answer as the reply (sources
appended to the shown text, omitted from the spoken text), and falls back to the model's own reply
if the search fails — never worse than not searching. The backend is `OpenAiSearchProvider`
(`gpt-4o-mini-search-preview`) behind the seam. Native multi-tool function-calling
(`completeWithTools`, the §1 loop) lands in **T2/T3** when several tools must compose in one turn.
Files: `turn-schema.ts` (+`needsWebSearch`/`searchQuery`), `system-prompt.ts`,
`core/search/search-provider.ts`, `openai-search-provider.ts`, `registry.makeSearchProvider`,
`conversation-engine.ts` (the search branch), settings `web_search_enabled`/`search_model`.

---

## 7. THE DECISION THAT BLOCKS T1 — which search backend?

The architecture is backend-agnostic, but T1 must implement **one** `SearchProvider`. The tradeoff
is real and yours to make (keys/cost/coupling):

| Option | Works with… | Pros | Cons |
| --- | --- | --- | --- |
| **A. Dedicated search API** (Tavily / Brave) | a **new** search API key you add | truly decoupled; clean raw results with citations; Tavily has a free tier | needs another key + consent; small cost |
| **B. OpenAI web search** (`gpt-4o-*-search-preview` / Responses `web_search`) | your **existing** OpenAI key | works immediately, no new key | the *implemented backend* is OpenAI (architecture still decoupled — Brave/Tavily drop in later) |
| **C. Both** | either | A when a search key is set, else B | a bit more work in T1 |

`RECOMMENDATION` — **B for T1** (works today with the key you have; the `SearchProvider` seam keeps
the architecture decoupled so **A** is a drop-in later), unless you already have/want a Tavily or
Brave key — then **A** is the "purest" and I'll wire that instead.

---

## 8. Manual tests (from the request)

- **Test 3 (internet):** "Government Engineering College Kangra — contact number?" → Yogi calls
  `web_search`, then answers with the number + source, **not** "I can't browse."
- **Test 4 (local):** "Explain Docker in simple words." → answered directly, **no** tool call.
