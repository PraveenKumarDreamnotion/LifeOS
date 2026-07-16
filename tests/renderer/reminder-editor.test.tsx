import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DateTime } from 'luxon';
import { ReminderEditor } from '../../src/features/schedules/ReminderEditor';
import type { ReminderDto } from '../../core/types/ipc';

const KOL = 'Asia/Kolkata';

const update = vi.fn(async (_id: string, patch: unknown) => ({ ok: true as const, data: { ...(patch as object), id: 'r1' } }));
const create = vi.fn(async (input: unknown) => ({ ok: true as const, data: { ...(input as object), id: 'r2' } }));

beforeEach(() => {
  update.mockClear();
  create.mockClear();
  // Minimal window.lifeos bridge — the editor only touches reminders.create/update on save.
  vi.stubGlobal('lifeos', { reminders: { update, create } });
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as { lifeos?: unknown }).lifeos = { reminders: { update, create } };
});

afterEach(() => cleanup());

/** A daily recurring reminder that has ALREADY fired: anchor (scheduledAt) is in the past,
 *  but nextFireAt is the upcoming occurrence (future). This is the exact state the seed bug hit. */
function firedDailyReminder(): ReminderDto {
  const anchor = DateTime.now().setZone(KOL).minus({ days: 5 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  const next = DateTime.now().setZone(KOL).plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  return {
    id: 'r1',
    title: 'Take vitamins',
    description: null,
    scheduledAt: anchor.toMillis(),
    nextFireAt: next.toMillis(),
    timezone: KOL,
    recurrenceRule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    actionType: 'notify',
    status: 'pending',
    source: 'manual',
    isPaused: false,
    sessionId: null,
    execution: null,
    createdAt: anchor.toMillis(),
    updatedAt: anchor.toMillis(),
    completedAt: null,
    lastTriggeredAt: null,
  };
}

describe('ReminderEditor', () => {
  it('saves an edit of an already-fired recurring reminder to a FUTURE time (regression: seed from nextFireAt)', async () => {
    render(<ReminderEditor reminder={firedDailyReminder()} onClose={() => {}} />);

    // Save unchanged — the seed must be the upcoming occurrence, not the past anchor.
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const [id, patch] = update.mock.calls[0]!;
    expect(id).toBe('r1');
    const p = patch as { scheduledAtUtcMs: number; recurrenceRule: string | null };
    expect(p.scheduledAtUtcMs).toBeGreaterThan(Date.now()); // would have failed with the scheduledAt seed
    expect(p.recurrenceRule).toBe('FREQ=DAILY;BYHOUR=9;BYMINUTE=0');
    // No "already passed" error surfaced.
    expect(screen.queryByText(/already passed/i)).toBeNull();
  });

  it('creates a new one-time reminder from the editor', async () => {
    render(<ReminderEditor onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. Drink water'), { target: { value: 'Call mom' } });
    fireEvent.click(screen.getByText('Create reminder'));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const [input] = create.mock.calls[0]!;
    const i = input as { title: string; recurrenceRule: string | null; scheduledAtUtcMs: number };
    expect(i.title).toBe('Call mom');
    expect(i.recurrenceRule).toBeNull();
    expect(i.scheduledAtUtcMs).toBeGreaterThan(Date.now());
  });
});
