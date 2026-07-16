import { describe, it, expect, vi } from 'vitest';
import { ConversationEngine, type EngineTurn } from '../../electron/conversation/conversation-engine';
import { ContextBuilder } from '../../electron/conversation/context-builder';
import { ChatTurnService } from '../../electron/main/chat/chat-turn-service';
import { makeLocalCommandRouter } from '../../electron/main/chat/local-command-router';
import type { LlmProvider } from '../../core/llm/llm-provider';

const SID = '00000000-0000-4000-8000-000000000001';
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A real engine with the capability router wired as in index.ts, an in-memory chat store (so a
 *  follow-up turn sees prior turns via recentTurns), and an optional LLM provider (null = offline). */
function makeEngine(provider: () => LlmProvider | null = () => null) {
  const turns: { userText: string; assistantText: string; kind: 'chat' | 'reminder' }[] = [];
  const broadcasts: { turnId: string; turn: EngineTurn }[] = [];
  const spoken: string[] = [];
  const now = () => new Date('2026-07-14T10:00:00+05:30').getTime();
  const engine = new ConversationEngine({
    provider,
    fallback: new ChatTurnService(),
    context: new ContextBuilder({ listActive: () => [] }, now, () => 'Asia/Kolkata'),
    chat: {
      recentTurns: (_sid, limit) => turns.slice(-limit),
      recordTurn: (input) => turns.push({ userText: input.userText, assistantText: input.assistantText, kind: 'chat' }),
    },
    broadcast: (turnId, turn) => broadcasts.push({ turnId, turn }),
    onSpeak: (t) => spoken.push(t),
    localRouter: makeLocalCommandRouter({ now, timezone: () => 'Asia/Kolkata' }),
  });
  const send = async (text: string) => {
    engine.startTurn(text, SID);
    await tick();
    await tick();
  };
  return { engine, send, broadcasts, spoken, last: () => broadcasts[broadcasts.length - 1]!.turn };
}
const offlineEngine = () => makeEngine(() => null);

describe('offline routing — capability-first', () => {
  it('local command "what time is it" is answered locally (no OpenAI placeholder)', async () => {
    const h = offlineEngine();
    await h.send('what time is it');
    expect(h.last().reply).not.toMatch(/OpenAI/);
    expect(h.last().reply).toMatch(/\d/); // contains a time
  });

  it('greeting "hello" gets a local reply offline (not the OpenAI placeholder)', async () => {
    const h = offlineEngine();
    await h.send('hello');
    expect(h.last().reply).not.toMatch(/OpenAI/);
  });

  it('two-turn reminder: clarification then answer COMPLETES the reminder offline', async () => {
    const h = offlineEngine();
    await h.send('remind me to drink water'); // → clarification (no time)
    expect(h.broadcasts[0]!.turn.parse?.ok).not.toBe(true); // first turn is a clarification, not ok

    await h.send('tomorrow at 9 AM'); // the follow-up answer
    const turn2 = h.last();
    // DESIRED: the follow-up combines with the prior clarification → a valid reminder card, NOT the
    // "Connect OpenAI" placeholder.
    expect(turn2.reply).not.toMatch(/OpenAI/);
    expect(turn2.parse?.ok).toBe(true);
    if (turn2.parse?.ok) expect(turn2.parse.reminder.title.toLowerCase()).toContain('drink water');
  });

  it('a genuine reasoning question offline gets an HONEST message that names what works offline', async () => {
    const h = offlineEngine();
    await h.send('explain how photosynthesis works');
    const reply = h.last().reply;
    expect(reply).toMatch(/reminder|offline|time/i); // says what DOES work offline
    expect(h.last().parse).toBeNull();
  });

  it('RECURRING reminder completes offline across turns (recurrence + title stay clean)', async () => {
    const h = offlineEngine();
    await h.send('remind me every Monday'); // → clarification (needs a time)
    await h.send('at 9 AM'); // still no title → clarification
    await h.send('exercise'); // the title — should now complete the weekly reminder
    const turn = h.last();
    expect(turn.reply).not.toMatch(/OpenAI/);
    expect(turn.parse?.ok).toBe(true);
    if (turn.parse?.ok) {
      const r = turn.parse.reminder;
      expect(r.recurrenceRule).toMatch(/FREQ=WEEKLY;BYDAY=MO/); // recurrence survived the accumulate
      expect(r.title.toLowerCase()).toBe('exercise'); // no "every Monday"/"9 AM" leaked into the title
    }
  });
});

describe('online + router composition — no regression to LLM turns', () => {
  const REPLY_ONLY = { intent: 'question', reply: 'Paris.', action: null, confidence: 0.9, needsClarification: false, needsWebSearch: false, searchQuery: null };
  const fakeLlm = (complete: LlmProvider['complete']): LlmProvider => ({ id: 'openai', isLocal: false, supportsStreaming: false, complete });

  it('a deterministic local command is answered locally even when an LLM IS available (hybrid)', async () => {
    const complete = vi.fn(async () => REPLY_ONLY);
    const h = makeEngine(() => fakeLlm(complete));
    await h.send('what time is it');
    expect(h.last().reply).toMatch(/\d/); // local time answer
    expect(complete).not.toHaveBeenCalled(); // the LLM was NOT called
  });

  it('a genuine question still reaches the LLM when online (router does not swallow it)', async () => {
    const complete = vi.fn(async () => REPLY_ONLY);
    const h = makeEngine(() => fakeLlm(complete));
    await h.send('what is the capital of France');
    expect(complete).toHaveBeenCalledTimes(1); // reached the model
    expect(h.last().reply).toBe('Paris.');
  });

  it('a greeting reaches the LLM online (warmth preserved) but is local offline', async () => {
    const complete = vi.fn(async () => ({ ...REPLY_ONLY, intent: 'chat', reply: 'Hey there!' }));
    const online = makeEngine(() => fakeLlm(complete));
    await online.send('hello');
    expect(complete).toHaveBeenCalledTimes(1); // online greeting → LLM
    expect(online.last().reply).toBe('Hey there!');
  });
});
