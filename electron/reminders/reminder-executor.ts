/**
 * ReminderExecutor — runs a fired reminder's structured intent (reminder-execution) and returns a
 * normalized outcome the fire-time wiring then speaks + delivers into the chat.
 *
 * This is the fix for "remind me tomorrow to tell me the contact details of NIT Hamirpur": instead
 * of the fired reminder dropping its title into the chat as passive context (so the model asked
 * "what would you like to know?"), an `ai_task` reminder EXECUTES the resolved instruction here —
 * for the one wired capability, a web_search — and produces the actual answer.
 *
 * Design invariants:
 *  • Best-effort. The scheduler's trigger fan-out already fired the UNCONDITIONAL notification +
 *    history BEFORE calling us; nothing here can retract or block that (17 §1). We only add the
 *    spoken/delivered answer on top, asynchronously.
 *  • The confirmation gate holds. Read-only tasks (web_search/weather/news/…) auto-execute — the
 *    user already confirmed the intent at creation. Any WRITE capability (send email, create event)
 *    does NOT auto-run; it returns `needs_confirmation` so the wiring asks first (mirrors 57 §4).
 *  • Bounded + degrades. The web lookup runs under a hard deadline; offline/timeout/failure returns
 *    a `degraded` outcome with an honest message, never a hang and never a thrown reminder.
 *
 * Pure-ish and unit-testable: providers + clock are injected; it performs no IPC/TTS itself.
 */
import type { Reminder } from '../../core/types/reminder';
import { isAiTask, requiresFireTimeConfirmation } from '../../core/types/reminder-execution';
import type { SearchProvider, SearchCitation } from '../../core/search/search-provider';

/** The result of trying to execute a fired reminder. `spoken` is voice-first (no URLs); `delivered`
 *  is the richer text written into the chat (may include sources). `simple` = not an AI task, so the
 *  caller should do the classic notify/speak-title behaviour. */
export type ExecutionOutcome =
  | { kind: 'simple' }
  | { kind: 'answered'; spoken: string; delivered: string }
  | { kind: 'needs_confirmation'; spoken: string; delivered: string }
  | { kind: 'degraded'; reason: string; spoken: string; delivered: string };

export interface ReminderExecutorDeps {
  /** Live-rebind web_search backend; null when web search is off / not consented / offline-gated. */
  searchProvider: () => SearchProvider | null;
  /** Hard per-execution deadline for the (network) task. */
  deadlineMs?: number;
  onInfo?: (msg: string) => void;
}

const DEFAULT_DEADLINE_MS = 35_000;

export class ReminderExecutor {
  private readonly deadlineMs: number;

  constructor(private readonly deps: ReminderExecutorDeps) {
    this.deadlineMs = deps.deadlineMs ?? DEFAULT_DEADLINE_MS;
  }

  async execute(r: Reminder, signal?: AbortSignal): Promise<ExecutionOutcome> {
    const spec = r.execution;
    if (!isAiTask(spec)) return { kind: 'simple' };

    // WRITE capability → never auto-actuate (gate invariant). The fire-time confirm-and-execute
    // loop for write actions is not wired yet, and the local classifier does not yet emit write
    // capabilities, so this path is defensive future-proofing — keep the copy honest (no promise of
    // a confirm flow that doesn't exist) rather than claim it will run on a "yes".
    if (requiresFireTimeConfirmation(spec)) {
      this.deps.onInfo?.(`reminder-exec: "${r.title}" needs confirmation (write capability) — not auto-run`);
      return {
        kind: 'needs_confirmation',
        spoken: `It's time for ${r.title}. This one changes things, so I've left it for you to do.`,
        delivered: `⏰ ${r.title}\n\nThis one would make a change (like sending or scheduling something), so I didn't run it automatically — it's here for you to handle.`,
      };
    }

    // Read-only AI task. The one wired capability is web_search; an empty capability list defaults
    // to research (a bare instruction is a lookup). Other read-only caps (weather/news/…) are
    // reserved in the taxonomy but not executable yet — degrade honestly rather than pretend.
    const wantsSearch = spec.capabilities.length === 0 || spec.capabilities.includes('web_search');
    if (!wantsSearch) {
      this.deps.onInfo?.(`reminder-exec: "${r.title}" capability not executable yet (${spec.capabilities.join(',')})`);
      return {
        kind: 'degraded',
        reason: 'unsupported_capability',
        spoken: `It's time for ${r.title}. I can't run this kind of task automatically yet.`,
        delivered: `⏰ ${r.title}\n\nI can't run this kind of task automatically yet — but it's on the roadmap.`,
      };
    }

    const search = this.deps.searchProvider();
    if (!search) {
      // Web search off / not consented / offline. Honest, actionable, keeps the reminder useful.
      this.deps.onInfo?.(`reminder-exec: "${r.title}" wanted search but no provider (off/offline)`);
      return {
        kind: 'degraded',
        reason: 'no_search_provider',
        spoken: `It's time — ${r.title}. I couldn't look it up just now because web search is off or you're offline.`,
        delivered: `⏰ ${r.title}\n\nI couldn't look this up — web search is off or you're offline. Turn on Web Search (or reconnect) and ask me, and I'll get it for you.`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deadlineMs);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      this.deps.onInfo?.(`reminder-exec: "${r.title}" → web_search q="${spec.instruction.slice(0, 60)}"`);
      const answer = await search.search(spec.instruction, controller.signal);
      const delivered = `⏰ ${r.title}\n\n${answer.answer}${formatSources(answer.citations)}`;
      this.deps.onInfo?.(`reminder-exec: "${r.title}" answered (${answer.citations.length} sources)`);
      return { kind: 'answered', spoken: answer.answer, delivered };
    } catch (err) {
      const aborted = controller.signal.aborted;
      this.deps.onInfo?.(`reminder-exec: "${r.title}" failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        kind: 'degraded',
        reason: aborted ? 'timeout' : 'search_failed',
        spoken: `It's time — ${r.title}. I tried to look it up but couldn't just now.`,
        delivered: `⏰ ${r.title}\n\nI tried to research this but couldn't just now. I'll be here when you want to try again.`,
      };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
}

/** A compact source list appended to a delivered answer (shown, not spoken). Top 3. Mirrors the
 *  conversation engine's format so a researched reminder reads like a normal web-searched answer. */
function formatSources(citations: SearchCitation[]): string {
  if (!citations.length) return '';
  return '\n\nSources:\n' + citations.slice(0, 3).map((c) => `• ${c.title} — ${c.url}`).join('\n');
}
