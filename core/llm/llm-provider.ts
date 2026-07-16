/**
 * LlmProvider interface (33 §4) — greenfield seam for the conversation LLM. Pure.
 *
 * EP-1 defines the interface and its input types only; there is NO concrete implementation
 * yet (the OpenAI LLM lands in EP-5, Ollama post-1.0). The registry returns a null/refusing
 * provider when no key/consent is present — which is exactly today's behaviour (no conversation).
 *
 * `complete()` deliberately returns `unknown`: the raw model output is UNVALIDATED. The
 * conversation engine (EP-5) runs the AssistantTurn schema over it — a provider that returned a
 * typed turn would be claiming it validated something it did not (31 §5, 33 §4).
 */

export type LlmProviderId = 'openai' | 'ollama' | 'anthropic' | 'gemini';

/** Titles + relative time only — never ids/timestamps (31 §4.3). */
export interface ReminderSummary {
  title: string;
  relativeTime: string;
}

/** A non-sensitive memory fact (filled from EP-9; empty in EP-5's context slot). */
export interface MemoryFact {
  subject: string;
  fact: string;
}

export interface LlmTurnInput {
  system: string;
  nowIso: string;
  timezone: string;
  reminders: ReminderSummary[];
  messages: { role: 'user' | 'assistant'; text: string }[];
  /** EP-5 ships this empty; EP-9 fills it with non-sensitive matched facts (31 §4.3). */
  memories: MemoryFact[];
  /** the AssistantTurn json_schema (31 §3), passed to Structured Outputs. */
  responseSchema: object;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  readonly isLocal: boolean;
  readonly supportsStreaming: boolean;

  /** Returns raw, UNVALIDATED model output. The caller runs the schema gates over it. */
  complete(input: LlmTurnInput, signal: AbortSignal): Promise<unknown>;
  /** Optional token streaming for the reply text; the full object is still re-validated. */
  stream?(input: LlmTurnInput, onDelta: (t: string) => void, signal: AbortSignal): Promise<unknown>;
}
