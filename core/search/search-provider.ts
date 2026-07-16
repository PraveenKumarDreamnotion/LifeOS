/**
 * SearchProvider (57 §2) — the provider-agnostic seam behind the `web_search` tool. The engine
 * calls `search(query)` and gets a grounded answer + its sources; the concrete backend (OpenAI web
 * search today; Brave / Tavily later) is swappable, keyed independently. The tool layer never
 * imports OpenAI — THIS is what keeps web search decoupled. Pure/DOM-free.
 */
export interface SearchCitation {
  title: string;
  url: string;
}

export interface SearchAnswer {
  /** A concise, current answer to the query, grounded in web results. */
  answer: string;
  citations: SearchCitation[];
}

export interface SearchProvider {
  readonly id: string;
  search(query: string, signal?: AbortSignal): Promise<SearchAnswer>;
}
