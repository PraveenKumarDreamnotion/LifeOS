/**
 * OpenAiSearchProvider (57 §7 option B) — the web_search backend for T1, using the user's existing
 * OpenAI key via a search-enabled chat model (`gpt-4o-mini-search-preview`), which searches the web
 * and returns a grounded answer + url citations. It sits behind the `SearchProvider` seam, so a
 * Brave / Tavily backend drops in later with no engine change. Key read in main at call time.
 */
import type { SearchProvider, SearchAnswer, SearchCitation } from '../../core/search/search-provider';

const SEARCH_TIMEOUT_MS = 30_000; // web search can be slower than a plain completion
const DEFAULT_MODEL = 'gpt-4o-mini-search-preview';

interface SearchCompletion {
  choices?: {
    message?: {
      content?: string;
      annotations?: { type?: string; url_citation?: { url?: string; title?: string } }[];
    };
  }[];
}

export class OpenAiSearchProvider implements SearchProvider {
  readonly id = 'openai' as const;

  constructor(
    private readonly getKey: () => string | null,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async search(query: string, signal?: AbortSignal): Promise<SearchAnswer> {
    const key = this.getKey();
    if (!key) throw new Error('no_key');

    // Own timeout so the engine's shorter chat deadline can't kill a legitimate search; also honour
    // an upstream cancel if one is passed.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                'You are a web research assistant. Answer the question concisely and factually using current web information. If you cannot find it, say so plainly.',
            },
            { role: 'user', content: query },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`openai_search_${res.status}`);
      const data = (await res.json()) as SearchCompletion;
      const msg = data.choices?.[0]?.message;
      const answer = msg?.content?.trim();
      if (!answer) throw new Error('empty_search');
      const citations: SearchCitation[] = (msg?.annotations ?? [])
        .filter((a) => a.type === 'url_citation' && a.url_citation?.url)
        .map((a) => ({ url: a.url_citation!.url!, title: a.url_citation!.title || a.url_citation!.url! }));
      return { answer, citations };
    } finally {
      clearTimeout(timer);
    }
  }
}
