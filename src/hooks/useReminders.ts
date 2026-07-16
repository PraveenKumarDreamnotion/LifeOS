import { useCallback, useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import type { ReminderDto } from '../../core/types/ipc';

/**
 * Reads the reminder list and refetches whenever main broadcasts a change. Main owns the
 * truth; the renderer holds a cache invalidated by one event (13 §8) — no diffing.
 */
export function useReminders() {
  const [reminders, setReminders] = useState<ReminderDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setReminders(await ipc.listReminders());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reminders');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = ipc.onRemindersChanged(() => void refresh());
    return unsub;
  }, [refresh]);

  return { reminders, error, refresh };
}
