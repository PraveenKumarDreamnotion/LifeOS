import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAiSearchProvider } from '../../electron/providers/openai-search-provider';

afterEach(() => vi.restoreAllMocks());

function mockOk(content: string, annotations: unknown[] = []) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ choices: [{ message: { content, annotations } }] }),
  } as unknown as Response);
}

describe('OpenAiSearchProvider', () => {
  it('throws no_key without a key (no network)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const p = new OpenAiSearchProvider(() => null);
    await expect(p.search('anything')).rejects.toThrow('no_key');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the grounded answer + parsed url citations', async () => {
    const fetchSpy = mockOk('The number is 01892-123456.', [
      { type: 'url_citation', url_citation: { url: 'https://gec.example', title: 'GEC Kangra' } },
      { type: 'other' }, // ignored
    ]);
    vi.stubGlobal('fetch', fetchSpy);
    const p = new OpenAiSearchProvider(() => 'sk-test', 'gpt-4o-mini-search-preview');
    const r = await p.search('GEC Kangra contact number');
    expect(r.answer).toBe('The number is 01892-123456.');
    expect(r.citations).toEqual([{ url: 'https://gec.example', title: 'GEC Kangra' }]);

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('gpt-4o-mini-search-preview');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'GEC Kangra contact number' });
  });

  it('throws on a non-2xx and on an empty answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response));
    await expect(new OpenAiSearchProvider(() => 'k').search('q')).rejects.toThrow('openai_search_429');

    vi.stubGlobal('fetch', mockOk(''));
    await expect(new OpenAiSearchProvider(() => 'k').search('q')).rejects.toThrow('empty_search');
  });
});
