import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConversationEngine, OFFLINE_NOTICE, type TurnFallback, type EngineTurn, type EngineDispatcher } from '../../electron/conversation/conversation-engine';
import { ContextBuilder } from '../../electron/conversation/context-builder';
import type { ShellTurn } from '../../core/types/chat';
import type { LlmProvider } from '../../core/llm/llm-provider';
import type { ParseResult, ParsedReminder } from '../../core/parsing/types';
import type { ActionEnvelope } from '../../core/actions/action';

const tick = () => new Promise((r) => setTimeout(r, 0));
const SID = 'session-1';

const REPLY_ONLY = { intent: 'question', reply: 'Paris.', action: null, confidence: 0.9, needsClarification: false, needsWebSearch: false, searchQuery: null };
const ACTION = { intent: 'reminder_create', reply: 'ok', action: null, confidence: 0.9, needsClarification: false, needsWebSearch: false, searchQuery: null };

// A fake reminder proposal, so `parse` is truthy on the reminder path.
const REMINDER_PARSE = { ok: true } as unknown as ParseResult;
// The offline honest-notice shape (parse:null). Only its shape matters here — the real message is
// asserted in chat-turn-service.test.ts via the CHAT_PLACEHOLDER constant.
const PLACEHOLDER_SHELL: ShellTurn = { reply: 'I can set reminders offline — that needs an online AI provider.', parse: null };
const REMINDER_SHELL: ShellTurn = { reply: "Here's what I understood.", parse: REMINDER_PARSE };

// A real ParsedReminder, for the dispatcher path (the engine reads shell.parse.reminder).
const PARSED_REMINDER: ParsedReminder = {
  intent: 'create_reminder',
  title: 'Call Rahul',
  description: null,
  scheduledAtUtcMs: 1_752_400_000_000,
  scheduledAtIso: new Date(1_752_400_000_000).toISOString(),
  timezone: 'Asia/Kolkata',
  recurrenceRule: null,
  actionType: 'notify',
  confidence: 0.9,
  source: 'local',
  matchedDateText: 'tomorrow at 9am',
};
const REMINDER_OK_SHELL: ShellTurn = { reply: "Here's what I understood.", parse: { ok: true, reminder: PARSED_REMINDER } };

function fakeProvider(complete: LlmProvider['complete']): LlmProvider {
  return { id: 'openai', isLocal: false, supportsStreaming: false, complete };
}

describe('email-delivery turn projection (Phase 3)', () => {
  it('projects a delivered email (empty userText) as assistant-only — never an empty user message', async () => {
    let capturedMessages: { role: string; text: string }[] = [];
    const provider = fakeProvider(async (input) => {
      capturedMessages = input.messages;
      return REPLY_ONLY;
    });
    const { engine } = makeEngine({
      provider: () => provider,
      recent: [
        { userText: '', assistantText: '📧 New email from Amazon — Your package shipped.', kind: 'email' },
      ],
    });
    engine.startTurn('who sent that?', SID);
    await tick();
    await tick();

    // The email turn must appear as an assistant message, and NO message may be an empty user turn.
    expect(capturedMessages.some((m) => m.role === 'assistant' && m.text.includes('Amazon'))).toBe(true);
    expect(capturedMessages.some((m) => m.role === 'user' && m.text.trim() === '')).toBe(false);
    // The live user question is still present.
    expect(capturedMessages.some((m) => m.role === 'user' && m.text === 'who sent that?')).toBe(true);
  });
});

function makeEngine(opts: {
  provider: () => LlmProvider | null;
  fallbackShell?: ShellTurn;
  dispatcher?: EngineDispatcher;
  dispatcherEnabled?: boolean;
  search?: (query: string) => Promise<{ answer: string; citations: { title: string; url: string }[] }>;
  recent?: { userText: string; assistantText: string; kind: 'chat' | 'reminder' | 'email' }[];
}) {
  const broadcast = vi.fn<(turnId: string, turn: EngineTurn) => void>();
  const recordTurn = vi.fn();
  const onSpeak = vi.fn<(text: string) => void>();
  const onProposeSpeak = vi.fn<(summary: string) => void>();
  const onSearchStart = vi.fn<(turnId: string) => void>();
  const handleTurn = vi.fn<TurnFallback['handleTurn']>(() => opts.fallbackShell ?? PLACEHOLDER_SHELL);
  const search = opts.search ? vi.fn(opts.search) : undefined;
  const engine = new ConversationEngine({
    provider: opts.provider,
    fallback: { handleTurn },
    context: new ContextBuilder({ listActive: () => [] }, () => 0, () => 'UTC'),
    chat: { recentTurns: () => opts.recent ?? [], recordTurn },
    broadcast,
    onSpeak,
    onProposeSpeak,
    onSearchStart,
    dispatcher: opts.dispatcher,
    dispatcherEnabled: opts.dispatcherEnabled === undefined ? undefined : () => opts.dispatcherEnabled!,
    searchProvider: search ? () => ({ id: 'test', search }) : undefined,
  });
  return { engine, broadcast, recordTurn, handleTurn, onSpeak, onProposeSpeak, search, onSearchStart };
}

/** The single record() call's payload — the SHOWN turn persisted for faithful re-render. */
const recorded = (recordTurn: ReturnType<typeof vi.fn>) => recordTurn.mock.calls[0]![0];

afterEach(() => vi.restoreAllMocks());

describe('ConversationEngine', () => {
  it('cloud OFF → uses the local fallback, records the SHOWN reply, and does NOT speak', async () => {
    const { engine, broadcast, recordTurn, handleTurn, onSpeak } = makeEngine({ provider: () => null });
    engine.startTurn('hello', SID);
    await tick();
    expect(handleTurn).toHaveBeenCalledWith('hello');
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0]![1]).toEqual(PLACEHOLDER_SHELL);
    expect(recordTurn).toHaveBeenCalledTimes(1);
    expect(recorded(recordTurn)).toMatchObject({ sessionId: SID, assistantText: PLACEHOLDER_SHELL.reply });
    expect(onSpeak).toHaveBeenCalledWith(PLACEHOLDER_SHELL.reply);
  });

  it('startTurn defers run() — it NEVER broadcasts synchronously (launcher↔main mirror ordering)', async () => {
    // The offline/local path has no await before its broadcast; if run() executed synchronously
    // inside startTurn(), the broadcast would fire before the caller sets turnMeta + emits
    // turn:started, breaking the live mirror. So nothing may broadcast within the synchronous call.
    const { engine, broadcast } = makeEngine({ provider: () => null });
    engine.startTurn('hello', SID);
    expect(broadcast).not.toHaveBeenCalled(); // deferred — still pending
    await tick();
    expect(broadcast).toHaveBeenCalledTimes(1); // now resolved
  });

  it('reply-only intent → broadcasts the model reply, records the SHOWN reply once, and speaks it', async () => {
    const { engine, broadcast, recordTurn, onSpeak } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(REPLY_ONLY)),
    });
    engine.startTurn('what is the capital of France?', SID);
    await tick();
    await tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0]![1]).toEqual({ reply: 'Paris.', parse: null });
    expect(recordTurn).toHaveBeenCalledTimes(1);
    expect(recorded(recordTurn)).toMatchObject({ userText: 'what is the capital of France?', assistantText: 'Paris.', intent: 'question' });
    // The mis-tag guard consults the local parser on every turn, but a non-reminder parse leaves
    // routing unchanged — this stays a reply-only turn and is spoken as-is.
    expect(onSpeak).toHaveBeenCalledWith('Paris.'); // a genuine LLM reply is spoken aloud
  });

  it('action intent (dispatcher off) → drops the model action, shows + records the reminder shell', async () => {
    const { engine, broadcast, recordTurn, handleTurn, onSpeak } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(ACTION)),
      fallbackShell: REMINDER_SHELL,
    });
    engine.startTurn('remind me tomorrow to call Rahul', SID);
    await tick();
    await tick();
    expect(handleTurn).toHaveBeenCalledWith('remind me tomorrow to call Rahul');
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0]![1]).toEqual(REMINDER_SHELL);
    expect(recorded(recordTurn)).toMatchObject({ assistantText: REMINDER_SHELL.reply }); // SHOWN reply
    expect(onSpeak).toHaveBeenCalledWith(REMINDER_SHELL.reply);
  });

  it('EP-6: dispatcher ON + reminder parse → proposes, broadcasts a proposal, records it pending', async () => {
    const propose = vi.fn((_env: ActionEnvelope) => ({ proposal: { turnId: 'x', kind: 'reminder_create' as const, summary: 'Call Rahul · one-time' } }));
    const { engine, broadcast, recordTurn } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(ACTION)),
      fallbackShell: REMINDER_OK_SHELL,
      dispatcher: { propose },
      dispatcherEnabled: true,
    });
    engine.startTurn('remind me tomorrow at 9am to call Rahul', SID);
    await tick();
    await tick();
    expect(propose).toHaveBeenCalledTimes(1);
    // the envelope carries a validated reminder-create action + the session it belongs to
    const env = propose.mock.calls[0]![0];
    expect(env.action.kind).toBe('reminder_create');
    expect(env.action.input.title).toBe('Call Rahul');
    expect(env.source).toBe('local');
    expect(env.sessionId).toBe(SID);
    expect(broadcast).toHaveBeenCalledTimes(1);
    const out = broadcast.mock.calls[0]![1];
    expect(out.parse).toBeNull();
    expect(out.proposal?.summary).toContain('Call Rahul');
    // recorded with proposal metadata (pending) so a reopened chat re-renders the card
    expect(recorded(recordTurn)).toMatchObject({ proposalStatus: 'pending', proposalSummary: 'Call Rahul · one-time' });
  });

  it('MIS-TAG GUARD: model says research but it parses as a future reminder → proposes (does NOT search now)', async () => {
    // "remind me tomorrow to tell me the contact details of NIT Hamirpur" — the model mis-tags this
    // 'research' (contacts ARE a lookup), but it's a scheduling request. The guard must route it to
    // the action branch so the reminder is created, NOT answered immediately via web search.
    const RESEARCH = { intent: 'research', reply: 'Let me look that up.', action: null, confidence: 0.9, needsClarification: false, needsWebSearch: true, searchQuery: 'NIT Hamirpur contact details' };
    const propose = vi.fn((_env: ActionEnvelope) => ({ proposal: { turnId: 'x', kind: 'reminder_create' as const, summary: "I'll look up X and tell you · one-time" } }));
    const search = vi.fn(async () => ({ answer: 'should not run', citations: [] }));
    const { engine, broadcast, onSearchStart } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(RESEARCH)),
      fallbackShell: REMINDER_OK_SHELL, // the local parser DID find a valid reminder
      dispatcher: { propose },
      dispatcherEnabled: true,
      search,
    });
    engine.startTurn('remind me tomorrow to tell me the contact details of NIT Hamirpur', SID);
    await tick();
    await tick();
    expect(propose).toHaveBeenCalledTimes(1); // routed to the action branch
    expect(search).not.toHaveBeenCalled(); // NOT answered now
    expect(onSearchStart).not.toHaveBeenCalled();
    expect(broadcast.mock.calls[0]![1].proposal?.kind).toBe('reminder_create');
  });

  it('OFFLINE (no provider) + reminder → dispatcher proposes + speaks the confirm prompt (voice-confirm)', async () => {
    // The "stopped" fix: an offline dictated reminder gets the SAME confirmation as online — a
    // dispatcher card + a spoken "say yes to confirm" prompt — not a silent click-only card.
    const propose = vi.fn((_env: ActionEnvelope) => ({ proposal: { turnId: 'x', kind: 'reminder_create' as const, summary: 'Call Biplub · in 1 minute · one-time' } }));
    const { engine, broadcast, recordTurn, onProposeSpeak } = makeEngine({
      provider: () => null, // OFFLINE
      fallbackShell: REMINDER_OK_SHELL,
      dispatcher: { propose },
      dispatcherEnabled: true,
    });
    engine.startTurn('remind me in one minute to call Biplub', SID);
    await tick();
    await tick();
    expect(propose).toHaveBeenCalledTimes(1); // routed through the dispatcher, offline
    const out = broadcast.mock.calls[0]![1];
    expect(out.proposal?.kind).toBe('reminder_create'); // a confirmable card, not a silent shell
    expect(onProposeSpeak).toHaveBeenCalledWith('Call Biplub · in 1 minute · one-time'); // spoken → voice-confirm
    expect(recorded(recordTurn)).toMatchObject({ proposalStatus: 'pending' });
  });

  it('EP-6: dispatcher ON but the business-rule gate rejects → friendly message, no proposal card', async () => {
    const propose = vi.fn((_env: ActionEnvelope) => ({ error: { code: 'date_in_past', message: 'That time has already passed.' } }));
    const { engine, broadcast } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(ACTION)),
      fallbackShell: REMINDER_OK_SHELL,
      dispatcher: { propose },
      dispatcherEnabled: true,
    });
    engine.startTurn('remind me yesterday to call Rahul', SID);
    await tick();
    await tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
    const out = broadcast.mock.calls[0]![1];
    expect(out.reply).toBe('That time has already passed.');
    expect(out.parse).toBeNull();
    expect(out.proposal).toBeUndefined();
  });

  it('EP-6: dispatcher OFF + reminder parse → EP-2 direct path (broadcast the parse shell, no dispatcher)', async () => {
    const propose = vi.fn((_env: ActionEnvelope) => ({ error: { code: 'unused', message: 'unused' } }));
    const { engine, broadcast } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(ACTION)),
      fallbackShell: REMINDER_OK_SHELL,
      dispatcher: { propose },
      dispatcherEnabled: false,
    });
    engine.startTurn('remind me tomorrow at 9am to call Rahul', SID);
    await tick();
    await tick();
    expect(propose).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0]![1]).toEqual(REMINDER_OK_SHELL); // EP-2 parse proposal
  });

  it('57: reply-only + needsWebSearch → runs web_search and answers with it (spoken excludes URLs)', async () => {
    const searchTurn = { intent: 'question', reply: 'Let me check.', action: null, confidence: 0.9, needsClarification: false, needsWebSearch: true, searchQuery: 'GEC Kangra contact number' };
    const { engine, broadcast, onSpeak, search } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(searchTurn)),
      search: () => Promise.resolve({ answer: 'The contact number is 01892-XXXXXX.', citations: [{ title: 'GEC Kangra', url: 'https://gec-kangra.example' }] }),
    });
    engine.startTurn('GEC Kangra contact number?', SID);
    await tick();
    await tick();
    expect(search!.mock.calls[0]![0]).toBe('GEC Kangra contact number');
    const out = broadcast.mock.calls[0]![1];
    expect(out.reply).toContain('01892-XXXXXX'); // the searched answer, not "Let me check."
    expect(out.reply).toContain('Sources:'); // shown reply carries citations
    expect(onSpeak).toHaveBeenCalledWith('The contact number is 01892-XXXXXX.'); // spoken has NO URLs
  });

  it('57: reply-only + needsWebSearch=false → answers from the model, no search', async () => {
    const { engine, broadcast, onSpeak, search } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(REPLY_ONLY)), // needsWebSearch:false
      search: () => Promise.resolve({ answer: 'nope', citations: [] }),
    });
    engine.startTurn('explain docker', SID);
    await tick();
    await tick();
    expect(search).not.toHaveBeenCalled();
    expect(broadcast.mock.calls[0]![1].reply).toBe('Paris.');
    expect(onSpeak).toHaveBeenCalledWith('Paris.');
  });

  it('57: a web_search failure shows an honest message (not the misleading baseline)', async () => {
    const searchTurn = { intent: 'question', reply: 'Let me look that up.', action: null, confidence: 0.9, needsClarification: false, needsWebSearch: true, searchQuery: 'x' };
    const { engine, broadcast } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(searchTurn)),
      search: () => Promise.reject(new Error('openai_search_429')),
    });
    engine.startTurn('some live question', SID);
    await tick();
    await tick();
    expect(broadcast.mock.calls[0]![1].reply).toMatch(/couldn't find/i);
    expect(broadcast.mock.calls[0]![1].reply).not.toBe('Let me look that up.'); // not the baseline
  });

  it("intent='research' ALWAYS searches, even when the model leaves needsWebSearch=false (routing fix)", async () => {
    // The real bug: the model classifies a lookup ("top colleges", "latest news") as 'research' — an
    // ACTION intent — so the turn used to skip the search branch entirely and stop on "Let me look
    // that up…". Research must generate an answer via search.
    const researchTurn = {
      intent: 'research',
      reply: 'Let me look that up for the top colleges.',
      action: null,
      confidence: 0.9,
      needsClarification: false,
      needsWebSearch: false, // model did NOT set the flag — research routing must search anyway
      searchQuery: 'top engineering colleges in Himachal Pradesh',
    };
    const { engine, broadcast, search, onSearchStart } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(researchTurn)),
      search: () => Promise.resolve({ answer: 'NIT Hamirpur, IIT Mandi, JUIT.', citations: [{ title: 'x', url: 'https://x.example' }] }),
    });
    engine.startTurn('top engineering colleges in Himachal Pradesh', SID);
    await tick();
    await tick();
    expect(onSearchStart).toHaveBeenCalled(); // "Searching the web…" fires in BOTH surfaces
    expect(search).toHaveBeenCalled();
    const out = broadcast.mock.calls[0]![1];
    expect(out.reply).toContain('NIT Hamirpur'); // the searched answer …
    expect(out.reply).not.toBe('Let me look that up for the top colleges.'); // … NOT the dead-end acknowledgement
  });

  it('research intent wanting search but with NO provider gives an honest message, never a dead end', async () => {
    const researchTurn = {
      intent: 'research', reply: 'Let me look that up.', action: null, confidence: 0.9,
      needsClarification: false, needsWebSearch: false, searchQuery: null,
    };
    const { engine, broadcast } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(researchTurn)),
      // no `search` → provider is null (web search off)
    });
    engine.startTurn('latest AI news', SID);
    await tick();
    await tick();
    const reply = broadcast.mock.calls[0]![1].reply;
    expect(reply).toMatch(/web search is turned off/i);
    expect(reply).not.toBe('Let me look that up.'); // never strands on the acknowledgement
  });

  it('57: needsWebSearch with a NULL query still searches, using the user message', async () => {
    const searchTurn = { intent: 'question', reply: 'Let me look that up.', action: null, confidence: 0.9, needsClarification: false, needsWebSearch: true, searchQuery: null };
    const { engine, broadcast, search } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(searchTurn)),
      search: () => Promise.resolve({ answer: 'Found it.', citations: [] }),
    });
    engine.startTurn('GEC Kangra contact number', SID);
    await tick();
    await tick();
    expect(search!.mock.calls[0]![0]).toBe('GEC Kangra contact number'); // fell back to the user's text
    expect(broadcast.mock.calls[0]![1].reply).toBe('Found it.');
  });

  // The real-world failure: gpt-4o-mini writes "Let me look that up…" but leaves needsWebSearch FALSE,
  // so nothing searched and the user was stranded on that sentence. The reply-text heuristic fixes it.
  it('57: flag=false but the reply promises a lookup → still searches (no dead "let me look that up")', async () => {
    const strandedTurn = { intent: 'question', reply: 'Let me look that up for the contact details of NIT Hamirpur.', action: null, confidence: 0.9, needsClarification: false, needsWebSearch: false, searchQuery: null };
    const { engine, broadcast, search, onSearchStart } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(strandedTurn)),
      search: () => Promise.resolve({ answer: 'NIT Hamirpur: 01972-254001.', citations: [] }),
    });
    engine.startTurn('Tell me contact detail of NIT Hamirpur', SID);
    await tick();
    await tick();
    expect(search).toHaveBeenCalled(); // triggered by the reply text, NOT the flag
    expect(onSearchStart).toHaveBeenCalled(); // UI got the "Searching the web…" signal
    expect(broadcast.mock.calls[0]![1].reply).toBe('NIT Hamirpur: 01972-254001.'); // answer, not the promise
  });

  it('action intent the parser CANNOT handle → answers with the model reply, NOT the placeholder', async () => {
    const { engine, broadcast, onSpeak } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(ACTION)), // reply: 'ok'
      fallbackShell: PLACEHOLDER_SHELL, // parse null → the parser couldn't help
    });
    engine.startTurn('what does my grandmother have?', SID);
    await tick();
    await tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0]![1]).toEqual({ reply: 'ok', parse: null });
    expect(broadcast.mock.calls[0]![1].reply).not.toBe(PLACEHOLDER_SHELL.reply); // not the offline notice
    expect(onSpeak).toHaveBeenCalledWith('ok'); // spoken like any other answer
  });

  it('Gate-1 rejection (bad shape) → degrades; chat input gets the offline notice', async () => {
    const bad = { intent: 'not_a_real_intent', reply: 'x', action: null, confidence: 0.5, needsClarification: false };
    const { engine, broadcast, recordTurn } = makeEngine({
      provider: () => fakeProvider(() => Promise.resolve(bad)),
      fallbackShell: PLACEHOLDER_SHELL, // non-reminder → parse null → notice
    });
    engine.startTurn('tell me a joke', SID);
    await tick();
    await tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0]![1]).toEqual({ reply: OFFLINE_NOTICE, parse: null });
    expect(recorded(recordTurn)).toMatchObject({ assistantText: OFFLINE_NOTICE }); // records what was SHOWN
  });

  it('network error + reminder-shaped input → local parser result (byte-identical)', async () => {
    const { engine, broadcast } = makeEngine({
      provider: () => fakeProvider(() => Promise.reject(new Error('network_down'))),
      fallbackShell: REMINDER_SHELL, // reminder → parse present → returned as-is
    });
    engine.startTurn('remind me at 9am to stretch', SID);
    await tick();
    await tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0]![1]).toEqual(REMINDER_SHELL);
  });

  it('network error + chat input → the offline notice (never the raw error)', async () => {
    const { engine, broadcast } = makeEngine({
      provider: () => fakeProvider(() => Promise.reject(new Error('network_down'))),
      fallbackShell: PLACEHOLDER_SHELL,
    });
    engine.startTurn('who are you?', SID);
    await tick();
    await tick();
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0]![1]).toEqual({ reply: OFFLINE_NOTICE, parse: null });
  });

  it('retries once on a 429 then succeeds', async () => {
    let calls = 0;
    const { engine, broadcast } = makeEngine({
      provider: () =>
        fakeProvider(() => {
          calls += 1;
          return calls === 1 ? Promise.reject(new Error('openai_chat_429')) : Promise.resolve(REPLY_ONLY);
        }),
    });
    engine.startTurn('hi', SID);
    // one backoff (400ms) + microtasks
    await new Promise((r) => setTimeout(r, 500));
    expect(calls).toBe(2);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0]![1]).toEqual({ reply: 'Paris.', parse: null });
  });

  it('user cancel → aborts the turn and emits NO chat:done', async () => {
    const { engine, broadcast } = makeEngine({
      provider: () =>
        fakeProvider(
          (_input, signal) =>
            new Promise((_res, rej) => {
              signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
            }),
        ),
    });
    const turnId = engine.startTurn('a long question…', SID);
    await tick();
    engine.cancel(turnId);
    await tick();
    await tick();
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('ConversationEngine — timeout', () => {
  it('degrades after the 20s deadline and still emits exactly one chat:done', async () => {
    vi.useFakeTimers();
    try {
      const { engine, broadcast } = makeEngine({
        provider: () =>
          fakeProvider(
            (_input, signal) =>
              new Promise((_res, rej) => {
                signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
              }),
          ),
        fallbackShell: PLACEHOLDER_SHELL,
      });
      engine.startTurn('explain quantum computing', SID);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(broadcast).toHaveBeenCalledTimes(1);
      expect(broadcast.mock.calls[0]![1]).toEqual({ reply: OFFLINE_NOTICE, parse: null });
    } finally {
      vi.useRealTimers();
    }
  });
});
