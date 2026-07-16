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
import type { SqliteDriver } from '../../electron/database/driver';

/**
 * REAL-WIRING offline verification (the user's doubt): construct the production graph the way
 * index.ts does — a real SQLite DB with NO API key, the real provider gate (makeLlmProvider), the
 * real ConversationEngine + capability router + local parser + repositories — and prove that with no
 * key the app is fully offline yet local commands and reminder creation work end-to-end. This is the
 * pipeline the chat/voice paths run through; only the GUI clicks are absent.
 */
let dbPath: string;
let db: SqliteDriver;
let settings: SettingsRepository;
let reminders: ReminderRepository;

const NOW = () => new Date('2026-07-14T10:00:00+05:30').getTime();
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Exactly index.ts's providerConfig(), read from the real SettingsRepository. */
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

function makeRealEngine() {
  const chatRepo = new ChatRepository(db);
  const session = chatRepo.createSession();
  const broadcasts: { turnId: string; turn: EngineTurn }[] = [];
  const engine = new ConversationEngine({
    provider: () => makeLlmProvider(providerConfig(), { getKey: () => null }), // no key → null
    fallback: new ChatTurnService(),
    context: new ContextBuilder(reminders, NOW, () => 'Asia/Kolkata'),
    chat: chatRepo,
    broadcast: (turnId, turn) => broadcasts.push({ turnId, turn }),
    localRouter: makeLocalCommandRouter({ now: NOW, timezone: () => 'Asia/Kolkata' }),
  });
  const send = async (text: string) => {
    engine.startTurn(text, session.id);
    await tick();
    await tick();
  };
  return { engine, send, broadcasts, sessionId: session.id, last: () => broadcasts[broadcasts.length - 1]!.turn };
}

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-offwire-${randomUUID()}.db`);
  db = openDatabase(dbPath);
  settings = new SettingsRepository(db);
  settings.seedDefaults(); // fresh install: no key, STT offline default
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

describe('offline wiring — no API key, real production graph', () => {
  it('the real provider gate returns NO LLM when there is no key (app is offline)', () => {
    expect(settings.hasApiKey()).toBe(false);
    expect(makeLlmProvider(providerConfig(), { getKey: () => null })).toBeNull();
  });

  it('a local command is answered locally — never "Connect OpenAI…"', async () => {
    const h = makeRealEngine();
    await h.send('what time is it');
    expect(h.last().reply).not.toMatch(/OpenAI/);
    expect(h.last().reply).toMatch(/\d/);
    await h.send('hello');
    expect(h.last().reply).not.toMatch(/OpenAI/);
  });

  it('reminder creation works completely offline: parse → persist → schedulable', async () => {
    const h = makeRealEngine();
    // A fully specified reminder parses to an ok card offline (no LLM involved).
    await h.send('remind me tomorrow at 9 AM to call John');
    const turn = h.last();
    expect(turn.reply).not.toMatch(/OpenAI/);
    expect(turn.parse?.ok).toBe(true);
    if (!turn.parse?.ok) throw new Error('expected a parsed reminder');

    // Confirm = the renderer's ipc.createReminder path → the SAME repo writer.
    const r = turn.parse.reminder;
    const created = reminders.create({
      title: r.title,
      description: r.description,
      scheduledAtUtcMs: r.scheduledAtUtcMs,
      timezone: r.timezone,
      recurrenceRule: r.recurrenceRule,
      actionType: r.actionType,
      source: 'local',
    });
    expect(created.title.toLowerCase()).toContain('call john');
    expect(reminders.listActive().map((x) => x.id)).toContain(created.id);
    // The scheduler would fire it: findDue at/after its time returns it.
    expect(reminders.findDue(created.nextFireAt).map((x) => x.id)).toContain(created.id);
  });

  it('a recurring reminder persists with its RRULE offline', async () => {
    const h = makeRealEngine();
    await h.send('remind me every Monday at 9 AM to exercise');
    const turn = h.last();
    expect(turn.parse?.ok).toBe(true);
    if (!turn.parse?.ok) throw new Error('expected a parsed reminder');
    expect(turn.parse.reminder.recurrenceRule).toMatch(/FREQ=WEEKLY;BYDAY=MO/);
    const created = reminders.create({
      title: turn.parse.reminder.title,
      description: null,
      scheduledAtUtcMs: turn.parse.reminder.scheduledAtUtcMs,
      timezone: turn.parse.reminder.timezone,
      recurrenceRule: turn.parse.reminder.recurrenceRule,
      actionType: 'notify',
      source: 'local',
    });
    expect(reminders.get(created.id)?.recurrenceRule).toMatch(/FREQ=WEEKLY;BYDAY=MO/);
  });

  it('genuine reasoning offline gets the honest notice, not a fake answer', async () => {
    const h = makeRealEngine();
    await h.send('write me a poem about the sea');
    expect(h.last().reply).toMatch(/offline|reminder|AI provider/i);
    expect(h.last().parse).toBeNull();
  });

  it('DECOUPLED from AI Chat: reminders work with AI Assist OFF but an API key present (reported config)', async () => {
    // The exact screenshot config: key saved, "Chat & answers (AI Assist)" OFF, cloud STT on.
    settings.set('ai_key_ciphertext', 'x'.repeat(40)); // hasApiKey → true
    settings.set('ai_assist_enabled', 'false'); // AI Chat OFF
    settings.set('stt_provider', 'openai'); // cloud STT (irrelevant to routing/parsing)
    expect(settings.hasApiKey()).toBe(true);
    expect(providerConfig().aiEnabled).toBe(false);
    // No LLM is resolved (routing stays LOCAL) even though a key is present — reminders are NOT
    // coupled to AI Chat.
    expect(makeLlmProvider(providerConfig(), { getKey: () => 'sk' })).toBeNull();

    const h = makeRealEngine();
    await h.send('Set reminder after one minute to call Biplab'); // the exact failing phrase
    const turn = h.last();
    expect(turn.reply).not.toMatch(/needs an online AI provider/i); // NOT the AI notice
    expect(turn.parse?.ok).toBe(true); // a real reminder card, created locally
    if (turn.parse?.ok) expect(turn.parse.reminder.title.toLowerCase()).toContain('call biplab');
  });

  it('COMPLETE offline flow: dictate → dispatcher proposal → confirm → reminder persisted', async () => {
    // Wire the REAL dispatcher exactly as index.ts does, with the offline engine (no LLM).
    const chatRepo = new ChatRepository(db);
    const session = chatRepo.createSession();
    const store = new ConfirmationStore(() => {}, 60_000);
    const dispatcher = new ActionDispatcher({
      store,
      validate: (input) => validateBusinessRules(input.scheduledAtUtcMs, input.recurrenceRule, input.actionType),
      execute: (action, source, sessionId) =>
        executeAction(action, source, { createReminder: (input, sid) => reminders.create(input, sid).id }, sessionId),
    });
    const broadcasts: EngineTurn[] = [];
    let proposeSpoken: string | null = null;
    const engine = new ConversationEngine({
      provider: () => makeLlmProvider(providerConfig(), { getKey: () => null }), // OFFLINE
      fallback: new ChatTurnService(),
      context: new ContextBuilder(reminders, NOW, () => 'Asia/Kolkata'),
      chat: chatRepo,
      broadcast: (_id, t) => broadcasts.push(t),
      localRouter: makeLocalCommandRouter({ now: NOW, timezone: () => 'Asia/Kolkata' }),
      dispatcher,
      dispatcherEnabled: () => true,
      onProposeSpeak: (s) => (proposeSpoken = s),
    });

    // A future-dated, fully specified reminder (relative to NOW = 2026-07-14 10:00 IST).
    engine.startTurn('remind me tomorrow at 9 AM to call John', session.id);
    await tick();
    await tick();

    const turn = broadcasts[broadcasts.length - 1]!;
    expect(turn.proposal?.kind).toBe('reminder_create'); // a confirmable card, offline
    expect(proposeSpoken).toBeTruthy(); // spoken confirm prompt → voice-confirm works offline

    // Confirm (button click OR spoken "yes" both call dispatcher.confirm(turnId)).
    const res = dispatcher.confirm(turn.proposal!.turnId);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('confirm failed');
    // The reminder is now persisted and schedulable — fully offline, no key.
    const created = reminders.get(res.reminderId!);
    expect(created?.title.toLowerCase()).toContain('call john');
    expect(reminders.listActive().map((r) => r.id)).toContain(res.reminderId);
  });
});
