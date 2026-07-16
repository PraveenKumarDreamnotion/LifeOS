import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConversation } from '../../src/features/chat/useConversation';
import type { ParsedReminder } from '../../core/parsing/types';
import type { ShellTurn } from '../../core/types/chat';

const reminder: ParsedReminder = {
  intent: 'create_reminder',
  title: 'Drink water',
  description: null,
  scheduledAtUtcMs: Date.now() + 600_000,
  scheduledAtIso: new Date(Date.now() + 600_000).toISOString(),
  timezone: 'Asia/Kolkata',
  recurrenceRule: null,
  actionType: 'notify',
  confidence: 0.9,
  source: 'local',
  matchedDateText: 'in 10 minutes',
};

const create = vi.fn();
const onDone = vi.fn();
const actionConfirm = vi.fn();
const actionCancel = vi.fn();

// EP-5: chat:send is async — it returns { turnId } and the ShellTurn arrives on the chat:done
// broadcast. This harness models the preload bridge: send() returns a turnId and then fires the
// registered onDone callback with { turnId, ...nextShell, proposal? }, exactly as main does.
type DonePayload = { turnId: string } & ShellTurn & { proposal?: { turnId: string; kind: string; summary: string } };
let doneCb: ((p: DonePayload) => void) | null = null;
let resolvedCb: ((p: { turnId: string; status: 'executed' | 'cancelled'; summary?: string }) => void) | null = null;
let appendedCb: ((p: { sessionId: string; turn: unknown }) => void) | null = null;
let turnCounter = 0;
let nextShell: ShellTurn = { reply: '', parse: null };
let nextProposal: { turnId: string; kind: string; summary: string } | undefined;

const send = vi.fn((_text: string) => {
  const turnId = `t${++turnCounter}`;
  const proposal = nextProposal ? { ...nextProposal, turnId } : undefined;
  Promise.resolve().then(() => doneCb?.({ turnId, ...nextShell, proposal }));
  return Promise.resolve({ ok: true, data: { turnId } });
});

/** Arrange the ShellTurn the next chat:send will resolve to. */
function respondWith(shell: ShellTurn) {
  nextShell = shell;
}
/** Arrange an EP-6 dispatcher proposal on the next turn (turnId is filled in by send). */
function respondWithProposal(summary: string) {
  nextShell = { reply: 'Should I set this?', parse: null };
  nextProposal = { turnId: '', kind: 'reminder_create', summary };
}

beforeEach(() => {
  send.mockClear();
  create.mockReset();
  onDone.mockReset();
  actionConfirm.mockReset();
  actionCancel.mockReset();
  doneCb = null;
  resolvedCb = null;
  appendedCb = null;
  turnCounter = 0;
  nextShell = { reply: '', parse: null };
  nextProposal = undefined;
  onDone.mockImplementation((cb: typeof doneCb) => {
    doneCb = cb;
    return () => {
      if (doneCb === cb) doneCb = null;
    };
  });
  // Stub the preload bridge the ipc wrapper talks to.
  (globalThis as unknown as { window: { lifeos: unknown } }).window = {
    lifeos: {
      // CONV: useConversation hydrates from chat.turns(sessionId) on mount (empty here).
      // DELIVERY: onTurnAppended for live reminder delivery; VOICE: onSearching for the search status.
      chat: {
        send,
        onDone,
        turns: () => Promise.resolve({ ok: true, data: [] }),
        onTurnStarted: () => () => {},
        onTurnAppended: (cb: typeof appendedCb) => {
          appendedCb = cb;
          return () => {
            if (appendedCb === cb) appendedCb = null;
          };
        },
        onSearching: () => () => {},
      },
      reminders: { create },
      // EP-6/EP-7: useConversation subscribes to action:expired + action:resolved on mount.
      action: {
        onExpired: () => () => {},
        onResolved: (cb: typeof resolvedCb) => {
          resolvedCb = cb;
          return () => {
            if (resolvedCb === cb) resolvedCb = null;
          };
        },
        confirm: actionConfirm,
        cancel: actionCancel,
      },
    },
  } as never;
});

describe('useConversation (EP-2 renderer)', () => {
  it('send appends a user bubble and an assistant proposal bubble', async () => {
    respondWith({ reply: "Here's what I understood.", parse: { ok: true, reminder } as never });
    const { result } = renderHook(() => useConversation('sess-1'));
    await act(async () => {
      await result.current.send('remind me in 10 minutes to drink water');
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]!.role).toBe('user');
    expect(result.current.messages[1]!.role).toBe('assistant');
    expect(result.current.messages[1]!.proposal?.status).toBe('pending');
    expect(result.current.messages[1]!.proposal?.parse.ok).toBe(true);
  });

  it('a plain (parse:null) reply turn renders with no proposal card', async () => {
    // Any assistant reply that carries no parse renders as a plain bubble (the offline honest-notice
    // and a local-command answer are both parse:null). This tests the renderer, not the message text.
    respondWith({ reply: 'It’s 3:45 PM on Tuesday, July 14.', parse: null });
    const { result } = renderHook(() => useConversation('sess-1'));
    await act(async () => {
      await result.current.send('what time is it');
    });
    expect(result.current.messages[1]!.text).toMatch(/3:45/);
    expect(result.current.messages[1]!.proposal).toBeUndefined();
  });

  it('confirm creates the reminder and settles the proposal to executed', async () => {
    respondWith({ reply: 'ok', parse: { ok: true, reminder } as never });
    create.mockResolvedValue({ ok: true, data: { id: 'x' } });
    const { result } = renderHook(() => useConversation('sess-1'));
    await act(async () => {
      await result.current.send('remind me in 10 minutes to drink water');
    });
    const id = result.current.messages[1]!.id;
    await act(async () => {
      await result.current.confirm(id, reminder);
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.current.messages[1]!.proposal?.status).toBe('executed');
  });

  it('a mirrored launcher reminder turn renders its card LIVE (no chat switch needed)', async () => {
    // Issue 1: a reminder dictated in the voice launcher mirrors into the open main chat via
    // onTurnAppended. It must render the proposal card live — a pending one, then "✓ Saved" — not a
    // bare text line that only becomes a card after re-hydration.
    const { result } = renderHook(() => useConversation('sess-1'));
    // A pending proposal turn mirrored from the launcher.
    act(() => {
      appendedCb?.({
        sessionId: 'sess-1',
        turn: { id: 'L1', kind: 'chat', userText: 'remind me in one minute to call Biplab', assistantText: "Here's what I understood.", proposalSummary: 'Call Biplab · in 1 minute · one-time', proposalStatus: 'pending', createdAt: Date.now() },
      });
    });
    const msg = result.current.messages.find((m) => m.dispatchProposal?.turnId === 'L1');
    expect(msg?.dispatchProposal?.status).toBe('pending'); // a live, confirmable card — not text-only
    expect(msg?.dispatchProposal?.summary).toContain('Call Biplab');

    // The launcher's voice "yes" settles it → the same turn mirrors again as executed → "✓ Saved".
    act(() => {
      appendedCb?.({
        sessionId: 'sess-1',
        turn: { id: 'L1', kind: 'chat', userText: 'remind me in one minute to call Biplab', assistantText: "Here's what I understood.", proposalSummary: 'Call Biplab · in 1 minute · one-time', proposalStatus: 'executed', createdAt: Date.now() },
      });
    });
    const settled = result.current.messages.find((m) => m.dispatchProposal?.turnId === 'L1');
    expect(settled?.dispatchProposal?.status).toBe('executed');
    expect(settled?.dispatchProposal?.resolvedSummary).toContain('Saved');
  });

  it('cancel settles the proposal without creating anything', async () => {
    respondWith({ reply: 'ok', parse: { ok: true, reminder } as never });
    const { result } = renderHook(() => useConversation('sess-1'));
    await act(async () => {
      await result.current.send('remind me in 10 minutes to drink water');
    });
    const id = result.current.messages[1]!.id;
    act(() => {
      result.current.cancel(id);
    });
    expect(create).not.toHaveBeenCalled();
    expect(result.current.messages[1]!.proposal?.status).toBe('cancelled');
  });

  it('empty input creates no turn', async () => {
    const { result } = renderHook(() => useConversation('sess-1'));
    await act(async () => {
      await result.current.send('   ');
    });
    expect(result.current.messages).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('EP-6: a dispatcher proposal renders a dispatch card (no local parse)', async () => {
    respondWithProposal('Call Rahul · Mon, Jul 13, 9:00 AM · one-time');
    const { result } = renderHook(() => useConversation('sess-1'));
    await act(async () => {
      await result.current.send('remind me tomorrow at 9am to call Rahul');
    });
    const msg = result.current.messages[1]!;
    expect(msg.dispatchProposal?.status).toBe('pending');
    expect(msg.dispatchProposal?.summary).toContain('Call Rahul');
    expect(msg.dispatchProposal?.turnId).toBe('t1');
    expect(msg.proposal).toBeUndefined(); // not the EP-2 parse path
  });

  it('EP-6: confirmDispatch executes the stored action via action.confirm(turnId)', async () => {
    respondWithProposal('Call Rahul · Mon, Jul 13, 9:00 AM · one-time');
    actionConfirm.mockResolvedValue({ ok: true, data: { ok: true, summary: 'Call Rahul · Mon, Jul 13, 9:00 AM · one-time' } });
    const { result } = renderHook(() => useConversation('sess-1'));
    await act(async () => {
      await result.current.send('remind me tomorrow at 9am to call Rahul');
    });
    const id = result.current.messages[1]!.id;
    await act(async () => {
      await result.current.confirmDispatch(id, 't1');
    });
    expect(actionConfirm).toHaveBeenCalledWith('t1'); // relays only the turnId
    expect(create).not.toHaveBeenCalled(); // NOT the EP-2 direct path
    expect(result.current.messages[1]!.dispatchProposal?.status).toBe('executed');
  });

  it('EP-7: a voice-resolved proposal (action:resolved) settles the card without a button click', async () => {
    respondWithProposal('Call Rahul · Mon, Jul 13, 9:00 AM · one-time');
    const { result } = renderHook(() => useConversation('sess-1'));
    await act(async () => {
      await result.current.send('remind me tomorrow at 9am to call Rahul');
    });
    expect(result.current.messages[1]!.dispatchProposal?.status).toBe('pending');
    // main matched a spoken "yes" and confirmed — it broadcasts action:resolved.
    act(() => {
      resolvedCb!({ turnId: 't1', status: 'executed', summary: 'Call Rahul · Mon, Jul 13, 9:00 AM · one-time' });
    });
    expect(actionConfirm).not.toHaveBeenCalled(); // resolved in main, not via the button
    expect(result.current.messages[1]!.dispatchProposal?.status).toBe('executed');
    expect(result.current.messages[1]!.dispatchProposal?.resolvedSummary).toContain('Saved');
  });

  it('EP-6: cancelDispatch settles the card and clears the pending proposal in main', async () => {
    respondWithProposal('Call Rahul · Mon, Jul 13, 9:00 AM · one-time');
    actionCancel.mockResolvedValue({ ok: true, data: { cancelled: true } });
    const { result } = renderHook(() => useConversation('sess-1'));
    await act(async () => {
      await result.current.send('remind me tomorrow at 9am to call Rahul');
    });
    const id = result.current.messages[1]!.id;
    await act(async () => {
      await result.current.cancelDispatch(id, 't1');
    });
    expect(actionCancel).toHaveBeenCalledWith('t1');
    expect(result.current.messages[1]!.dispatchProposal?.status).toBe('cancelled');
  });
});
