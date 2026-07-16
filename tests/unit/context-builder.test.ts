import { describe, it, expect } from 'vitest';
import { ContextBuilder, relativeTime } from '../../electron/conversation/context-builder';
import { ASSISTANT_TURN_JSON_SCHEMA } from '../../core/conversation/turn-schema';

const NOW = 1_752_314_400_000; // fixed "now" so relative times are deterministic

function builder(active: { title: string; nextFireAt: number }[]) {
  return new ContextBuilder({ listActive: () => active }, () => NOW, () => 'Asia/Kolkata');
}

describe('ContextBuilder', () => {
  // Regression #5 (46 §Regression) — guards EP-9's additive fill.
  it('always ships memories as a present, empty array', () => {
    const input = builder([]).build([], 'sys');
    expect(input.memories).toEqual([]);
    expect(Array.isArray(input.memories)).toBe(true);
  });

  // Regression #7 — titles + relative time only; NO ids, NO epoch-ms (31 §4.3).
  it('summarises reminders as titles + relative time only, never ids/timestamps', () => {
    const input = builder([
      { title: 'Call mom', nextFireAt: NOW + 2 * 60 * 60 * 1000 },
      { title: 'Standup', nextFireAt: NOW + 30 * 60 * 1000 },
    ]).build([], 'sys');

    expect(input.reminders).toEqual([
      { title: 'Call mom', relativeTime: 'in 2 hours' },
      { title: 'Standup', relativeTime: 'in 30 minutes' },
    ]);
    // No absolute time / id fields leaked into any summary.
    const serialized = JSON.stringify(input.reminders);
    expect(serialized).not.toContain(String(NOW));
    expect(serialized).not.toMatch(/nextFireAt|id"/);
  });

  it('caps the summary at 20 reminders (bounded context)', () => {
    const many = Array.from({ length: 50 }, (_v, i) => ({ title: `r${i}`, nextFireAt: NOW + 60_000 }));
    expect(builder(many).build([], 'sys').reminders).toHaveLength(20);
  });

  it('passes through system, now, timezone, messages, and the response schema', () => {
    const messages = [{ role: 'user' as const, text: 'hi' }];
    const input = builder([]).build(messages, 'You are Yogi.');
    expect(input.system).toBe('You are Yogi.');
    expect(input.nowIso).toBe(new Date(NOW).toISOString());
    expect(input.timezone).toBe('Asia/Kolkata');
    expect(input.messages).toEqual(messages);
    expect(input.responseSchema).toBe(ASSISTANT_TURN_JSON_SCHEMA);
  });
});

describe('relativeTime', () => {
  it('renders coarse, human-readable buckets', () => {
    expect(relativeTime(NOW - 1000, NOW)).toBe('now or overdue');
    expect(relativeTime(NOW + 60_000, NOW)).toBe('in 1 minute');
    expect(relativeTime(NOW + 45 * 60_000, NOW)).toBe('in 45 minutes');
    expect(relativeTime(NOW + 60 * 60_000, NOW)).toBe('in 1 hour');
    expect(relativeTime(NOW + 5 * 60 * 60_000, NOW)).toBe('in 5 hours');
    expect(relativeTime(NOW + 48 * 60 * 60_000, NOW)).toBe('in 2 days');
  });
});
