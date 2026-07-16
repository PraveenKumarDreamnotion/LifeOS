import { useState, type FormEvent } from 'react';
import { useSpeech } from '../../hooks/useSpeech';
import { ipc, AppError } from '../../lib/ipc';
import { formatAbsolute, formatRelative, rruleToHuman } from '../../../core/time/format';
import { MicButton } from './MicButton';
import type { ParseResult, ParsedReminder } from '../../../core/parsing/types';

/**
 * The v0.2 single-shot parse→card screen, retained as the `conversation_ui_enabled: false`
 * rollback path (43 §Rollback, 41 §10). Unchanged behaviour; removed once v0.3's conversation
 * UI is verified on a real build.
 */
const EXAMPLES = [
  'Remind me in 10 minutes to drink water',
  'Remind me tomorrow at 9 AM to attend the meeting',
  'Remind me every Monday at 7 AM to exercise',
];

export function LegacyChatScreen() {
  const [text, setText] = useState('');
  const [lastAsked, setLastAsked] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const speech = useSpeech((t) => setText(t));

  async function ask(input: string) {
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    setLastAsked(input);
    try {
      setResult(await ipc.parse(input));
    } catch (e) {
      setError(e instanceof AppError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function answerClarification(kind: string, hour: number, label: string) {
    if (kind === 'ambiguous_meridiem') void ask(`${lastAsked} ${hour < 12 ? 'AM' : 'PM'}`);
    else void ask(`${lastAsked} at ${label}`);
  }
  function answerTitle(subject: string) {
    if (subject.trim()) void ask(`${lastAsked} to ${subject.trim()}`);
  }

  async function confirm(r: ParsedReminder) {
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
      setSaved(r.title);
      setResult(null);
      setText('');
    } catch (e) {
      setError(e instanceof AppError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1 className="screen-title">Ask Yogi</h1>
      <div className="live-transcript" aria-live="polite">
        {speech.state === 'listening' && (speech.partial || 'Listening…')}
        {speech.state === 'processing' && (speech.supportsPartials ? 'Processing…' : 'Transcribing…')}
      </div>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void ask(text); }} className="composer">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a reminder, or press the mic — e.g. remind me in 10 minutes to drink water"
          maxLength={1000}
          autoFocus
        />
        <MicButton state={speech.state} onToggle={speech.toggle} />
        <button type="submit" disabled={busy}>
          {busy ? '…' : 'Ask Yogi'}
        </button>
      </form>
      {speech.errorMsg && <p className="bad">{speech.errorMsg}</p>}
      {error && <p className="bad">{error}</p>}
      {saved && <p className="ok">✓ Saved — {saved}. It’s in your Active Schedules.</p>}

      <div className="chips" style={{ marginTop: 10 }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip-btn" onClick={() => setText(ex)}>
            {ex}
          </button>
        ))}
      </div>

      {result && (
        <ResultCard
          result={result}
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setResult(null)}
          onChip={ask}
          onAnswer={answerClarification}
          onAnswerTitle={answerTitle}
        />
      )}
    </div>
  );
}

function ResultCard({
  result,
  busy,
  onConfirm,
  onCancel,
  onChip,
  onAnswer,
  onAnswerTitle,
}: {
  result: ParseResult;
  busy: boolean;
  onConfirm: (r: ParsedReminder) => void;
  onCancel: () => void;
  onChip: (text: string) => void;
  onAnswer: (kind: string, hour: number, label: string) => void;
  onAnswerTitle: (subject: string) => void;
}) {
  const [subject, setSubject] = useState('');

  if (result.ok) {
    const r = result.reminder;
    return (
      <section className="card">
        <h2>◈ Yogi understood</h2>
        <div className="row">
          <span className="label">Reminder</span>
          <span>{r.title}</span>
        </div>
        <div className="row">
          <span className="label">When</span>
          <span>
            {formatAbsolute(r.scheduledAtUtcMs, r.timezone)}
            <br />
            <span className="dim">{formatRelative(r.scheduledAtUtcMs)}</span>
          </span>
        </div>
        <div className="row">
          <span className="label">Repeat</span>
          <span>{rruleToHuman(r.recurrenceRule, r.timezone)}</span>
        </div>
        <div className="actions">
          <button onClick={() => onConfirm(r)} disabled={busy}>
            Confirm Reminder
          </button>
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  if (result.kind === 'clarification') {
    const c = result.clarification;
    return (
      <section className="card">
        <h2>◈ Yogi needs one detail</h2>
        <p>{c.question}</p>
        {c.suggestions.length > 0 && (
          <div className="chips">
            {c.suggestions.map((s) => (
              <button key={s.label} className="chip-btn" onClick={() => onAnswer(c.ambiguity.kind, s.hour, s.label)}>
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
              onAnswerTitle(subject);
            }}
          >
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. call my mother" autoFocus maxLength={200} />
            <button type="submit" disabled={busy || !subject.trim()}>
              Set
            </button>
          </form>
        )}
        <div className="actions">
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>◈ Yogi</h2>
      <p>{result.refusal.message}</p>
      <div className="chips">
        {result.refusal.examples.map((ex) => (
          <button key={ex} className="chip-btn" onClick={() => onChip(ex)}>
            {ex}
          </button>
        ))}
      </div>
    </section>
  );
}
