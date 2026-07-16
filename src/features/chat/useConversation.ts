import { useCallback, useEffect, useState } from 'react';
import { ipc, AppError } from '../../lib/ipc';
import type { ChatMessage, ProposalStatus } from './conversation-types';
import type { ParsedReminder } from '../../../core/parsing/types';
import type { ChatTurn } from '../../../core/types/chat';

/** Rebuild the displayed message list from persisted turns — the FAITHFUL re-render (CONV). A
 *  proposal turn becomes a SETTLED card; a turn left 'pending' at a crash shows as expired (a live
 *  voice-confirmable card never survives restart — it fails safe). */
function turnsToMessages(turns: ChatTurn[]): ChatMessage[] {
  let n = 0;
  const id = () => `h${++n}`;
  return turns.flatMap((t) => {
    // A delivery turn (fired reminder OR delivered email) is assistant-only, no user bubble.
    if (t.kind === 'reminder' || t.kind === 'email') {
      return [{ id: id(), role: 'assistant' as const, text: t.assistantText, createdAt: t.createdAt, kind: t.kind }];
    }
    const user: ChatMessage = { id: id(), role: 'user', text: t.userText, createdAt: t.createdAt };
    const assistant: ChatMessage = { id: id(), role: 'assistant', text: t.assistantText, createdAt: t.createdAt };
    if (t.proposalSummary) {
      const status = t.proposalStatus ?? 'cancelled';
      const settled: ProposalStatus = status === 'pending' ? 'cancelled' : status;
      assistant.dispatchProposal = {
        turnId: t.id,
        summary: t.proposalSummary,
        status: settled,
        resolvedSummary: status === 'executed' ? `✓ Saved — ${t.proposalSummary}. It’s in your Active Schedules.` : undefined,
        error: status === 'pending' ? 'This request expired.' : undefined,
      };
    }
    return [user, assistant];
  });
}

/** Reconstruct a dispatcher-proposal card from a mirrored turn (a reminder created in the launcher
 *  or the other window). Unlike the re-hydration path, a LIVE mirror keeps a 'pending' proposal
 *  pending (it is genuinely still confirmable here — by button or by the launcher's voice "yes"),
 *  so the card and its later "✓ Saved" settlement appear immediately instead of only after a chat
 *  switch. */
function liveDispatch(turn: ChatTurn): ChatMessage['dispatchProposal'] | undefined {
  if (!turn.proposalSummary) return undefined;
  const status: ProposalStatus =
    turn.proposalStatus === 'executed' ? 'executed' : turn.proposalStatus === 'cancelled' ? 'cancelled' : 'pending';
  return {
    turnId: turn.id,
    summary: turn.proposalSummary,
    status,
    resolvedSummary: status === 'executed' ? `✓ Saved — ${turn.proposalSummary}. It’s in your Active Schedules.` : undefined,
  };
}

/**
 * useConversation (31 §4.1) — owns the `ChatMessage[]`, the send/confirm/cancel lifecycle, and the
 * busy flag. Two confirmation paths coexist:
 *   • EP-2 local-parse proposal → `confirm` calls `ipc.createReminder` directly.
 *   • EP-6 dispatcher proposal → `confirmDispatch` calls `ipc.actionConfirm(turnId)`, which executes
 *     the action STORED in main (the renderer never holds the reminder fields, 36 §4.3).
 * Which one a turn carries is decided in main by `dispatcher_enabled`.
 */
let idCounter = 0;
const nextId = () => `m${++idCounter}`;

export function useConversation(sessionId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  // "Searching the web…" — main fires chat:searching when a turn runs a web search (57/voice #3).
  // For our OWN send it flips the busy indicator; for a turn started in the launcher it flips that
  // turn's live placeholder from "thinking" to "searching" so both windows show the same status.
  useEffect(() => {
    return ipc.onSearching(({ turnId, sessionId: sid }) => {
      if (sid !== sessionId) return; // ignore a search in a chat we don't have open
      setSearching(true); // our own in-flight send (busy-block); harmless for others (busy is false)
      setMessages((prev) => prev.map((m) => (m.id === `t-${turnId}-a` && m.pending ? { ...m, pending: 'searching' } : m)));
    });
  }, [sessionId]);

  // Real-time sync: a turn STARTED in the launcher (reply pending) for the open chat — show the user's
  // message + a live thinking placeholder immediately. (Excluded-sender broadcast, so this is never
  // our own send.) Idempotent by turnId-derived key.
  useEffect(() => {
    return ipc.onTurnStarted(({ sessionId: sid, turnId, userText }) => {
      if (sid !== sessionId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === `t-${turnId}-a`)) return prev;
        return [
          ...prev,
          { id: `t-${turnId}-u`, role: 'user', text: userText, createdAt: Date.now() },
          { id: `t-${turnId}-a`, role: 'assistant', text: '', createdAt: Date.now(), pending: 'thinking' },
        ];
      });
    });
  }, [sessionId]);

  // Hydrate the message list from the persisted session whenever the open chat changes (resume).
  // Clear immediately (so a switch never shows the old chat), then PREPEND the loaded history in
  // front of anything sent live during the load — so a race can't clobber a just-sent message.
  useEffect(() => {
    setMessages([]);
    if (!sessionId) return;
    let cancelled = false;
    void ipc
      .sessionTurns(sessionId)
      .then((turns) => {
        if (!cancelled) setMessages((prev) => [...turnsToMessages(turns), ...prev]);
      })
      .catch(() => {
        /* keep whatever is on screen; the chat is still usable */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const append = useCallback((m: ChatMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const setProposal = useCallback(
    (id: string, status: ProposalStatus, extra?: { resolvedSummary?: string; error?: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id && m.proposal ? { ...m, proposal: { ...m.proposal, status, ...extra } } : m,
        ),
      );
    },
    [],
  );

  const setDispatch = useCallback(
    (id: string, status: ProposalStatus, extra?: { resolvedSummary?: string; error?: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id && m.dispatchProposal ? { ...m, dispatchProposal: { ...m.dispatchProposal, status, ...extra } } : m,
        ),
      );
    },
    [],
  );

  // A pending dispatcher proposal auto-cancels in main after 90s (fails safe); reflect that here.
  useEffect(() => {
    return ipc.onActionExpired(({ turnId }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.dispatchProposal && m.dispatchProposal.turnId === turnId && m.dispatchProposal.status === 'pending'
            ? { ...m, dispatchProposal: { ...m.dispatchProposal, status: 'cancelled', error: 'This request expired — ask again.' } }
            : m,
        ),
      );
    });
  }, []);

  // Live sync of turns written OUTSIDE this window (fired reminders, and voice-launcher chats) — only
  // when they land in the chat currently open (else they persist and show on reopen).
  useEffect(() => {
    return ipc.onTurnAppended(({ sessionId: sid, turn }) => {
      if (sid !== sessionId) return;
      if (turn.kind === 'reminder' || turn.kind === 'email') {
        append({ id: `d${turn.id}`, role: 'assistant', text: turn.assistantText, createdAt: turn.createdAt, kind: turn.kind });
        return;
      }
      // A chat turn completed in the voice launcher IN THIS open chat — mirror it live so the launcher
      // and main chat stay synchronized (user transcript + Yogi's reply, web-search results included).
      // If a live placeholder from turn:started exists, RESOLVE it in place; else append fresh. A
      // reminder proposal is reconstructed as a live card, so its "Saved"/pending state shows here
      // immediately (it used to require a chat switch to render).
      setSearching(false);
      const proposal = liveDispatch(turn);
      setMessages((prev) => {
        if (prev.some((m) => m.id === `t-${turn.id}-a`)) {
          return prev.map((m) => {
            if (m.id === `t-${turn.id}-u`) return { ...m, text: turn.userText };
            if (m.id === `t-${turn.id}-a`) return { ...m, text: turn.assistantText, pending: undefined, dispatchProposal: proposal };
            return m;
          });
        }
        return [
          ...prev,
          { id: `t-${turn.id}-u`, role: 'user', text: turn.userText, createdAt: turn.createdAt },
          { id: `t-${turn.id}-a`, role: 'assistant', text: turn.assistantText, createdAt: turn.createdAt, dispatchProposal: proposal },
        ];
      });
    });
  }, [sessionId, append]);

  // EP-7: a pending proposal confirmed/cancelled BY VOICE in main — settle the card the user can't
  // see resolve (the matcher drove action:confirm/cancel).
  useEffect(() => {
    return ipc.onActionResolved(({ turnId, status, summary }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.dispatchProposal && m.dispatchProposal.turnId === turnId && m.dispatchProposal.status === 'pending'
            ? {
                ...m,
                dispatchProposal: {
                  ...m.dispatchProposal,
                  status,
                  resolvedSummary:
                    status === 'executed' ? `✓ Saved — ${summary ?? m.dispatchProposal.summary}. It’s in your Active Schedules.` : undefined,
                },
              }
            : m,
        ),
      );
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || !sessionId) return;
      append({ id: nextId(), role: 'user', text: t, createdAt: Date.now() });
      setBusy(true);
      setSearching(false);
      try {
        const turn = await ipc.chatSend(t, sessionId);
        if (turn.proposal) {
          // EP-6 dispatcher proposal — the action is stored in main; Confirm relays the turnId.
          append({
            id: nextId(),
            role: 'assistant',
            text: turn.reply,
            createdAt: Date.now(),
            dispatchProposal: { turnId: turn.proposal.turnId, summary: turn.proposal.summary, status: 'pending' },
          });
        } else {
          // EP-2 local-parse proposal (or a plain reply).
          const carriesProposal = turn.parse && (turn.parse.ok || turn.parse.kind === 'clarification');
          append({
            id: nextId(),
            role: 'assistant',
            text: turn.reply,
            createdAt: Date.now(),
            proposal: carriesProposal ? { parse: turn.parse!, status: 'pending', sourceText: t } : undefined,
          });
        }
      } catch (e) {
        append({
          id: nextId(),
          role: 'assistant',
          text: e instanceof AppError ? e.message : "I couldn't read that — try rephrasing.",
          createdAt: Date.now(),
        });
      } finally {
        setBusy(false);
        setSearching(false);
      }
    },
    [append, sessionId],
  );

  // EP-2 direct-path confirm (dispatcher off).
  const confirm = useCallback(
    async (messageId: string, r: ParsedReminder) => {
      setBusy(true);
      try {
        await ipc.createReminder({
          title: r.title,
          description: r.description,
          scheduledAtUtcMs: r.scheduledAtUtcMs,
          timezone: r.timezone,
          recurrenceRule: r.recurrenceRule,
          actionType: r.actionType,
          source: 'local',
        });
        setProposal(messageId, 'executed', { resolvedSummary: `✓ Saved — ${r.title}. It’s in your Active Schedules.` });
      } catch (e) {
        setProposal(messageId, 'pending', { error: e instanceof AppError ? e.message : 'Could not save the reminder.' });
      } finally {
        setBusy(false);
      }
    },
    [setProposal],
  );

  const cancel = useCallback(
    (messageId: string) => {
      setProposal(messageId, 'cancelled');
    },
    [setProposal],
  );

  // EP-6 dispatcher confirm — executes the STORED proposal for turnId (the pending-proposal invariant).
  const confirmDispatch = useCallback(
    async (messageId: string, turnId: string) => {
      setBusy(true);
      try {
        const res = await ipc.actionConfirm(turnId);
        if (res.ok) {
          setDispatch(messageId, 'executed', { resolvedSummary: `✓ Saved — ${res.summary}. It’s in your Active Schedules.` });
        } else {
          // e.g. the proposal expired between render and click — stays visible with the reason.
          setDispatch(messageId, 'cancelled', { error: res.message });
        }
      } catch (e) {
        setDispatch(messageId, 'pending', { error: e instanceof AppError ? e.message : 'Could not save the reminder.' });
      } finally {
        setBusy(false);
      }
    },
    [setDispatch],
  );

  const cancelDispatch = useCallback(
    async (messageId: string, turnId: string) => {
      setDispatch(messageId, 'cancelled');
      try {
        await ipc.actionCancel(turnId); // clear the pending proposal in main (best-effort)
      } catch {
        /* the card is already settled in the UI; main's timeout will clear it regardless */
      }
    },
    [setDispatch],
  );

  return { messages, busy, searching, send, confirm, cancel, confirmDispatch, cancelDispatch };
}
