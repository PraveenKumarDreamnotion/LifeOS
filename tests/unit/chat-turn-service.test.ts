import { describe, it, expect, beforeEach } from 'vitest';
import { ChatTurnService, CHAT_PLACEHOLDER } from '../../electron/main/chat/chat-turn-service';

// CONV: ChatTurnService is now PURE — it runs the local parser and returns a ShellTurn. It does
// NOT persist (the ConversationEngine owns the single faithful record). So these tests assert the
// parse/reply shaping only.
describe('ChatTurnService (local-parser fallback — no LLM, no persistence)', () => {
  let svc: ChatTurnService;
  beforeEach(() => {
    svc = new ChatTurnService();
  });

  it('a clear reminder → an ok proposal + "understood" reply', () => {
    const turn = svc.handleTurn('remind me in 10 minutes to drink water');
    expect(turn.parse?.ok).toBe(true);
    expect(turn.reply).toMatch(/understood/i);
  });

  it('an ambiguous time → a clarification carried in the proposal (no proposal.ok)', () => {
    const turn = svc.handleTurn('remind me at 5');
    expect(turn.parse).not.toBeNull();
    expect(turn.parse!.ok).toBe(false);
    if (!turn.parse!.ok) expect(turn.parse!.kind).toBe('clarification');
  });

  it('a non-reminder → the honest placeholder, no proposal', () => {
    const turn = svc.handleTurn('what is the capital of France');
    expect(turn.parse).toBeNull();
    expect(turn.reply).toBe(CHAT_PLACEHOLDER);
  });
});
