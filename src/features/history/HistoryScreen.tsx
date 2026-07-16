import { useEffect, useState } from 'react';
import { ipc } from '../../lib/ipc';
import { DateTime } from 'luxon';
import type { HistoryDto } from '../../../core/types/ipc';

type Filter = 'all' | 'completed' | 'dismissed' | 'missed';

const FILTERS: Filter[] = ['all', 'completed', 'dismissed', 'missed'];

const ICON: Record<string, string> = {
  triggered: '🔔',
  completed: '✓',
  dismissed: '✕',
  snoozed: '⏰',
  missed: '⚠',
  failed: '⚠',
};

export function HistoryScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<HistoryDto[]>([]);

  useEffect(() => {
    let alive = true;
    void ipc.history(filter).then((r) => {
      if (alive) setRows(r);
    });
    return () => {
      alive = false;
    };
  }, [filter]);

  return (
    <div className="screen">
      <h1 className="screen-title">History</h1>
      <div className="history-filters">
        {FILTERS.map((f) => (
          <button key={f} className={f === filter ? 'chip-btn on' : 'chip-btn'} onClick={() => setFilter(f)}>
            {f[0]!.toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-glyph">🕘</div>
          <p>No reminder activity yet.</p>
          <p className="dim">Once your reminders start arriving, everything you complete, dismiss, snooze, or miss shows up here.</p>
        </div>
      ) : (
        <ul className="history-list">
          {rows.map((h) => (
            <li key={h.id}>
              <span className="glyph">{ICON[h.actionTaken] ?? '•'}</span>
              <span className="h-title">{h.titleAtTime}</span>
              <span className="dim">
                {DateTime.fromMillis(h.triggeredAt).toFormat('ccc d LLL, h:mm a')} ·{' '}
                {h.actionTaken === 'missed' ? 'Missed — LifeOS was closed' : h.actionTaken}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
