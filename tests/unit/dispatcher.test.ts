import { describe, it, expect, vi } from 'vitest';
import { ActionDispatcher } from '../../electron/actions/dispatcher';
import { ConfirmationStore } from '../../electron/actions/confirmation-store';
import { executeAction } from '../../electron/actions/execute';
import type { Action } from '../../core/actions/action';

function makeAction(overrides: Partial<Action['input']> = {}): Action {
  return {
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
      ...overrides,
    },
  };
}

function makeDispatcher(opts: { validate?: () => void } = {}) {
  const store = new ConfirmationStore(() => {});
  const createReminder = vi.fn((_input: unknown, _sessionId: string | null) => 'rem-created');
  const validate = vi.fn(opts.validate);
  const dispatcher = new ActionDispatcher({
    store,
    validate,
    execute: (action, source, sessionId) => executeAction(action, source, { createReminder }, sessionId),
  });
  return { dispatcher, store, createReminder, validate };
}

describe('ActionDispatcher', () => {
  it('propose validates, stores, and returns a display proposal (nothing persisted yet)', () => {
    const { dispatcher, store, createReminder, validate } = makeDispatcher();
    const r = dispatcher.propose({ action: makeAction(), source: 'local', turnId: 't1' });
    expect('proposal' in r && r.proposal).toBeTruthy();
    expect('proposal' in r && r.proposal.summary).toContain('Call Rahul');
    expect(validate).toHaveBeenCalledTimes(1);
    expect(store.has('t1')).toBe(true);
    expect(createReminder).not.toHaveBeenCalled(); // NOT executed until confirm
  });

  it('propose returns an error (and stores nothing) when the business-rule gate rejects', () => {
    const { dispatcher, store, createReminder } = makeDispatcher({
      validate: () => {
        throw { code: 'date_in_past', message: 'That time has already passed.' };
      },
    });
    const r = dispatcher.propose({ action: makeAction(), source: 'local', turnId: 't1' });
    expect('error' in r && r.error.code).toBe('date_in_past');
    expect(store.has('t1')).toBe(false);
    expect(createReminder).not.toHaveBeenCalled();
  });

  it('confirm executes the STORED proposal and reports success', () => {
    const { dispatcher, createReminder } = makeDispatcher();
    dispatcher.propose({ action: makeAction(), source: 'local', turnId: 't1' });
    const res = dispatcher.confirm('t1');
    expect(res).toEqual({ ok: true, summary: 'Call Rahul · tomorrow 9:00 AM · one-time', reminderId: 'rem-created' });
    expect(createReminder).toHaveBeenCalledTimes(1);
    expect(createReminder.mock.calls[0]![0]).toMatchObject({ title: 'Call Rahul', source: 'local' });
  });

  it('confirm is single-use — a second confirm for the same turn is rejected', () => {
    const { dispatcher, createReminder } = makeDispatcher();
    dispatcher.propose({ action: makeAction(), source: 'local', turnId: 't1' });
    dispatcher.confirm('t1');
    const second = dispatcher.confirm('t1');
    expect(second).toEqual({ ok: false, code: 'no_pending_proposal', message: expect.any(String) });
    expect(createReminder).toHaveBeenCalledTimes(1); // not executed twice
  });

  it('confirm on an unknown/forged/expired turnId is rejected (pending-proposal invariant)', () => {
    const { dispatcher, createReminder } = makeDispatcher();
    const res = dispatcher.confirm('forged-id');
    expect(res).toEqual({ ok: false, code: 'no_pending_proposal', message: expect.any(String) });
    expect(createReminder).not.toHaveBeenCalled();
  });

  it('cancel clears the pending proposal so a later confirm is rejected', () => {
    const { dispatcher, createReminder } = makeDispatcher();
    dispatcher.propose({ action: makeAction(), source: 'local', turnId: 't1' });
    dispatcher.cancel('t1');
    expect(dispatcher.confirm('t1').ok).toBe(false);
    expect(createReminder).not.toHaveBeenCalled();
  });

  it('threads the sessionId from propose → confirm → execute (links the reminder to its chat)', () => {
    const { dispatcher, createReminder } = makeDispatcher();
    dispatcher.propose({ action: makeAction(), source: 'local', turnId: 't1', sessionId: 'sess-abc' });
    dispatcher.confirm('t1');
    expect(createReminder.mock.calls[0]![1]).toBe('sess-abc'); // 2nd arg = sessionId, not dropped
  });

  it('maps provenance: an llm-sourced create persists source="llm"', () => {
    const { dispatcher, createReminder } = makeDispatcher();
    // (In Scope A fields are parser-produced=local; this asserts the mapping path itself.)
    dispatcher.propose({ action: makeAction(), source: 'llm', turnId: 't1' });
    dispatcher.confirm('t1');
    expect(createReminder.mock.calls[0]![0]).toMatchObject({ source: 'llm' });
  });
});
