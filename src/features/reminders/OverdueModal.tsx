import { Modal } from '../../components/Modal';

export interface OverdueItem {
  id: string;
  title: string;
  recurring: boolean;
}

/**
 * The overdue catch-up modal (12 §10.2). Shown once on startup when reminders were due
 * while LifeOS was closed. This is where the app is honest about its central limitation
 * instead of hiding it. Recurring reminders were rolled forward; one-time ones were missed.
 */
export function OverdueModal({ items, onDismiss }: { items: OverdueItem[]; onDismiss: () => void }) {
  return (
    <Modal onEscape={onDismiss} labelledBy="overdue-title">
      <div className="overdue">
        <h2 id="overdue-title">While LifeOS was closed…</h2>
        <p className="dim">
          {items.length} reminder{items.length === 1 ? ' came' : 's came'} due while LifeOS wasn&rsquo;t running.
        </p>
        <ul>
          {items.map((it) => (
            <li key={it.id}>
              ⚠ <strong>{it.title}</strong>
              {it.recurring ? <span className="dim"> — rescheduled to its next time</span> : <span className="dim"> — missed</span>}
            </li>
          ))}
        </ul>
        <p className="dim">Tip: only choose Quit when you want reminders to stop for a while.</p>
        <div className="actions">
          <button onClick={onDismiss}>Dismiss all</button>
        </div>
      </div>
    </Modal>
  );
}
