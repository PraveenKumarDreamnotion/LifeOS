import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { Modal } from '../../components/Modal';
import { ipc } from '../../lib/ipc';
import { rruleToHuman } from '../../../core/time/format';
import type { ReminderDto } from '../../../core/types/ipc';
import {
  buildReminder,
  formFromRule,
  RepeatError,
  type RepeatForm,
  type RepeatPreset,
  type CustomUnit,
  type EndMode,
  DEFAULT_REPEAT,
} from './repeat';

/** Sun-first weekday chips, mapped to ISO weekday numbers (1=Mon..7=Sun). */
const WEEKDAY_CHIPS: Array<{ iso: number; label: string }> = [
  { iso: 7, label: 'S' },
  { iso: 1, label: 'M' },
  { iso: 2, label: 'T' },
  { iso: 3, label: 'W' },
  { iso: 4, label: 'T' },
  { iso: 5, label: 'F' },
  { iso: 6, label: 'S' },
];

const PRESETS: Array<{ value: RepeatPreset; label: string }> = [
  { value: 'once', label: 'One time' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
  { value: 'custom', label: 'Custom…' },
];

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function ReminderEditor({
  reminder,
  onClose,
}: {
  /** Present → edit; absent → create a new reminder. */
  reminder?: ReminderDto;
  onClose: () => void;
}) {
  const zone = reminder?.timezone ?? localZone();
  const isEdit = !!reminder;

  // Seed date/time from the reminder (edit) or now + 1 hour, rounded to the minute (create).
  // NB: seed from nextFireAt, NOT scheduledAt — scheduledAt is the immutable anchor (occurrence #1)
  // and is in the PAST for any recurring reminder that has already fired, which would trip the
  // "already passed" guard on save. nextFireAt is the upcoming occurrence (future for a pending
  // reminder; == scheduledAt for a one-time). Editing is an explicit re-arm, so re-anchoring to the
  // next occurrence is the intended behaviour.
  const seed = useMemo(() => {
    const dt = reminder
      ? DateTime.fromMillis(reminder.nextFireAt, { zone })
      : DateTime.now().setZone(zone).plus({ hours: 1 }).startOf('minute');
    return {
      title: reminder?.title ?? '',
      date: dt.toFormat('yyyy-LL-dd'),
      time: dt.toFormat('HH:mm'),
      repeat: reminder ? formFromRule(reminder.recurrenceRule, zone) : { ...DEFAULT_REPEAT },
    };
  }, [reminder, zone]);

  const [title, setTitle] = useState(seed.title);
  const [date, setDate] = useState(seed.date);
  const [time, setTime] = useState(seed.time);
  const [repeat, setRepeat] = useState<RepeatForm>(seed.repeat);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = <K extends keyof RepeatForm>(key: K, value: RepeatForm[K]) =>
    setRepeat((r) => ({ ...r, [key]: value }));

  const toggleWeekday = (iso: number) =>
    setRepeat((r) => ({
      ...r,
      weekdays: r.weekdays.includes(iso) ? r.weekdays.filter((d) => d !== iso) : [...r.weekdays, iso],
    }));

  // Live preview of the resulting schedule (also surfaces validation errors early).
  const preview = useMemo(() => {
    try {
      const { recurrenceRule, scheduledAtUtcMs } = buildReminder(date, time, repeat, zone);
      const when = DateTime.fromMillis(scheduledAtUtcMs, { zone }).toFormat('cccc, d LLLL yyyy, h:mm a');
      const rule = rruleToHuman(recurrenceRule, zone, scheduledAtUtcMs);
      return { text: recurrenceRule ? `${when} · ${rule}` : when, ok: true as const };
    } catch (e) {
      return { text: e instanceof RepeatError ? e.message : 'Invalid schedule', ok: false as const };
    }
  }, [date, time, repeat, zone]);

  async function save() {
    setError(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Give the reminder a name.');
      return;
    }
    let built;
    try {
      built = buildReminder(date, time, repeat, zone);
    } catch (e) {
      setError(e instanceof RepeatError ? e.message : 'Invalid schedule');
      return;
    }
    if (built.scheduledAtUtcMs <= Date.now()) {
      setError('That time has already passed — pick a future date and time.');
      return;
    }

    setBusy(true);
    try {
      if (isEdit) {
        await ipc.updateReminder(reminder!.id, {
          title: trimmed,
          scheduledAtUtcMs: built.scheduledAtUtcMs,
          timezone: zone,
          recurrenceRule: built.recurrenceRule,
        });
      } else {
        await ipc.createReminder({
          title: trimmed,
          description: null,
          scheduledAtUtcMs: built.scheduledAtUtcMs,
          timezone: zone,
          recurrenceRule: built.recurrenceRule,
          actionType: 'notify',
          source: 'manual',
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the reminder.');
      setBusy(false);
    }
  }

  return (
    <Modal onEscape={onClose} labelledBy="reminder-editor-title">
      <h2 id="reminder-editor-title" className="editor-title">
        {isEdit ? 'Edit reminder' : 'New reminder'}
      </h2>

      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={title}
          maxLength={200}
          placeholder="e.g. Drink water"
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>

      <label className="field">
        <span>Repeat</span>
        <select value={repeat.preset} onChange={(e) => patch('preset', e.target.value as RepeatPreset)}>
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {repeat.preset === 'custom' && (
        <div className="custom-repeat">
          <div className="field-row">
            <label className="field field-narrow">
              <span>Every</span>
              <input
                type="number"
                min={1}
                max={999}
                value={repeat.interval}
                onChange={(e) => patch('interval', Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <label className="field">
              <span>&nbsp;</span>
              <select value={repeat.unit} onChange={(e) => patch('unit', e.target.value as CustomUnit)}>
                <option value="day">day(s)</option>
                <option value="week">week(s)</option>
                <option value="month">month(s)</option>
                <option value="year">year(s)</option>
              </select>
            </label>
          </div>

          {repeat.unit === 'week' && (
            <div className="field">
              <span>On</span>
              <div className="weekday-chips">
                {WEEKDAY_CHIPS.map((w, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`weekday-chip ${repeat.weekdays.includes(w.iso) ? 'on' : ''}`}
                    aria-pressed={repeat.weekdays.includes(w.iso)}
                    onClick={() => toggleWeekday(w.iso)}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <fieldset className="ends">
            <legend>Ends</legend>
            <label className="radio">
              <input type="radio" name="end" checked={repeat.end === 'never'} onChange={() => patch('end', 'never' as EndMode)} />
              Never
            </label>
            <label className="radio">
              <input type="radio" name="end" checked={repeat.end === 'on'} onChange={() => patch('end', 'on' as EndMode)} />
              On
              <input
                type="date"
                value={repeat.endDate}
                min={date}
                disabled={repeat.end !== 'on'}
                onChange={(e) => patch('endDate', e.target.value)}
              />
            </label>
            <label className="radio">
              <input type="radio" name="end" checked={repeat.end === 'after'} onChange={() => patch('end', 'after' as EndMode)} />
              After
              <input
                type="number"
                min={1}
                max={999}
                value={repeat.count}
                disabled={repeat.end !== 'after'}
                onChange={(e) => patch('count', Math.max(1, Number(e.target.value) || 1))}
              />
              occurrence(s)
            </label>
          </fieldset>
        </div>
      )}

      <p className={`editor-preview ${preview.ok ? '' : 'bad'}`}>{preview.text}</p>
      {error && <p className="editor-error">{error}</p>}

      <div className="editor-actions">
        <button className="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create reminder'}
        </button>
      </div>
    </Modal>
  );
}
