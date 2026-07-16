import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfirmationStore } from '../../electron/actions/confirmation-store';
import type { Action } from '../../core/actions/action';

const ACTION: Action = {
  kind: 'reminder_create',
  summary: 'Call Rahul · tomorrow 9:00 AM · one-time',
  input: {
    title: 'Call Rahul',
    description: null,
    scheduledAtUtcMs: Date.now() + 600_000,
    timezone: 'Asia/Kolkata',
    recurrenceRule: null,
    actionType: 'notify',
    source: 'local',
  },
};

afterEach(() => vi.useRealTimers());

describe('ConfirmationStore', () => {
  it('take returns the stored action once, then is empty (single-use)', () => {
    const store = new ConfirmationStore(() => {});
    store.put('t1', ACTION, 'local', 'sess-1');
    expect(store.has('t1')).toBe(true);
    expect(store.take('t1')).toEqual({ action: ACTION, source: 'local', sessionId: 'sess-1' });
    expect(store.has('t1')).toBe(false);
    expect(store.take('t1')).toBeUndefined(); // second take → nothing
  });

  it('take on an unknown turnId returns undefined', () => {
    const store = new ConfirmationStore(() => {});
    expect(store.take('nope')).toBeUndefined();
  });

  it('clear removes a pending proposal without firing onTimeout', () => {
    const onTimeout = vi.fn();
    const store = new ConfirmationStore(onTimeout);
    store.put('t1', ACTION, 'local');
    store.clear('t1');
    expect(store.has('t1')).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('expires after the timeout (= cancel), removing it and notifying', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const store = new ConfirmationStore(onTimeout, 90_000);
    store.put('t1', ACTION, 'local');
    vi.advanceTimersByTime(90_000);
    expect(onTimeout).toHaveBeenCalledWith('t1');
    expect(store.has('t1')).toBe(false);
    expect(store.take('t1')).toBeUndefined(); // expired = gone, never auto-confirmed
  });

  it('currentOpen tracks the pending proposal a voice "yes" targets', () => {
    const store = new ConfirmationStore(() => {});
    expect(store.currentOpen()).toBeUndefined();
    store.put('t1', ACTION, 'local');
    expect(store.currentOpen()).toBe('t1');
    store.take('t1'); // confirmed/consumed
    expect(store.currentOpen()).toBeUndefined();
  });

  it('currentOpen clears on cancel and on expiry', () => {
    vi.useFakeTimers();
    const store = new ConfirmationStore(() => {}, 90_000);
    store.put('a', ACTION, 'local');
    store.clear('a');
    expect(store.currentOpen()).toBeUndefined();
    store.put('b', ACTION, 'local');
    vi.advanceTimersByTime(90_000);
    expect(store.currentOpen()).toBeUndefined();
  });

  it('peek reads the stored action without consuming it', () => {
    const store = new ConfirmationStore(() => {});
    store.put('t1', ACTION, 'local');
    expect(store.peek('t1')).toBe(ACTION);
    expect(store.has('t1')).toBe(true); // still pending
  });

  it('a superseding put replaces the prior proposal for the same turn', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const store = new ConfirmationStore(onTimeout, 90_000);
    store.put('t1', ACTION, 'local');
    const action2 = { ...ACTION, summary: 'second' };
    store.put('t1', action2, 'local');
    vi.advanceTimersByTime(90_000); // only ONE timer should remain
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
