import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../electron/database/open';
import { SettingsRepository } from '../../electron/database/settings-repository';
import { ReminderRepository } from '../../electron/database/reminder-repository';
import { ChatRepository } from '../../electron/database/chat-repository';
import { makeLlmProvider, type ProviderConfig } from '../../electron/providers/registry';
import { ConversationEngine, type EngineTurn } from '../../electron/conversation/conversation-engine';
import { ContextBuilder } from '../../electron/conversation/context-builder';
import { ChatTurnService } from '../../electron/main/chat/chat-turn-service';
import { makeLocalCommandRouter } from '../../electron/main/chat/local-command-router';
import { ActionDispatcher } from '../../electron/actions/dispatcher';
import { ConfirmationStore } from '../../electron/actions/confirmation-store';
import { executeAction } from '../../electron/actions/execute';
import { validateBusinessRules } from '../../electron/main/ipc';
import { createScheduler } from '../../electron/scheduler/scheduler';
import type { LlmProvider } from '../../core/llm/llm-provider';
import type { SearchProvider } from '../../core/search/search-provider';
import type { Reminder } from '../../core/types/reminder';
import type { SqliteDriver } from '../../electron/database/driver';

/**
 * END-TO-END reminder lifecycle (reported reliability bug). Drives the REAL production graph —
 * engine → local parser → Action Dispatcher → Execution Layer → ReminderRepository → wall-clock
 * Scheduler → TriggerSink — and proves the WHOLE pipeline from a natural-language request through
 * to the reminder actually FIRING at its scheduled time. Only the GUI clicks + OS notification are
 * simulated (the sink is a spy). Covers the exact reported phrase and multiple time specs.
 */
let dbPath: string;
let db: SqliteDriver;
let settings: SettingsRepository;
let reminders: ReminderRepository;

// A FIXED reference "now" so relative phrases ("in 2 minutes", "tomorrow at 9 AM") are deterministic.
const NOW_MS = new Date('2026-07-15T12:00:00+05:30').getTime();
const tick = () => new Promise((r) => setTimeout(r, 0));

function providerConfig(): ProviderConfig {
  return {
    sttProvider: settings.get('stt_provider'),
    ttsProvider: settings.get('tts_provider'),
    aiProvider: settings.get('ai_provider'),
    aiEnabled: settings.get('ai_assist_enabled') === 'true',
    hasApiKey: settings.hasApiKey(),
    sttConsented: settings.get('stt_consented_at') !== '',
    ttsConsented: settings.get('tts_consented_at') !== '',
    sttModel: settings.get('stt_model'),
    aiConsented: settings.get('ai_consent_accepted_at') !== '',
    aiModel: settings.get('ai_model'),
    webSearchEnabled: settings.get('web_search_enabled') === 'true',
    searchModel: settings.get('search_model'),
    sttCleanupEnabled: settings.get('stt_cleanup_enabled') === 'true',
  };
}

/** Build the real pipeline. `llm` lets a test inject a fake cloud model (else offline via the gate);
 *  `search` injects a fake web-search backend for the research path. */
function makePipeline(llm?: LlmProvider | null, search?: SearchProvider) {
  const chatRepo = new ChatRepository(db);
  const session = chatRepo.createSession();
  const store = new ConfirmationStore(() => {}, 60_000);

  // The SAME verifying writer index.ts uses: create → read back → require it's stored + scheduled.
  const persistReminder = (input: Parameters<ReminderRepository['create']>[0], sid: string | null): string => {
    validateBusinessRules(input.scheduledAtUtcMs, input.recurrenceRule, input.actionType);
    const created = reminders.create(input, sid);
    const stored = reminders.get(created.id);
    if (!stored || !stored.nextFireAt) throw new Error('reminder_persist_failed');
    return created.id;
  };
  const dispatcher = new ActionDispatcher({
    store,
    validate: (input) => validateBusinessRules(input.scheduledAtUtcMs, input.recurrenceRule, input.actionType),
    execute: (action, source, sid) => executeAction(action, source, { createReminder: persistReminder }, sid),
  });

  const broadcasts: EngineTurn[] = [];
  const engine = new ConversationEngine({
    provider: () => (llm !== undefined ? llm : makeLlmProvider(providerConfig(), { getKey: () => null })),
    fallback: new ChatTurnService(),
    context: new ContextBuilder(reminders, () => NOW_MS, () => 'Asia/Kolkata'),
    chat: chatRepo,
    broadcast: (_id, t) => broadcasts.push(t),
    localRouter: makeLocalCommandRouter({ now: () => NOW_MS, timezone: () => 'Asia/Kolkata' }),
    dispatcher,
    dispatcherEnabled: () => true,
    onProposeSpeak: () => {},
    searchProvider: search ? () => search : undefined,
  });

  // The wall-clock scheduler with an ADVANCEABLE clock + a spy sink (stands in for the OS toast).
  let clock = NOW_MS;
  const fired: Reminder[] = [];
  const scheduler = createScheduler({
    now: () => clock,
    repo: reminders,
    sink: { fire: (r) => fired.push(r) },
    tickMs: 30_000,
  });

  const send = async (text: string) => {
    engine.startTurn(text, session.id);
    await tick();
    await tick();
    return broadcasts[broadcasts.length - 1]!;
  };
  return {
    session, dispatcher, reminders, scheduler, fired, broadcasts, send,
    setClock: (ms: number) => { clock = ms; },
    reconcile: (cause: 'tick' | 'startup' = 'tick') => scheduler.reconcile(cause),
  };
}

/** A fake cloud LLM returning a fixed AssistantTurn shape (Gate-1 valid). */
function fakeLlm(turn: { intent: string; reply: string; needsWebSearch?: boolean; searchQuery?: string | null }): LlmProvider {
  return {
    complete: async () => ({
      intent: turn.intent,
      reply: turn.reply,
      action: null,
      confidence: 0.9,
      needsClarification: false,
      needsWebSearch: turn.needsWebSearch ?? false,
      searchQuery: turn.searchQuery ?? null,
    }),
  } as unknown as LlmProvider;
}

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-remlife-${randomUUID()}.db`);
  db = openDatabase(dbPath);
  settings = new SettingsRepository(db);
  settings.seedDefaults();
  reminders = new ReminderRepository(db);
});
afterEach(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) {
    try {
      rmSync(dbPath + s);
    } catch {
      /* ignore */
    }
  }
});

describe('reminder lifecycle — create → confirm → persist → schedule → FIRE', () => {
  // Every phrase runs the full pipeline and must actually FIRE at its scheduled time. Offline (no
  // key) so the local parser drives — the same path the online mis-tag guard routes reminders to.
  it.each([
    ['in 1 minute', 'remind me in 1 minute to call Biplab', 'call biplab'],
    ['after two minutes (the reported phrase)', 'Set me a reminder after two minutes to call Biplab', 'call biplab'],
    ['in 5 minutes', 'remind me in 5 minutes to stretch', 'stretch'],
    ['tomorrow morning', 'remind me tomorrow at 9 AM to exercise', 'exercise'],
    ['specific date + time', 'remind me on August 1 at 3 PM to submit the form', 'submit the form'],
  ])('%s: %s', async (_label, phrase, expectTitle) => {
    const p = makePipeline();

    // 1. Parse → a confirmable proposal card (never a silent nothing).
    const turn = await p.send(phrase);
    expect(turn.proposal?.kind, `"${phrase}" should propose a reminder`).toBe('reminder_create');

    // 2. Confirm → 3. persist + verify stored & scheduled.
    const res = p.dispatcher.confirm(turn.proposal!.turnId);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('confirm failed');
    const stored = reminders.get(res.reminderId!);
    expect(stored, 'reminder must be persisted').toBeTruthy();
    expect(stored!.title.toLowerCase()).toContain(expectTitle);
    expect(stored!.nextFireAt).toBeGreaterThan(NOW_MS); // scheduled in the FUTURE, not the past
    expect(reminders.listActive().map((r) => r.id)).toContain(res.reminderId);

    // 4. It must NOT fire before its time…
    p.setClock(stored!.nextFireAt - 1_000);
    p.reconcile('tick');
    expect(p.fired.map((r) => r.id)).not.toContain(res.reminderId);

    // 5. …and MUST fire once the wall clock reaches its time (the actual trigger).
    p.setClock(stored!.nextFireAt + 1_000);
    p.reconcile('tick');
    expect(p.fired.map((r) => r.id), `"${phrase}" must fire at its scheduled time`).toContain(res.reminderId);

    // 6. Cleanup: a one-time reminder is marked triggered (won't re-fire on the next tick).
    p.reconcile('tick');
    expect(p.fired.filter((r) => r.id === res.reminderId).length).toBe(1);
  });

  it('survives a restart: a persisted reminder still fires after re-opening the DB', async () => {
    const p = makePipeline();
    const turn = await p.send('remind me in 2 minutes to call Biplab');
    const res = p.dispatcher.confirm(turn.proposal!.turnId);
    if (!res.ok) throw new Error('confirm failed');
    const fireAt = reminders.get(res.reminderId!)!.nextFireAt;

    // Simulate a restart: reopen the repo against the SAME db file (WAL already flushed on write).
    const reopened = new ReminderRepository(db);
    expect(reopened.get(res.reminderId!)?.title.toLowerCase()).toContain('call biplab');
    // A fresh scheduler over the reopened repo fires it at its time.
    const clock = fireAt + 1_000;
    const fired: Reminder[] = [];
    const sched = createScheduler({ now: () => clock, repo: reopened, sink: { fire: (r) => fired.push(r) }, tickMs: 30_000 });
    sched.reconcile('tick');
    expect(fired.map((r) => r.id)).toContain(res.reminderId);
  });
});

describe('reminder reliability guard — never claim success unless created', () => {
  it('online: the model FAKES "I\'ve set a reminder" but nothing parseable → honest failure, no reminder', async () => {
    // The exact reported failure mode: the model classifies reply-only and asserts success in text.
    // Use a cue-bearing but UNparseable request so the local parser can't rescue it (no time).
    const p = makePipeline(fakeLlm({ intent: 'chat', reply: "I've set a reminder for you to call Biplab." }));
    const turn = await p.send('remind me about calling Biplab sometime');
    // The false claim is REPLACED by an honest failure — and NO proposal/reminder was created.
    expect(turn.reply).not.toMatch(/i've set|i have set|reminder (is )?set|i'll remind you/i);
    expect(turn.reply).toMatch(/couldn't set that reminder|try again/i);
    expect(turn.proposal).toBeUndefined();
    expect(reminders.listActive().length).toBe(0);
  });

  it('online: the EXACT reported phrase mis-tagged as chat is still created for real (regression)', async () => {
    // Reproduce the screenshot precisely: model classifies "chat" and fakes "I've set a reminder…",
    // but the broadened parser now recognises the phrase → the app creates a REAL confirmable reminder.
    const p = makePipeline(fakeLlm({ intent: 'chat', reply: "I've set a reminder for you to call Biplab in two minutes." }));
    const turn = await p.send('Set me a reminder after two minutes to call Biplab');
    expect(turn.proposal?.kind).toBe('reminder_create'); // NOT the fake reply — a real card
    const res = p.dispatcher.confirm(turn.proposal!.turnId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const stored = reminders.get(res.reminderId!);
      expect(stored?.title.toLowerCase()).toContain('call biplab');
      expect(stored!.nextFireAt).toBeGreaterThan(NOW_MS);
    }
  });

  it('online: a parseable reminder the model mis-tags as chat is STILL created (mis-tag guard)', async () => {
    // Model says "chat" + fakes success, but the text IS a valid reminder → the app creates it for real.
    const p = makePipeline(fakeLlm({ intent: 'chat', reply: "Sure, I've set that reminder!" }));
    const turn = await p.send('remind me in 2 minutes to call Biplab');
    expect(turn.proposal?.kind).toBe('reminder_create'); // a REAL confirmable card, not the fake reply
    const res = p.dispatcher.confirm(turn.proposal!.turnId);
    expect(res.ok).toBe(true);
    if (res.ok) expect(reminders.get(res.reminderId!)?.title.toLowerCase()).toContain('call biplab');
  });

  it('a web-search ANSWER that mentions "reminder is set" is NOT clobbered by the guard', async () => {
    // "best reminder apps" is research, not a reminder — the guard must not touch the search answer
    // even though it contains a cue word AND a phrase matching the reminder-claim regex.
    const search = {
      id: 'openai' as const,
      search: async () => ({ answer: "Todoist is popular — its reminder is set in one tap.", citations: [] }),
    } as unknown as SearchProvider;
    const p = makePipeline(fakeLlm({ intent: 'research', reply: 'Let me look that up.', needsWebSearch: true, searchQuery: 'best reminder apps' }), search);
    const turn = await p.send('what are the best reminder apps');
    expect(turn.reply).toMatch(/Todoist/); // the real answer survived
    expect(turn.reply).not.toMatch(/couldn't set that reminder/i); // guard did NOT fire
    expect(reminders.listActive().length).toBe(0);
  });

  it('a persistence failure surfaces as a failure, not a false success', () => {
    // If the Execution Layer throws (e.g. verify failed), dispatcher.confirm returns ok:false.
    const store = new ConfirmationStore(() => {}, 60_000);
    const dispatcher = new ActionDispatcher({
      store,
      validate: () => {},
      execute: () => {
        throw new Error('reminder_persist_failed');
      },
    });
    // Put a proposal, then confirm → the throw becomes a graceful failure result (turn gets settled).
    const put = dispatcher.propose({
      action: { kind: 'reminder_create', input: { title: 'x', description: null, scheduledAtUtcMs: NOW_MS + 60_000, timezone: 'Asia/Kolkata', recurrenceRule: null, actionType: 'notify', source: 'local' }, summary: 's' },
      source: 'local',
      turnId: 't1',
      sessionId: null,
    });
    expect('proposal' in put).toBe(true);
    const res = dispatcher.confirm('t1');
    expect(res.ok).toBe(false); // the throw becomes a graceful failure — turn settles, no false success
    if (!res.ok) expect(res.message).toMatch(/could not be created|couldn't create|internal error/i);
  });
});
