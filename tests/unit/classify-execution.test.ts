import { describe, it, expect } from 'vitest';
import { classifyReminderExecution, executionSummaryLead } from '../../core/parsing/classify-execution';
import { reminderCreateEnvelope } from '../../electron/conversation/conversation-engine';
import type { ParsedReminder } from '../../core/parsing/types';

describe('classifyReminderExecution', () => {
  it('classifies info-retrieval reminders as ai_task with web_search', () => {
    for (const title of [
      'Tell me the contact details of NIT Hamirpur',
      'Find the opening hours of the passport office',
      'Look up tomorrow’s weather in Shimla',
      'What is the exchange rate for USD to INR',
      'NIT Hamirpur contact details', // info-noun, no lead verb
      'Get me the latest news on the budget',
    ]) {
      const spec = classifyReminderExecution(title);
      expect(spec, title).not.toBeNull();
      expect(spec!.type).toBe('ai_task');
      expect(spec!.capabilities).toEqual(['web_search']);
      expect(spec!.instruction.length).toBeGreaterThan(0);
    }
  });

  it('does NOT classify user-action reminders (they stay plain reminders)', () => {
    for (const title of [
      'Call mom',
      'Drink water',
      'Submit the tax report',
      'Tell mom happy birthday', // "tell mom", not "tell me"
      'Take medicine',
      'Pay the electricity bill',
    ]) {
      expect(classifyReminderExecution(title), title).toBeNull();
    }
  });

  it('builds a lookup instruction by stripping leading politeness', () => {
    const spec = classifyReminderExecution('Tell me the contact details of NIT Hamirpur')!;
    expect(spec.instruction).toBe('The contact details of NIT Hamirpur');
  });

  it('executionSummaryLead states the intent for the confirmation card', () => {
    const spec = classifyReminderExecution('Tell me the contact details of NIT Hamirpur')!;
    expect(executionSummaryLead(spec)).toBe("I'll look up the contact details of NIT Hamirpur and tell you");
  });
});

describe('reminderCreateEnvelope — execution capture', () => {
  const base: ParsedReminder = {
    title: 'Tell me the contact details of NIT Hamirpur',
    description: null,
    scheduledAtUtcMs: Date.UTC(2026, 6, 15, 3, 30), // 9:00 AM Asia/Kolkata
    timezone: 'Asia/Kolkata',
    recurrenceRule: null,
    actionType: 'notify',
  } as ParsedReminder;

  it('attaches an ai_task spec and an intent-stating summary for an info reminder', () => {
    const env = reminderCreateEnvelope(base, 't1', 's1');
    expect(env.action.kind).toBe('reminder_create');
    if (env.action.kind === 'reminder_create') {
      expect(env.action.input.execution?.type).toBe('ai_task');
      expect(env.action.summary).toContain("I'll look up the contact details of NIT Hamirpur and tell you");
      expect(env.action.summary).toContain('one-time');
    }
  });

  it('leaves a plain reminder with no execution spec and the classic title summary', () => {
    const env = reminderCreateEnvelope({ ...base, title: 'Call mom' }, 't2', 's1');
    if (env.action.kind === 'reminder_create') {
      // Key omitted (byte-identical to the direct path) → no AI task.
      expect(env.action.input.execution ?? null).toBeNull();
      expect(env.action.summary.startsWith('Call mom ·')).toBe(true);
    }
  });

  it('never classifies a sing reminder as an AI task', () => {
    const env = reminderCreateEnvelope({ ...base, actionType: 'sing', title: 'Play Yogi song' }, 't3', 's1');
    if (env.action.kind === 'reminder_create') expect(env.action.input.execution ?? null).toBeNull();
  });
});
