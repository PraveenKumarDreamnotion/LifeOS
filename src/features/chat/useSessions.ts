import { useCallback, useEffect, useState } from 'react';
import { ipc } from '../../lib/ipc';
import type { ChatSession } from '../../../core/types/chat';

/**
 * useSessions (CONV) — owns the persistent chat list, the currently-open chat, and new/select/
 * rename. On mount it opens the most recent chat (or creates the first one), so there is always a
 * session to talk in. `refresh` re-reads the list after a turn so titles/order stay current.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<ChatSession[]> => {
    const list = await ipc.listSessions();
    setSessions(list);
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await refresh();
      if (cancelled) return;
      if (list.length > 0) {
        // Open the most-recent NON-email chat — a delivered email never auto-opens (only a
        // notification/sidebar click does), so it can't hijack "continue my conversation".
        const resume = list.find((s) => !s.emailMessageId) ?? list[0]!;
        setCurrentId(resume.id);
      } else {
        const s = await ipc.createSession();
        if (cancelled) return;
        setSessions([s]);
        setCurrentId(s.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Report the open chat to main so the voice launcher continues this SAME conversation
  // (continuity). Fires only when currentId actually changes — no refresh, no thrash.
  useEffect(() => {
    if (currentId) void ipc.setActiveSession(currentId);
  }, [currentId]);

  // A new email chat (or other main-side session change) landed — refresh the sidebar live.
  useEffect(() => ipc.onSessionsChanged(() => void refresh()), [refresh]);

  const newChat = useCallback(async () => {
    const s = await ipc.createSession();
    await refresh();
    setCurrentId(s.id);
  }, [refresh]);

  const select = useCallback((id: string) => setCurrentId(id), []);

  const rename = useCallback(
    async (id: string, title: string) => {
      await ipc.renameSession(id, title);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await ipc.deleteSession(id);
      const list = await refresh();
      // If we deleted the open chat, fall to the most recent remaining one (or start fresh).
      setCurrentId((cur) => {
        if (cur !== id) return cur;
        return list.find((s) => s.id !== id)?.id ?? null;
      });
      if (list.length === 0) {
        const s = await ipc.createSession();
        await refresh();
        setCurrentId(s.id);
      }
    },
    [refresh],
  );

  return { sessions, currentId, newChat, select, rename, remove, refresh };
}
