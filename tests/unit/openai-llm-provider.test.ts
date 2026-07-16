import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAiLlmProvider } from '../../electron/providers/openai-llm-provider';
import { ASSISTANT_TURN_JSON_SCHEMA } from '../../core/conversation/turn-schema';
import type { LlmTurnInput } from '../../core/llm/llm-provider';

const INPUT: LlmTurnInput = {
  system: 'You are Yogi.',
  nowIso: '2026-07-12T10:00:00.000Z',
  timezone: 'Asia/Kolkata',
  reminders: [{ title: 'Call mom', relativeTime: 'in 2 hours' }],
  messages: [{ role: 'user', text: 'what is the capital of France?' }],
  memories: [],
  responseSchema: ASSISTANT_TURN_JSON_SCHEMA,
};

function mockFetchOk(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
  } as unknown as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAiLlmProvider', () => {
  it('exposes the cloud, non-streaming identity', () => {
    const p = new OpenAiLlmProvider(() => 'sk-test');
    expect(p.id).toBe('openai');
    expect(p.isLocal).toBe(false);
    expect(p.supportsStreaming).toBe(false);
  });

  it('throws no_key when no key is present (no network call)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const p = new OpenAiLlmProvider(() => null);
    await expect(p.complete(INPUT, new AbortController().signal)).rejects.toThrow('no_key');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs Structured Outputs and returns the RAW parsed content', async () => {
    const turn = { intent: 'question', reply: 'Paris.', action: null, confidence: 0.95, needsClarification: false };
    const fetchSpy = mockFetchOk(JSON.stringify(turn));
    vi.stubGlobal('fetch', fetchSpy);

    const p = new OpenAiLlmProvider(() => 'sk-test', 'gpt-4o-mini');
    const out = await p.complete(INPUT, new AbortController().signal);
    expect(out).toEqual(turn); // raw, unvalidated — the engine runs the schema

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0]!;
    const url = call[0];
    const init = call[1];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'assistant_turn', strict: true, schema: ASSISTANT_TURN_JSON_SCHEMA },
    });
    // system prompt + per-turn context is the first message; the user's turn follows.
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('You are Yogi.');
    expect(body.messages[0].content).toContain('Asia/Kolkata');
    expect(body.messages[0].content).toContain('Call mom');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'what is the capital of France?' });
    // the Authorization header carries the key, read at call time.
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-test' });
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response));
    const p = new OpenAiLlmProvider(() => 'sk-test');
    await expect(p.complete(INPUT, new AbortController().signal)).rejects.toThrow('openai_chat_429');
  });

  it('throws when the response has no content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: {} }] }),
    } as unknown as Response));
    const p = new OpenAiLlmProvider(() => 'sk-test');
    await expect(p.complete(INPUT, new AbortController().signal)).rejects.toThrow('empty_response');
  });
});
