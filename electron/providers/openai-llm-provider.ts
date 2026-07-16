/**
 * OpenAiLlmProvider (EP-5, 33 §4) — the concrete cloud LLM. `complete()` POSTs to
 * /v1/chat/completions with Structured Outputs (strict json_schema) and returns the RAW,
 * UNVALIDATED object (33 §4, 09 §9): the engine runs AssistantTurnSchema.parse over it. The key
 * is read in main at call time and never crosses IPC (32 §3.3).
 *
 * EP-5 is non-streaming (`supportsStreaming:false`): reliably assembling strict JSON from a token
 * stream is the friction doc 32 §5 / 46 §Risk names, and complete() is the sanctioned fallback.
 * The `chat:delta` channel exists for a later streaming upgrade.
 */
import type { LlmProvider, LlmTurnInput } from '../../core/llm/llm-provider';

const CHAT_TIMEOUT_MS = 20_000;
const DEFAULT_MODEL = 'gpt-4o-mini';

interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
}

export class OpenAiLlmProvider implements LlmProvider {
  readonly id = 'openai' as const;
  readonly isLocal = false;
  readonly supportsStreaming = false;

  constructor(
    private readonly getKey: () => string | null,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async complete(input: LlmTurnInput, signal: AbortSignal): Promise<unknown> {
    const key = this.getKey();
    if (!key) throw new Error('no_key');

    // Per-turn context (no ids/timestamps of reminders — titles + relative time only, 31 §4.3).
    const contextNote =
      `Current time: ${input.nowIso} (${input.timezone}).\n` +
      `The user's active reminders (title + when): ${JSON.stringify(input.reminders)}.`;
    const messages = [
      { role: 'system', content: `${input.system}\n\n${contextNote}` },
      ...input.messages.map((m) => ({ role: m.role, content: m.text })),
    ];

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.6,
        max_tokens: 500,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'assistant_turn', strict: true, schema: input.responseSchema },
        },
      }),
      signal,
    });
    if (!res.ok) throw new Error(`openai_chat_${res.status}`);
    const data = (await res.json()) as ChatCompletion;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty_response');
    return JSON.parse(content); // RAW unknown — the engine validates via AssistantTurnSchema
  }
}

export const CHAT_TIMEOUT = CHAT_TIMEOUT_MS;
