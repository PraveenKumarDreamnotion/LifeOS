/**
 * ConversationEngine (46 §New services, 31 §5) — the main-process brain EP-5 puts behind the EP-2
 * conversation shell. Per turn: build context → call the cloud LLM via the factory → Gate 1 shape
 * validation → branch on intent → persist → broadcast the result on chat:done.
 *
 * Two invariants this file guarantees (both are do-not-omit per 46):
 *  1. EXACTLY ONE chat:done fires per turn — including on an unexpected throw. The renderer sets
 *     busy=true on send and clears it on chat:done; a path that exits without broadcasting would
 *     hang the composer forever. Every non-cancelled exit funnels through a single broadcast.
 *  2. The LLM never actuates. Reply-only intents (chat/question/unknown) get the model's reply;
 *     ACTION intents DROP the model's proposed action and re-route the ORIGINAL text to the
 *     existing local parser (parseReminder → ResultCard), so reminders are byte-for-byte the EP-2
 *     path. The Action Dispatcher that would execute an LLM action is EP-6.
 */
import { randomUUID } from 'node:crypto';
import { AssistantTurnSchema } from '../../core/conversation/turn-schema';
import { SYSTEM_PROMPT } from '../../core/conversation/system-prompt';
import { isReplyOnly, type ConversationIntent } from '../../core/conversation/intent';
import type { ShellTurn } from '../../core/types/chat';
import type { LlmProvider, LlmTurnInput } from '../../core/llm/llm-provider';
import type { ActionEnvelope, Proposal } from '../../core/actions/action';
import type { SearchProvider, SearchCitation } from '../../core/search/search-provider';
import type { CreateReminderInput } from '../../core/types/ipc';
import type { ParsedReminder } from '../../core/parsing/types';
import { classifyReminderExecution, executionSummaryLead } from '../../core/parsing/classify-execution';
import { isAiTask } from '../../core/types/reminder-execution';
import type { ContextBuilder, ConversationMessage } from './context-builder';

/** What the engine broadcasts on chat:done — a ShellTurn plus an optional dispatcher proposal. */
export type EngineTurn = ShellTurn & { proposal?: Proposal };

/** The dispatcher surface the engine needs (structural — the real ActionDispatcher satisfies it). */
export interface EngineDispatcher {
  propose(env: ActionEnvelope): { proposal: Proposal } | { error: { code: string; message: string } };
}

/** Hard per-turn deadline; a stalled request aborts and degrades (46 §Perf, Failure table). */
const CHAT_TIMEOUT_MS = 20_000;
/** A web search can be slower than a plain completion, but must STILL be bounded — the turn aborts
 *  at this deadline so the UI never hangs forever on "Searching…". */
const SEARCH_DEADLINE_MS = 35_000;
/** gpt-4o-mini is unreliable about the structured `needsWebSearch` flag — it will happily write
 *  "let me look that up for you" while leaving the flag false, so the search never runs and the
 *  user is stranded on that sentence. When the reply itself announces a lookup, we search anyway.
 *  Kept deliberately tight (a clear "I'm about to look it up" promise) to avoid false positives. */
const LOOKUP_REPLY_RE =
  /\b(let me (look|check|find|search)|i'?ll (look|check|find|search)|look(ing)?\s+(that|this|it|them)\s+up|let me get (you |that )|checking (that|on that|the web)|searching the web)\b/i;
/** RELIABILITY GUARD (reported bug): gpt-4o-mini sometimes CLAIMS in free text that it set a reminder
 *  ("I've set a reminder for you to call Biplab") while classifying the turn reply-only, so the app
 *  creates NOTHING and the user is told success falsely. When the user asked for a reminder AND the
 *  model's reply asserts one was set, but this turn created no reminder (no proposal), we must NOT
 *  echo that false claim — we return an honest failure instead. */
const REMINDER_CLAIM_RE =
  /\b(?:i(?:'ve| have|'ll| will)?\s*(?:set|created|added|scheduled|made|got|put)\b[^.!?]*\b(?:reminder|alarm)|reminder\s+(?:is\s+|has\s+been\s+)?(?:set|created|scheduled|added)|i'?ll\s+remind\s+you|i\s+will\s+remind\s+you|you'?ll\s+be\s+reminded|got\s+it[,!.]?\s*i'?ll\s+remind)\b/i;
const USER_REMINDER_CUE_RE = /\b(?:remind|reminder|alarm|wake\s+me|don'?t\s+(?:let\s+me\s+)?forget)\b/i;
const REMINDER_FAILURE_NOTICE =
  'I couldn\'t set that reminder just now — please try again, for example "remind me in 2 minutes to call Biplab".';

/** Sliding window K (46 §Perf) — cost/latency stay flat regardless of total history length. */
const MAX_HISTORY = 12;
const RETRY_BACKOFF_MS = 400;
/** Shown when a keyed/consented chat/Q&A turn can't reach the cloud (not the offline placeholder). */
export const OFFLINE_NOTICE = "I couldn't reach the assistant just now — check your connection and try again.";

/** The EP-2 local path the engine falls back to (structural — a ChatTurnService satisfies it). */
export interface TurnFallback {
  handleTurn(text: string): ShellTurn;
}

/**
 * The persistent, per-session conversation store (structural — a ChatRepository satisfies it).
 * This is the FAITHFUL render source AND the engine's LLM context: `recordTurn` stores the text
 * actually SHOWN (+ any proposal outcome), `recentTurns` is the bounded context window.
 */
export interface ChatTurnStore {
  recentTurns(sessionId: string, limit: number): { userText: string; assistantText: string; kind: 'chat' | 'reminder' | 'email' }[];
  recordTurn(input: {
    id: string;
    sessionId: string;
    userText: string;
    assistantText: string;
    intent?: string | null;
    proposalSummary?: string | null;
    proposalStatus?: 'pending' | 'executed' | 'cancelled' | null;
  }): void;
}

export interface ConversationEngineDeps {
  /** Live-rebind factory: the cloud LLM when enabled+keyed+consented, else null (46 §Provider). */
  provider: () => LlmProvider | null;
  /** The EP-2 local parser path — used for action intents, cloud-off, and reminder-shaped degrade. */
  fallback: TurnFallback;
  context: ContextBuilder;
  /** Persistent per-session store: the engine reads context from it and records each turn faithfully. */
  chat: ChatTurnStore;
  /** Emit chat:done for this turn (main → renderer) — may carry a dispatcher proposal (EP-6). */
  broadcast: (turnId: string, turn: EngineTurn) => void;
  /** EP-6: the Action Dispatcher. When present + enabled, reminder-create turns propose through it
   *  (validate → store pending → confirmable card) instead of the EP-2 direct path. */
  dispatcher?: EngineDispatcher;
  /** EP-6: the `dispatcher_enabled` flag. Off → the EP-2 direct reminder-create path (the rollback). */
  dispatcherEnabled?: () => boolean;
  /** Optional: a turn degraded — the REASON CODE only (e.g. `openai_chat_400`), never the input
   *  text (46 §Failure). Lets a 400 (schema rejected) be told apart from a network failure. */
  onDegrade?: (reason: string) => void;
  /** Optional: speak a genuine spoken-style LLM reply aloud (35 voice-first). Called ONLY on the
   *  reply-only success path — never the reminder card, the offline placeholder, or a degrade
   *  notice. The handler decides whether/how to speak (gated by the Voice toggle in main). */
  onSpeak?: (text: string) => void;
  /** EP-7: called with the resolved summary when a reminder proposal card is shown, so main can
   *  speak the confirmation prompt ("… Say yes to confirm.") when voice-confirm + TTS are on. */
  onProposeSpeak?: (summary: string) => void;
  /** 57: the web_search backend (live rebind). When a reply-only turn the model flagged
   *  `needsWebSearch` comes in, the engine runs a search and answers with it. null → model-only. */
  searchProvider?: () => SearchProvider | null;
  /** Optional info-level telemetry (e.g. web-search decisions/outcomes) for the dev log. */
  onInfo?: (msg: string) => void;
  /** 57/voice: fired when a web search starts, so the UI can show "Searching the web…". */
  onSearchStart?: (turnId: string) => void;
  /** Capability router (offline mode): answers LOCAL commands (time, settings, greeting/help) with
   *  NO LLM. Runs FIRST, in both modes — a non-null return short-circuits before any LLM call, so
   *  local commands work offline and skip a needless request online. null → not a local command. */
  localRouter?: (text: string, hasLlm: boolean) => ShellTurn | null;
}

export class ConversationEngine {
  private readonly inflight = new Map<string, AbortController>();
  private readonly userCancelled = new Set<string>();

  constructor(private readonly deps: ConversationEngineDeps) {}

  /** Start a turn in a session. Returns immediately with a turnId; the result arrives on chat:done.
   *
   *  run() is deferred to a microtask so it NEVER executes synchronously inside this call. The
   *  OFFLINE / local-command paths have no `await` before their broadcast, so without this deferral
   *  the broadcast fired DURING startTurn() — before the caller (startChatTurn) could set turnMeta
   *  and emit chat:turn:started. That inverted ordering broke the launcher↔main live mirror: the
   *  other window's "thinking" placeholder was created but never resolved (no chat:turn:appended,
   *  because turnMeta wasn't set yet), so it hung until a chat switch re-hydrated from the DB. */
  startTurn(text: string, sessionId: string): string {
    const turnId = randomUUID();
    const controller = new AbortController();
    this.inflight.set(turnId, controller);
    void Promise.resolve().then(() => this.run(turnId, text, sessionId, controller.signal));
    return turnId;
  }

  /** User-initiated abort of an in-flight turn: no chat:done follows (the renderer stopped itself). */
  cancel(turnId: string): void {
    const controller = this.inflight.get(turnId);
    if (!controller) return;
    this.userCancelled.add(turnId);
    controller.abort();
  }

  /** Best-effort faithful record: assistantText is EXACTLY what was shown (never a placeholder). */
  private record(
    turnId: string,
    sessionId: string,
    userText: string,
    assistantText: string,
    intent: string,
    proposalSummary: string | null = null,
    proposalStatus: 'pending' | 'executed' | 'cancelled' | null = null,
  ): void {
    try {
      this.deps.chat.recordTurn({ id: turnId, sessionId, userText, assistantText, intent, proposalSummary, proposalStatus });
    } catch {
      /* persistence is best-effort — a write failure never breaks the live turn (47 §DB) */
    }
  }

  /**
   * The accumulated text of an UNFINISHED (pending-clarification) reminder in this session, or null.
   * Walks back through recent turns to the most recent reminder-shaped turn and concatenates it with
   * every turn since (so a multi-step clarification chain accumulates), but returns it ONLY if that
   * accumulation still parses as a clarification — i.e. a reminder is genuinely awaiting a follow-up.
   * A completed (ok) reminder, or no pending reminder, returns null so unrelated turns never combine.
   */
  private pendingReminderContext(sessionId: string): string | null {
    let recent: { userText: string; kind: 'chat' | 'reminder' | 'email' }[];
    try {
      recent = this.deps.chat.recentTurns(sessionId, 6);
    } catch {
      return null;
    }
    let startIdx = -1;
    for (let i = recent.length - 1; i >= 0; i--) {
      const t = recent[i]!;
      if (t.kind !== 'chat' || !t.userText) break; // a fired-reminder turn breaks the run
      if (this.deps.fallback.handleTurn(t.userText).parse) {
        startIdx = i; // the most recent reminder-shaped turn — where the pending reminder started
        break;
      }
    }
    if (startIdx === -1) return null;
    const context = recent
      .slice(startIdx)
      .filter((t) => t.kind === 'chat' && t.userText)
      .map((t) => t.userText)
      .join(' ');
    const p = this.deps.fallback.handleTurn(context).parse;
    return p && !p.ok && p.kind === 'clarification' ? context : null;
  }

  /**
   * Never let Yogi CLAIM a reminder it didn't create. If the user asked for a reminder and the given
   * reply asserts one was set — but this code path created none (no dispatcher proposal) — return an
   * honest failure to show/speak instead of the model's false success. Returns null when no override
   * is needed (the reply is used as-is).
   */
  private reminderClaimOverride(userText: string, reply: string): string | null {
    if (USER_REMINDER_CUE_RE.test(userText) && REMINDER_CLAIM_RE.test(reply)) {
      this.deps.onDegrade?.('reminder_claim_without_action');
      return REMINDER_FAILURE_NOTICE;
    }
    return null;
  }

  private async run(turnId: string, text: string, sessionId: string, signal: AbortSignal): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const provider = this.deps.provider();

      // CAPABILITY ROUTER (Issue: offline mode) — FIRST, before any LLM. A local command (time,
      // settings, greeting/help offline) is answered here with no cloud call, so it works offline
      // and skips a needless LLM request online. Emits exactly one broadcast + record, like any turn.
      const local = this.deps.localRouter?.(text, !!provider) ?? null;
      if (local) {
        this.record(turnId, sessionId, text, local.reply, 'local');
        this.deps.broadcast(turnId, local);
        this.deps.onSpeak?.(local.reply);
        return;
      }

      // Cloud OFF → the local-first path: reminders via the parser (with clarification-context
      // combine so a multi-turn reminder completes offline); genuine reasoning gets an honest notice.
      if (!provider) {
        let shell = this.deps.fallback.handleTurn(text);
        if (!shell.parse) {
          // Not a reminder on its own. If a reminder is PENDING (a prior clarification is unanswered),
          // thread its context so this follow-up ("tomorrow at 9 AM", "drink water") completes it —
          // the parser is stateless, so online this is done by the LLM via history; offline we do it
          // here. Only a still-ambiguous (clarification) pending reminder invites a follow-up.
          const context = this.pendingReminderContext(sessionId);
          if (context) {
            const combined = this.deps.fallback.handleTurn(`${context} ${text}`);
            if (combined.parse) shell = combined; // ok → a card; clarification → continue the flow
          }
        }
        // A fully-parsed reminder gets the SAME confirmation experience OFFLINE as online: it goes
        // through the dispatcher (a confirmable proposal card) AND speaks the "say yes to confirm"
        // prompt so voice-confirm works. The dispatcher needs no LLM — it validates + stores a
        // parser-produced action. Without this, an offline dictated reminder only showed a silent
        // click-to-confirm card with no spoken prompt and no voice path, so it felt like it "stopped".
        if (shell.parse?.ok && this.deps.dispatcher && this.deps.dispatcherEnabled?.()) {
          const res = this.deps.dispatcher.propose(reminderCreateEnvelope(shell.parse.reminder, turnId, sessionId));
          if ('proposal' in res) {
            this.deps.onInfo?.(`reminder parsed + proposed (offline): "${res.proposal.summary}"`);
            this.record(turnId, sessionId, text, shell.reply, 'reminder_create', res.proposal.summary, 'pending');
            this.deps.broadcast(turnId, { reply: shell.reply, parse: null, proposal: res.proposal });
            this.deps.onProposeSpeak?.(res.proposal.summary); // spoken prompt → voice-confirm ("yes")
          } else {
            // Business-rule rejection (e.g. a time in the past) → a friendly message, no card.
            this.record(turnId, sessionId, text, res.error.message, 'reminder_create');
            this.deps.broadcast(turnId, { reply: res.error.message, parse: null });
          }
          return;
        }
        // Clarification, dispatcher disabled, or a non-reminder honest notice → the EP-2 shell + spoken reply.
        this.record(turnId, sessionId, text, shell.reply, shell.parse ? 'reminder_create' : 'unknown');
        this.deps.broadcast(turnId, shell);
        this.deps.onSpeak?.(shell.reply);
        return;
      }

      timer = setTimeout(() => this.inflight.get(turnId)?.abort(), CHAT_TIMEOUT_MS);

      const recent = this.deps.chat.recentTurns(sessionId, MAX_HISTORY);
      const messages: ConversationMessage[] = [
        // A DELIVERY turn (a fired reminder OR a delivered email) has NO user text — it must project
        // to an assistant-only message, or an empty user message would malform the request. Key on
        // the invariant (empty userText), not the kind label, so any future delivery kind is safe.
        ...recent.flatMap((t) =>
          t.userText.trim() === ''
            ? [{ role: 'assistant' as const, text: t.assistantText }]
            : [{ role: 'user' as const, text: t.userText }, { role: 'assistant' as const, text: t.assistantText }],
        ),
        { role: 'user', text },
      ];
      const input = this.deps.context.build(messages, SYSTEM_PROMPT);
      const raw = await this.completeWithRetry(provider, input, signal);
      const turn = AssistantTurnSchema.parse(raw); // Gate 1 — a bad shape throws → degrade
      const modelIntent = turn.intent as ConversationIntent;

      // MIS-TAG GUARD (reminder-execution): a turn that PARSES as a valid future-dated reminder is a
      // scheduling request — even when the model tagged it 'research'/'question' because the payload
      // is a lookup ("remind me tomorrow to tell me the contact details of NIT Hamirpur"). Contact
      // details / prices / weather are exactly what the prompt calls 'research', so the model will
      // often mis-tag these. Without this guard the turn would be answered NOW and the reminder never
      // created — the exact reported bug. The lookup must happen when the reminder FIRES, not now, so
      // the local parser's verdict wins and we route to the action branch. Computed once, reused below.
      const localShell = this.deps.fallback.handleTurn(text);
      const reminderShaped = !!localShell.parse?.ok;
      const intent: ConversationIntent =
        reminderShaped && (isReplyOnly(modelIntent) || modelIntent === 'research') ? 'reminder_create' : modelIntent;

      // 'research' is INHERENTLY a web-lookup request ("top X", "latest Y", contacts, prices) — it
      // must generate an answer via search, NOT fall through to the action branch. Routing it here
      // (and forcing the search below) fixes the bug where a research turn stopped dead on "Let me
      // look that up…" with no search, no indicator, and no error.
      if (isReplyOnly(intent) || intent === 'research') {
        let reply = turn.reply;
        let spoken = turn.reply; // spoken excludes the source URLs (they read badly aloud)
        const search = this.deps.searchProvider?.() ?? null;
        // Trigger a search when: the intent IS research (always); OR the model set the flag; OR the
        // reply itself announces a lookup ("let me look that up") — gpt-4o-mini is inconsistent about
        // the structured flag, so the reply-text heuristic backstops it.
        const wantsSearch = intent === 'research' || turn.needsWebSearch || LOOKUP_REPLY_RE.test(turn.reply);
        this.deps.onInfo?.(
          `answer: intent=${intent} flag=${turn.needsWebSearch} wantsSearch=${wantsSearch} provider=${search ? 'y' : 'n'}`,
        );
        if (wantsSearch && !search) {
          // Web search is off/not consented — say so honestly rather than leaving the user stranded
          // on the model's "Let me look that up…" acknowledgement (which never resolves).
          this.deps.onInfo?.('web_search: wanted but NO provider (web search off / not consented)');
          reply = 'I can look that up, but web search is turned off right now — enable Web Search in Settings and ask me again.';
          spoken = reply;
        }
        if (wantsSearch && search) {
          // 57: the model decided this needs LIVE info → run the web_search tool, answer with it.
          // If the model flagged a search but forgot the query, fall back to the user's own message
          // (this is what made "let me look that up" hang with no answer before).
          const query = (turn.searchQuery && turn.searchQuery.trim()) || text;
          // Re-arm the deadline for the (slower) search and PASS the abort signal into it, so the
          // turn is always bounded and can never hang forever waiting on the search.
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => this.inflight.get(turnId)?.abort(), SEARCH_DEADLINE_MS);
          this.deps.onSearchStart?.(turnId); // → UI shows "Searching the web…"
          this.deps.onInfo?.(`web_search: q="${query.slice(0, 60)}"`);
          try {
            const r = await search.search(query, signal);
            spoken = r.answer;
            reply = r.answer + formatSources(r.citations);
            this.deps.onInfo?.(`web_search: answered (${r.citations.length} sources)`);
          } catch (err) {
            if (this.userCancelled.has(turnId)) throw err; // user cancelled → outer catch, no broadcast
            reply = signal.aborted
              ? 'Sorry, that search took too long — please try again.'
              : "I searched but couldn't find that just now — you could try their official website, or ask me again.";
            spoken = reply;
            this.deps.onDegrade?.(`web_search: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // RELIABILITY GUARD: a plain chat/question reply whose text claims a reminder was set means
        // the model faked success (a real reminder would have taken the action branch below). Replace
        // with an honest failure so we never confirm a reminder that was not created. Gated on
        // !wantsSearch — if a web search ran, `reply` is the ANSWER (e.g. to "best reminder apps"), not
        // a reminder claim, and matching "reminder is set" in that answer would wrongly clobber it.
        if (!wantsSearch) {
          const override = this.reminderClaimOverride(text, reply);
          if (override) {
            reply = override;
            spoken = override;
          }
        }
        this.record(turnId, sessionId, text, reply, intent);
        this.deps.broadcast(turnId, { reply, parse: null });
        // Voice-first: speak the answer aloud (gated by the Voice toggle in the handler).
        this.deps.onSpeak?.(spoken);
      } else {
        // ACTION intent (or a reminder-shaped turn the model mis-tagged) → DROP the model's proposed
        // action. Scope A has ONE executor: creating a reminder, whose fields come from the LOCAL
        // parser (never unvalidated LLM output). Reuse the parse computed for the mis-tag guard.
        const shell = localShell;
        if (shell.parse?.ok && this.deps.dispatcher && this.deps.dispatcherEnabled?.()) {
          // DISPATCHER path (EP-6): validate + store a pending proposal → a confirmable card.
          const res = this.deps.dispatcher.propose(reminderCreateEnvelope(shell.parse.reminder, turnId, sessionId));
          if ('proposal' in res) {
            // Record with proposal metadata (status pending) so a reopened chat re-renders the card.
            this.deps.onInfo?.(`reminder parsed + proposed (online): "${res.proposal.summary}"`);
            this.record(turnId, sessionId, text, shell.reply, intent, res.proposal.summary, 'pending');
            this.deps.broadcast(turnId, { reply: shell.reply, parse: null, proposal: res.proposal });
            this.deps.onProposeSpeak?.(res.proposal.summary); // speak the prompt (voice-confirm)
          } else {
            // Business-rule rejection (e.g. date in the past) → a friendly message, no card.
            this.record(turnId, sessionId, text, res.error.message, intent);
            this.deps.broadcast(turnId, { reply: res.error.message, parse: null });
          }
        } else if (shell.parse) {
          // Dispatcher OFF, or a clarification → the EP-2 direct path (the rollback).
          this.record(turnId, sessionId, text, shell.reply, intent);
          this.deps.broadcast(turnId, shell);
          this.deps.onSpeak?.(shell.reply);
        } else {
          // The parser couldn't turn this into a reminder → the model's own reply (spoken). But if the
          // model CLAIMED it set a reminder (action intent, yet nothing was created), that's a false
          // success — override with an honest failure so we never mislead the user.
          const finalReply = this.reminderClaimOverride(text, turn.reply) ?? turn.reply;
          this.record(turnId, sessionId, text, finalReply, intent);
          this.deps.broadcast(turnId, { reply: finalReply, parse: null });
          this.deps.onSpeak?.(finalReply);
        }
      }
    } catch (err) {
      // A user cancel emits nothing (the renderer already stopped). Any other failure — timeout,
      // network, 4xx/5xx, or a Gate-1 rejection — degrades, and STILL fires exactly one chat:done.
      if (this.userCancelled.has(turnId)) return;
      this.deps.onDegrade?.(err instanceof Error ? err.message : String(err));
      const shell = this.degrade(text);
      this.record(turnId, sessionId, text, shell.reply, 'unknown');
      this.deps.broadcast(turnId, shell);
      this.deps.onSpeak?.(shell.reply);
    } finally {
      if (timer) clearTimeout(timer);
      this.inflight.delete(turnId);
      this.userCancelled.delete(turnId);
    }
  }

  /** One backoff retry on a transient 429/5xx before giving up (46 §Failure table). */
  private async completeWithRetry(provider: LlmProvider, input: LlmTurnInput, signal: AbortSignal): Promise<unknown> {
    try {
      return await provider.complete(input, signal);
    } catch (err) {
      if (signal.aborted || !isRetryable(err)) throw err;
      await delay(RETRY_BACKOFF_MS, signal);
      return provider.complete(input, signal);
    }
  }

  /** Failure degradation: reminder-shaped input still gets the local parser (byte-identical);
   *  pure chat/Q&A that couldn't reach the cloud gets an honest "couldn't reach" notice. */
  private degrade(text: string): ShellTurn {
    const shell = this.deps.fallback.handleTurn(text);
    if (shell.parse) return shell; // a reminder/clarification — local parser result, unchanged
    return { reply: OFFLINE_NOTICE, parse: null };
  }
}

/** Build a validated reminder-create ActionEnvelope from parser output (Scope A: source='local').
 *  reminder-execution: locally classify whether this reminder is an AI task (research → answer) and,
 *  if so, attach the structured execution spec so the fired reminder EXECUTES the intent instead of
 *  replaying the title. The confirmation summary states that intent, so the user confirms what will
 *  actually happen. Non-task reminders are unchanged (execution omitted → classic notify). */
export function reminderCreateEnvelope(reminder: ParsedReminder, turnId: string, sessionId: string | null = null): ActionEnvelope {
  // A 'sing' reminder is never an AI task; otherwise classify the extracted title.
  const execution = reminder.actionType === 'sing' ? null : classifyReminderExecution(reminder.title);
  const input: CreateReminderInput = {
    title: reminder.title,
    description: reminder.description,
    scheduledAtUtcMs: reminder.scheduledAtUtcMs,
    timezone: reminder.timezone,
    recurrenceRule: reminder.recurrenceRule,
    actionType: reminder.actionType,
    source: 'local',
    // Include the key ONLY for a real AI task, so a plain reminder's input stays byte-identical to
    // the EP-2 direct path (the 47 §Regression-1 gate) — additive, never a change to existing rows.
    ...(execution ? { execution } : {}),
  };
  return { action: { kind: 'reminder_create', input, summary: resolvedSummary(reminder, execution) }, source: 'local', turnId, sessionId };
}

/** The resolved one-line summary the user confirms — absolute local time, not the model's phrasing.
 *  For an AI task it STATES the execution intent ("I'll look up X and tell you") so confirming it is
 *  informed consent to run the task at fire time. */
function resolvedSummary(reminder: ParsedReminder, execution: CreateReminderInput['execution'] = null): string {
  const when = new Date(reminder.scheduledAtUtcMs).toLocaleString('en-US', {
    timeZone: reminder.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const lead = isAiTask(execution) ? executionSummaryLead(execution) : reminder.title;
  return `${lead} · ${when} · ${reminder.recurrenceRule ? 'recurring' : 'one-time'}`;
}

/** A compact source list appended to a web-searched answer (shown, not spoken). Top 3. */
function formatSources(citations: SearchCitation[]): string {
  if (!citations.length) return '';
  return '\n\nSources:\n' + citations.slice(0, 3).map((c) => `• ${c.title} — ${c.url}`).join('\n');
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : '';
  return /_(429|5\d\d)$/.test(msg);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}
