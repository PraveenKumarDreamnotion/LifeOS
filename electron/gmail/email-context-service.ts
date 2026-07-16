/**
 * EmailContextService (Phase 3) — generates + caches an email's AI understanding via the SAME gated
 * LLM seam the conversation uses (makeLlmProvider). Gated on `gmail_ai_summaries` AND a usable
 * provider (key + AI-assist + consent). Degrades cleanly: summaries off / no key / LLM error →
 * returns null and the caller delivers with the snippet + a generic spoken line. Never throws.
 */
import { buildEmailSummaryInput, parseEmailContext } from '../../core/gmail/summary';
import type { EmailAiContext, GmailMessage } from '../../core/gmail/types';
import type { LlmProvider } from '../../core/llm/llm-provider';
import type { GmailRepository } from '../database/gmail-repository';

const SUMMARY_TIMEOUT_MS = 15_000;

export interface EmailContextServiceDeps {
  gmailRepo: GmailRepository;
  /** The gated conversation LLM (makeLlmProvider) — null when unavailable. */
  llm: () => LlmProvider | null;
  summariesEnabled: () => boolean;
  now?: () => number;
  timezone?: () => string;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export class EmailContextService {
  private readonly now: () => number;
  private readonly timezone: () => string;

  constructor(private readonly deps: EmailContextServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.timezone = deps.timezone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  }

  /** Cached-or-generate. Returns null when summaries are unavailable (caller degrades to snippet). */
  async ensure(message: GmailMessage): Promise<EmailAiContext | null> {
    const cached = this.deps.gmailRepo.getAiContext(message.id);
    if (cached) return cached;
    if (!this.deps.summariesEnabled()) return null;
    const provider = this.deps.llm();
    if (!provider) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
    try {
      const input = buildEmailSummaryInput(message, new Date(this.now()).toISOString(), this.timezone());
      const raw = await provider.complete(input, controller.signal);
      const ctx = parseEmailContext(raw);
      this.deps.gmailRepo.saveAiContext(message.id, ctx, provider.id);
      return ctx;
    } catch (e) {
      this.deps.log?.('warn', `gmail: email summary failed (${(e as Error).message})`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
