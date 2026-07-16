import { useState } from 'react';
import { useReminders } from '../../hooks/useReminders';
import { useNow } from '../../hooks/useNow';
import { ipc } from '../../lib/ipc';
import { formatAbsolute, formatRelative, rruleToHuman } from '../../../core/time/format';
import type { ReminderDto } from '../../../core/types/ipc';
import { ReminderEditor } from './ReminderEditor';

export function SchedulesScreen({ paused, onTogglePause }: { paused: boolean; onTogglePause: () => void }) {
  const { reminders } = useReminders();
  const now = useNow(); // live countdown — "in 5 minutes" ticks down instead of freezing at render
  const active = reminders.filter((r) => r.status === 'pending' || r.status === 'triggered');

  // null = closed; 'new' = create; a reminder = edit that one.
  const [editing, setEditing] = useState<'new' | ReminderDto | null>(null);

  return (
    <div className="screen">
      <div className="section-head">
        <h1 className="screen-title">Active Schedules</h1>
        <div className="row-actions">
          {active.length > 0 && (
            <button className="ghost" onClick={onTogglePause}>
              {paused ? '▶ Resume all' : '⏸ Pause all'}
            </button>
          )}
          <button className="primary" onClick={() => setEditing('new')}>
            ＋ New reminder
          </button>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="empty">
          <div className="empty-glyph">📅</div>
          <p>No reminders scheduled yet.</p>
          <p className="dim">
            Ask Yogi — “Remind me in 10 minutes to drink water” — or use <strong>＋ New reminder</strong>.
          </p>
        </div>
      ) : (
        <ul className="reminders">
          {active.map((r) => (
            <li key={r.id} className={r.isPaused ? 'paused-row' : ''}>
              <div>
                <strong>{r.title}</strong>
                {r.isPaused && <span className="tag">paused</span>}
                <br />
                <span className="dim">
                  {formatAbsolute(r.nextFireAt, r.timezone)} · {formatRelative(r.nextFireAt, now)}
                </span>
                <br />
                <span className="tag">{rruleToHuman(r.recurrenceRule, r.timezone, r.scheduledAt)}</span>
              </div>
              <div className="row-actions">
                <button className="ghost" onClick={() => setEditing(r)}>
                  Edit
                </button>
                {r.recurrenceRule && (
                  <button className="ghost" onClick={() => void ipc.pauseReminder(r.id, !r.isPaused)}>
                    {r.isPaused ? 'Resume' : 'Pause'}
                  </button>
                )}
                <button
                  className="ghost"
                  onClick={() => {
                    if (window.confirm(`Delete “${r.title}”? This can't be undone.`)) void ipc.deleteReminder(r.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ReminderEditor reminder={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
