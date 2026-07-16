import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../electron/database/open';
import { SettingsRepository } from '../../electron/database/settings-repository';
import { ReminderRepository } from '../../electron/database/reminder-repository';
import { ChatRepository } from '../../electron/database/chat-repository';
import { makeLlmProvider } from '../../electron/providers/registry';
import { ConversationEngine, type EngineTurn } from '../../electron/conversation/conversation-engine';
import { ContextBuilder } from '../../electron/conversation/context-builder';
import { ChatTurnService } from '../../electron/main/chat/chat-turn-service';
import { makeLocalCommandRouter } from '../../electron/main/chat/local-command-router';
import type { SqliteDriver } from '../../electron/database/driver';

/**
 * The user's EXACT offline phrase list, driven through the REAL production engine (no key). This is
 * the actual runtime path (chat + voice both funnel through this engine). Asserts that NONE of the
 * reminder/command phrases reach the "needs an online AI provider" notice — only genuine reasoning does.
 */
let db: SqliteDriver;
let dbPath: string;
let settings: SettingsRepository;
let reminders: ReminderRepository;
const NOW = () => new Date('2026-07-14T10:00:00+05:30').getTime();
const tick = () => new Promise((r) => setTimeout(r, 0));

function realEngine() {
  const chatRepo = new ChatRepository(db);
  const session = chatRepo.createSession();
  const broadcasts: EngineTurn[] = [];
  const engine = new ConversationEngine({
    provider: () => makeLlmProvider(
      { sttProvider: 'sherpa-onnx', ttsProvider: 'web-speech', aiProvider: 'openai', aiEnabled: false, hasApiKey: settings.hasApiKey(), sttConsented: false, ttsConsented: false, sttModel: '', aiConsented: false, aiModel: 'gpt-4o-mini', webSearchEnabled: false, searchModel: '', sttCleanupEnabled: false },
      { getKey: () => null },
    ),
    fallback: new ChatTurnService(),
    context: new ContextBuilder(reminders, NOW, () => 'Asia/Kolkata'),
    chat: chatRepo,
    broadcast: (_id, turn) => broadcasts.push(turn),
    localRouter: makeLocalCommandRouter({ now: NOW, timezone: () => 'Asia/Kolkata' }),
  });
  const send = async (text: string) => {
    engine.startTurn(text, session.id);
    await tick();
    await tick();
    return broadcasts[broadcasts.length - 1]!;
  };
  return { send };
}

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-phrases-${randomUUID()}.db`);
  db = openDatabase(dbPath);
  settings = new SettingsRepository(db);
  settings.seedDefaults(); // NO key
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

const AI_REQUIRED = /needs an online AI provider/i;

describe("user's offline phrase list — none reach the AI-required notice", () => {
  // Fully-specified: must produce a reminder CARD (parse.ok), never AI-required.
  it.each([
    'After one minute remind me to call Biplub',
    'Remind me to call Biplub after one minute',
    'remind me tomorrow at 9 AM to call John',
    'remind me every Monday at 9 AM to exercise',
    'ping me in 5 minutes to stretch', // classifier + parser must AGREE (no "remind" keyword)
    'wake me at 7 AM to jog',
    // Reminder-as-a-NOUN command (the exact reported failure): "set reminder" (no article),
    // "add/create reminder", noun-led. These must create a card, not the AI-required notice.
    'Set reminder after one minute to call Biplab',
    'set reminder tomorrow at 9 AM to call John',
    'add a reminder tomorrow at 9 AM to drink water',
    'create reminder tomorrow at 9 AM to exercise',
    // Verb + PRONOUN + "after" (the exact reported bug: parser refused these, so Yogi faked success).
    'Set me a reminder after two minutes to call Biplab',
    'set me a reminder in 5 minutes to call John',
    'give me a reminder in 2 minutes to stretch',
    'make me a reminder for tomorrow at 9 AM to exercise',
  ])('creates a reminder card: %s', async (phrase) => {
    const { send } = realEngine();
    const turn = await send(phrase);
    expect(turn.reply).not.toMatch(AI_REQUIRED);
    expect(turn.parse?.ok).toBe(true);
  });

  // STT-corrupted reminder cues (real transcripts from offline dictation) must ALSO route to the
  // reminder flow locally, never the AI-required notice.
  it.each([
    'it remained me in one minute', // "remind" → "remained"
    'IT REMAINED ME IN ONE MINUTE',
    'remains me to call John', // "remind" → "remains"
    'it remind me in one minute', // leading "it"
    'who remind me after one minute', // leading "who"
    'remained me to drink water',
  ])('STT-corrupted cue routes to the reminder flow, not AI-required: %s', async (phrase) => {
    const { send } = realEngine();
    expect((await send(phrase)).reply).not.toMatch(AI_REQUIRED);
  });

  // Under-specified: a LOCAL clarification (never AI-required) — the flow completes on the follow-up.
  it.each([
    'remind me in one minute',
    'remind me after one minute',
    'after one minute remind me',
    'remind me tomorrow at 9',
    'remind me every Monday',
    'in five minutes remind me',
    'remind me to call John',
    'remind me to drink water',
  ])('asks a LOCAL clarification (not AI-required): %s', async (phrase) => {
    const { send } = realEngine();
    const turn = await send(phrase);
    expect(turn.reply).not.toMatch(AI_REQUIRED);
    expect(turn.parse && turn.parse.ok === false ? turn.parse.kind : 'ok-or-null').toBe('clarification');
  });

  it('local commands are answered locally (not AI-required)', async () => {
    const { send } = realEngine();
    expect((await send('what time is it')).reply).not.toMatch(AI_REQUIRED);
    expect((await send('open settings')).reply).not.toMatch(AI_REQUIRED);
  });

  it('a bare greeting with a name ("Hey Yogi") is answered locally, not AI-required', async () => {
    const { send } = realEngine();
    expect((await send('Hey Yogi.')).reply).not.toMatch(AI_REQUIRED);
    expect((await send('Hi Yogi')).reply).not.toMatch(AI_REQUIRED);
  });

  it('ONLY genuine reasoning requires an online provider', async () => {
    const { send } = realEngine();
    expect((await send('Explain quantum computing')).reply).toMatch(AI_REQUIRED);
  });

  // Issue 6 — natural-language reminder examples. Cued phrases (with a reminder verb / "don't forget")
  // work OFFLINE with word-order and slop tolerance and DO NOT require a specific sentence structure.
  // A verb-LESS implicit reminder ("I need to call John…") has no cue, so offline it is (correctly)
  // NOT force-matched as a reminder — that's the LLM's job with a key. This documents the boundary.
  describe('Issue 6 — natural-language reminder phrasing', () => {
    it.each([
      'Remind me tomorrow at 5',
      "Don't let me forget my meeting on Friday",
      'Remind me this evening to call John', // natural word order, cued
    ])('cued natural phrasing routes to the local reminder flow (offline): %s', async (phrase) => {
      const { send } = realEngine();
      expect((await send(phrase)).reply).not.toMatch(AI_REQUIRED);
    });

    it('a verb-LESS implicit reminder needs the online LLM offline (documents the boundary)', async () => {
      const { send } = realEngine();
      // No reminder cue → offline this is genuine reasoning, so it honestly asks for a provider.
      // With an OpenAI key the LLM interprets it as a reminder intent (covered by the engine tests).
      expect((await send('I need to call John this evening')).reply).toMatch(AI_REQUIRED);
    });
  });
});
