import { useEffect, useState } from 'react';
import type { ChatTurn } from '../../core/types/chat';

/**
 * The launcher's compact conversation, kept in lock-step with the main chat. The launcher is a PURE
 * subscriber to the same turn broadcasts the main window uses (started → searching → appended), so
 * both surfaces render one conversation with no separate state. Messages are keyed by turnId so a
 * live "thinking/searching" placeholder resolves in place when the reply lands.
 */
export interface LauncherMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending?: 'thinking' | 'searching';
}

function turnsToMessages(turns: ChatTurn[]): LauncherMessage[] {
  return turns.flatMap((t) =>
    t.kind === 'reminder'
      ? [{ id: `t-${t.id}-a`, role: 'assistant' as const, text: t.assistantText }]
      : [
          { id: `t-${t.id}-u`, role: 'user' as const, text: t.userText },
          { id: `t-${t.id}-a`, role: 'assistant' as const, text: t.assistantText },
        ],
  );
}

export function useLauncherMessages(sessionId: string | null): LauncherMessage[] {
  const [messages, setMessages] = useState<LauncherMessage[]>([]);

  // Hydrate the open chat's history whenever the active session changes. Clear first (so a switch
  // never shows the old chat), then PREPEND the loaded history in front of anything that arrived live
  // during the load — a turn:started landing mid-hydration must not be clobbered (matches the main chat).
  useEffect(() => {
    setMessages([]);
    if (!sessionId) return;
    let cancelled = false;
    void window.lifeosLauncher.chat.turns(sessionId).then((r) => {
      if (!cancelled && r.ok) setMessages((prev) => [...turnsToMessages(r.data), ...prev]);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // A turn STARTED (reply pending) — show the user's message + a live thinking placeholder.
  useEffect(() => {
    return window.lifeosLauncher.chat.onTurnStarted(({ sessionId: sid, turnId, userText }) => {
      if (sid !== sessionId) return;
      setMessages((prev) =>
        prev.some((m) => m.id === `t-${turnId}-a`)
          ? prev
          : [
              ...prev,
              { id: `t-${turnId}-u`, role: 'user', text: userText },
              { id: `t-${turnId}-a`, role: 'assistant', text: '', pending: 'thinking' },
            ],
      );
    });
  }, [sessionId]);

  // Web search started — flip that turn's placeholder from "thinking" to "searching".
  useEffect(() => {
    return window.lifeosLauncher.chat.onSearching(({ turnId, sessionId: sid }) => {
      if (sid !== sessionId) return;
      setMessages((prev) => prev.map((m) => (m.id === `t-${turnId}-a` && m.pending ? { ...m, pending: 'searching' } : m)));
    });
  }, [sessionId]);

  // A turn COMPLETED — resolve the placeholder in place, or append if we didn't see it start.
  useEffect(() => {
    return window.lifeosLauncher.chat.onTurnAppended(({ sessionId: sid, turn }) => {
      if (sid !== sessionId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === `t-${turn.id}-a`)) {
          return prev.map((m) => {
            if (m.id === `t-${turn.id}-u`) return { ...m, text: turn.userText };
            if (m.id === `t-${turn.id}-a`) return { ...m, text: turn.assistantText, pending: undefined };
            return m;
          });
        }
        return [...prev, ...turnsToMessages([turn])];
      });
    });
  }, [sessionId]);

  return messages;
}
