import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReminderPopup, type PopupWindow } from '../../electron/main/reminder-popup';
import type { Reminder } from '../../core/types/reminder';
import type { ReminderPopupData } from '../../core/types/popup';

function reminder(id: string, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id, title: `Reminder ${id}`, description: null, scheduledAt: 1, nextFireAt: 1, timezone: 'UTC',
    recurrenceRule: null, actionType: 'notify', status: 'pending', source: 'local', isPaused: false,
    sessionId: null, execution: null, createdAt: 1, updatedAt: 1, completedAt: null, lastTriggeredAt: null, ...overrides,
  };
}

let shown: ReminderPopupData[]; // POPUP_SHOW payloads
let visible: boolean;
let win: PopupWindow;
let speak: ReturnType<typeof vi.fn>;
let position: ReturnType<typeof vi.fn>;
let repo: { get: ReturnType<typeof vi.fn>; markCompleted: ReturnType<typeof vi.fn>; markDismissed: ReturnType<typeof vi.fn>; snooze: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
let history: { record: ReturnType<typeof vi.fn> };
let onChanged: ReturnType<typeof vi.fn>;
let onQueueDrained: ReturnType<typeof vi.fn>;

beforeEach(() => {
  shown = [];
  visible = false;
  win = {
    isDestroyed: () => false,
    isVisible: () => visible,
    showInactive: () => { visible = true; },
    hide: () => { visible = false; },
    webContents: { send: (_c: string, p: unknown) => shown.push(p as ReminderPopupData) },
  };
  speak = vi.fn();
  position = vi.fn();
  repo = { get: vi.fn((id: string) => reminder(id)), markCompleted: vi.fn(), markDismissed: vi.fn(), snooze: vi.fn(), delete: vi.fn() };
  history = { record: vi.fn() };
  onChanged = vi.fn();
  onQueueDrained = vi.fn();
});

function make() {
  return createReminderPopup({
    window: () => win,
    position,
    reminders: repo,
    history,
    onChanged,
    speak,
    formatTime: () => '9:00 AM',
    onQueueDrained,
    now: () => 1000,
  });
}

describe('createReminderPopup — queue', () => {
  it('shows the first reminder inactive, positioned, and speaks it', () => {
    const p = make();
    p.enqueue(reminder('a'));
    expect(position).toHaveBeenCalledOnce();
    expect(visible).toBe(true);
    expect(speak).toHaveBeenCalledWith("Hi there. It's time to reminder a.");
    expect(shown.at(-1)).toMatchObject({ reminderId: 'a', queued: 0 });
  });

  it('queues later reminders behind the current one and shows "+N more"', () => {
    const p = make();
    p.enqueue(reminder('a'));
    p.enqueue(reminder('b'));
    p.enqueue(reminder('c'));
    // still showing 'a', with 2 queued
    expect(shown.at(-1)).toMatchObject({ reminderId: 'a', queued: 2 });
    expect(speak).toHaveBeenCalledTimes(1); // only 'a' spoke — voices don't overlap
  });

  it('advances FIFO as each is handled, then hides when the queue drains', () => {
    const p = make();
    p.enqueue(reminder('a'));
    p.enqueue(reminder('b'));
    p.handleAction({ reminderId: 'a', action: 'hide' }); // ✕ on a → next is b
    expect(shown.at(-1)).toMatchObject({ reminderId: 'b', queued: 0 });
    expect(speak).toHaveBeenCalledTimes(2); // b now spoke
    p.handleAction({ reminderId: 'b', action: 'hide' }); // queue empty → hide
    expect(visible).toBe(false);
  });

  it('ignores a duplicate enqueue of the same reminder', () => {
    const p = make();
    p.enqueue(reminder('a'));
    p.enqueue(reminder('a'));
    expect(shown.at(-1)).toMatchObject({ reminderId: 'a', queued: 0 });
  });
});

describe('createReminderPopup — lifecycle actions', () => {
  it('Complete marks completed + records history + advances', () => {
    const p = make();
    p.enqueue(reminder('a'));
    const res = p.handleAction({ reminderId: 'a', action: 'complete' });
    expect(res.ok).toBe(true);
    expect(repo.markCompleted).toHaveBeenCalledWith('a');
    expect(history.record).toHaveBeenCalledWith('a', 'Reminder a', 1000, 'completed');
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('Dismiss marks dismissed', () => {
    const p = make();
    p.enqueue(reminder('a'));
    p.handleAction({ reminderId: 'a', action: 'dismiss' });
    expect(repo.markDismissed).toHaveBeenCalledWith('a');
  });

  it('Snooze snoozes a one-time reminder; ✕/hide touches nothing', () => {
    const p = make();
    p.enqueue(reminder('a'));
    p.handleAction({ reminderId: 'a', action: 'snooze', minutes: 30 });
    expect(repo.snooze).toHaveBeenCalledWith('a', 30);

    const p2 = make();
    p2.enqueue(reminder('b'));
    p2.handleAction({ reminderId: 'b', action: 'hide' });
    expect(repo.markCompleted).not.toHaveBeenCalledWith('b');
    expect(repo.markDismissed).not.toHaveBeenCalledWith('b');
  });

  it('does NOT snooze a recurring reminder', () => {
    const p = make();
    repo.get.mockImplementation((id: string) => reminder(id, { recurrenceRule: 'FREQ=DAILY' }));
    p.enqueue(reminder('a', { recurrenceRule: 'FREQ=DAILY' }));
    p.handleAction({ reminderId: 'a', action: 'snooze', minutes: 30 });
    expect(repo.snooze).not.toHaveBeenCalled();
  });

  it('rejects an action for a reminder that is not the one currently shown', () => {
    const p = make();
    p.enqueue(reminder('a'));
    const res = p.handleAction({ reminderId: 'b', action: 'complete' }); // b is not shown
    expect(res.ok).toBe(false);
    expect(repo.markCompleted).not.toHaveBeenCalled();
  });
});

describe('createReminderPopup — natural-language lifecycle (handleMessage)', () => {
  it('"done" completes the shown reminder', () => {
    const p = make();
    p.enqueue(reminder('a'));
    const res = p.handleMessage('a', 'done, I already called him');
    expect(res.action).toBe('completed');
    expect(repo.markCompleted).toHaveBeenCalledWith('a');
    expect(res.reply).toMatch(/complete/i);
  });

  it('"snooze 30 minutes" snoozes a one-time reminder', () => {
    const p = make();
    p.enqueue(reminder('a'));
    const res = p.handleMessage('a', 'snooze 30 minutes');
    expect(res.action).toBe('snoozed');
    expect(repo.snooze).toHaveBeenCalledWith('a', 30);
    expect(res.reply).toContain('30 minutes');
  });

  it('does not snooze a recurring reminder — replies conversationally', () => {
    const p = make();
    repo.get.mockImplementation((id: string) => reminder(id, { recurrenceRule: 'FREQ=DAILY' }));
    p.enqueue(reminder('a', { recurrenceRule: 'FREQ=DAILY' }));
    const res = p.handleMessage('a', 'snooze an hour');
    expect(repo.snooze).not.toHaveBeenCalled();
    expect(res.action).toBeUndefined();
    expect(res.reply).toMatch(/repeats/i);
  });

  it('"cancel" asks to confirm, and only a "yes" deletes', () => {
    const p = make();
    p.enqueue(reminder('a'));
    const ask = p.handleMessage('a', 'cancel this reminder');
    expect(ask.reply).toMatch(/delete this reminder/i);
    expect(repo.delete).not.toHaveBeenCalled(); // not yet

    const yes = p.handleMessage('a', 'yes');
    expect(yes.action).toBe('deleted');
    expect(repo.delete).toHaveBeenCalledWith('a');
  });

  it('"cancel" then "no" keeps the reminder', () => {
    const p = make();
    p.enqueue(reminder('a'));
    p.handleMessage('a', 'delete it');
    const no = p.handleMessage('a', 'no, keep it');
    expect(repo.delete).not.toHaveBeenCalled();
    expect(no.reply).toMatch(/kept it/i);
  });

  it('a question falls through to chat ({ chat: true })', () => {
    const p = make();
    p.enqueue(reminder('a'));
    const res = p.handleMessage('a', 'what was this reminder about?');
    expect(res.chat).toBe(true);
    expect(repo.markCompleted).not.toHaveBeenCalled();
  });

  it('onQueueDrained fires when the LAST reminder is handled (resume signal), not before', () => {
    const p = make();
    p.enqueue(reminder('a'));
    p.enqueue(reminder('b'));
    // Complete 'a' → advances to 'b'; queue not yet drained.
    p.handleAction({ reminderId: 'a', action: 'complete' });
    expect(onQueueDrained).not.toHaveBeenCalled();
    // Complete 'b' → queue drains → resume signal fires exactly once.
    p.handleAction({ reminderId: 'b', action: 'complete' });
    expect(onQueueDrained).toHaveBeenCalledTimes(1);
  });
});
