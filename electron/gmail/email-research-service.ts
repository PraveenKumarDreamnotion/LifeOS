/**
 * EmailResearchService (Phase 4) — runs an OPT-IN web lookup for an email via the SAME gated search
 * seam the conversation uses (makeSearchProvider), and caches the result per message so a re-sync
 * never re-pays for the same search. Degrades cleanly (no provider / error → null). Never throws.
 *
 * The DECISION (is research worthwhile + the query) is made upstream by the summary and lives on the
 * cached EmailAiContext; this service only performs + caches the search the coordinator asks for.
 */
import type { WebResearch } from '../../core/gmail/types';
import type { SearchProvider } from '../../core/search/search-provider';
import type { GmailRepository } from '../database/gmail-repository';

const RESEARCH_TIMEOUT_MS = 35_000;

export interface EmailResearchServiceDeps {
  gmailRepo: GmailRepository;
  /** The gated web-search provider (makeSearchProvider) — null when unavailable. */
  searchProvider: () => SearchProvider | null;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export class EmailResearchService {
  constructor(private readonly deps: EmailResearchServiceDeps) {}

  /** Cached-or-search. Returns null when research is unavailable or the query is empty. Idempotent
   *  save, so a rare duplicate call costs at most one extra search. */
  async research(messageId: string, query: string): Promise<WebResearch | null> {
    if (!query.trim()) return null;
    const cached = this.deps.gmailRepo.getResearch(messageId);
    if (cached) return cached;
    const provider = this.deps.searchProvider();
    if (!provider) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS);
    try {
      const { answer, citations } = await provider.search(query, controller.signal);
      if (!answer) return null;
      const result: WebResearch = { query, answer, citations };
      this.deps.gmailRepo.saveResearch(messageId, result);
      return result;
    } catch (e) {
      this.deps.log?.('warn', `gmail: email research failed (${(e as Error).message})`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
