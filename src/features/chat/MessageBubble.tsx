import { useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { useNow } from '../../hooks/useNow';
import { formatAbsolute, formatRelative, rruleToHuman } from '../../../core/time/format';
import type { ChatMessage } from './conversation-types';
import type { ParsedReminder } from '../../../core/parsing/types';

/**
 * A single conversation message. Three shapes (31 §4.1): a right-aligned user bubble, a
 * left-aligned assistant text bubble, and — for a reminder parse — an assistant `ProposalBubble`
 * that hosts the confirmation card (the gate: Confirm only for an `ok` parse, never for a
 * clarification). Confirmed/cancelled proposals settle in place so scrollback is a real transcript.
 */
export function MessageBubble({
  message,
  busy,
  onConfirm,
  onCancel,
  onRefine,
  onConfirmDispatch,
  onCancelDispatch,
}: {
  message: ChatMessage;
  busy: boolean;
  onConfirm: (messageId: string, r: ParsedReminder) => void;
  onCancel: (messageId: string) => void;
  onRefine: (text: string) => void;
  onConfirmDispatch: (messageId: string, turnId: string) => void;
  onCancelDispatch: (messageId: string, turnId: string) => void;
}) {
  const cls =
    message.role === 'user'
      ? 'msg msg-user'
      : message.kind === 'reminder'
        ? 'msg msg-assistant msg-reminder'
        : message.kind === 'email'
          ? 'msg msg-assistant msg-email'
          : 'msg msg-assistant';
  return (
    <div className={cls}>
      <div className="bubble">
        {message.pending === 'searching' ? (
          <p className="bubble-text dim">🔎 Searching the web…</p>
        ) : message.pending === 'thinking' ? (
          <p className="bubble-text dim" aria-label="Yogi is thinking">
            <span className="typing" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </p>
        ) : (
          // The assistant's NORMAL reply is Markdown (headings/lists/bold/code). User bubbles and
          // delivered emails/reminders stay plain pre-wrap text — nothing that isn't a model reply is
          // reinterpreted (no literal `**`, no accidental formatting of a user's own text).
          message.text &&
          (message.role === 'assistant' && !message.kind ? (
            <Markdown text={message.text} className="bubble-md" />
          ) : (
            <p className="bubble-text">{message.text}</p>
          ))
        )}
        {message.proposal && (
          <ProposalCard message={message} busy={busy} onConfirm={onConfirm} onCancel={onCancel} onRefine={onRefine} />
        )}
        {message.dispatchProposal && (
          <DispatchCard message={message} busy={busy} onConfirm={onConfirmDispatch} onCancel={onCancelDispatch} />
        )}
      </div>
    </div>
  );
}

/**
 * EP-6 dispatcher proposal card. Unlike the EP-2 ProposalCard, it holds NO reminder fields — only
 * the resolved summary string from main. Confirm relays the turnId; main executes the STORED,
 * already-validated action (36 §4.3). Confirmed/cancelled/expired states settle in place.
 */
function DispatchCard({
  message,
  busy,
  onConfirm,
  onCancel,
}: {
  message: ChatMessage;
  busy: boolean;
  onConfirm: (messageId: string, turnId: string) => void;
  onCancel: (messageId: string, turnId: string) => void;
}) {
  const proposal = message.dispatchProposal!;
  if (proposal.status === 'executed') return <p className="ok">{proposal.resolvedSummary ?? '✓ Saved.'}</p>;
  if (proposal.status === 'cancelled') return <p className="dim">{proposal.error ?? 'Cancelled.'}</p>;

  return (
    <section className="card">
      <div className="row">
        <span className="label">Reminder</span>
        <span>{proposal.summary}</span>
      </div>
      {proposal.error && <p className="bad">{proposal.error}</p>}
      <p className="dim voice-hint">🎙 Say “yes” or “no” — or use the buttons.</p>
      <div className="actions">
        <button onClick={() => onConfirm(message.id, proposal.turnId)} disabled={busy}>
          Confirm Reminder
        </button>
        <button className="ghost" onClick={() => onCancel(message.id, proposal.turnId)} disabled={busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function ProposalCard({
  message,
  busy,
  onConfirm,
  onCancel,
  onRefine,
}: {
  message: ChatMessage;
  busy: boolean;
  onConfirm: (messageId: string, r: ParsedReminder) => void;
  onCancel: (messageId: string) => void;
  onRefine: (text: string) => void;
}) {
  const [subject, setSubject] = useState('');
  const now = useNow(); // keep the "in N minutes" line on the proposal card live while it sits pending
  const proposal = message.proposal!;
  const { parse, status, sourceText } = proposal;

  // Settled states — the bubble becomes a read-only transcript entry.
  if (status === 'executed') return <p className="ok">{proposal.resolvedSummary ?? '✓ Saved.'}</p>;
  if (status === 'cancelled') return <p className="dim">Cancelled.</p>;

  // pending: render the card matching the parse result.
  if (parse.ok) {
    const r = parse.reminder;
    return (
      <section className="card">
        <div className="row">
          <span className="label">Reminder</span>
          <span>{r.title}</span>
        </div>
        <div className="row">
          <span className="label">When</span>
          <span>
            {formatAbsolute(r.scheduledAtUtcMs, r.timezone)}
            <br />
            <span className="dim">{formatRelative(r.scheduledAtUtcMs, now)}</span>
          </span>
        </div>
        <div className="row">
          <span className="label">Repeat</span>
          <span>{rruleToHuman(r.recurrenceRule, r.timezone)}</span>
        </div>
        {proposal.error && <p className="bad">{proposal.error}</p>}
        <div className="actions">
          <button onClick={() => onConfirm(message.id, r)} disabled={busy}>
            Confirm Reminder
          </button>
          <button className="ghost" onClick={() => onCancel(message.id)} disabled={busy}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  if (parse.kind === 'clarification') {
    const c = parse.clarification;
    // The question is already the assistant bubble's text; the card shows only the affordances.
    return (
      <section className="card">
        {c.suggestions.length > 0 && (
          <div className="chips">
            {c.suggestions.map((s) => (
              <button
                key={s.label}
                className="chip-btn"
                disabled={busy}
                onClick={() =>
                  onRefine(
                    c.ambiguity.kind === 'ambiguous_meridiem'
                      ? `${sourceText} ${s.hour < 12 ? 'AM' : 'PM'}`
                      : `${sourceText} at ${s.label}`,
                  )
                }
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        {c.ambiguity.kind === 'missing_title' && (
          <form
            className="composer"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (subject.trim()) onRefine(`${sourceText} to ${subject.trim()}`);
            }}
          >
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. call my mother" maxLength={200} />
            <button type="submit" disabled={busy || !subject.trim()}>
              Set
            </button>
          </form>
        )}
        <div className="actions">
          <button className="ghost" onClick={() => onCancel(message.id)} disabled={busy}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return null;
}
