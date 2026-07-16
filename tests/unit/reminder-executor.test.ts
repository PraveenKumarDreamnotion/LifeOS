import { describe, it, expect, vi } from 'vitest';
import { ReminderExecutor } from '../../electron/reminders/reminder-executor';
import type { Reminder } from '../../core/types/reminder';
import type { ReminderExecutionSpec } from '../../core/types/reminder-execution';
import type { SearchProvider, SearchAnswer } from '../../core/search/search-provider';

function reminder(execution: ReminderExecutionSpec | null, over: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1', title: 'NIT Hamirpur contacts', description: null, scheduledAt: 1, nextFireAt: 1,
    timezone: 'UTC', recurrenceRule: null, actionType: 'notify', status: 'pending', source: 'local',
    isPaused: false, sessionId: 's1', execution, createdAt: 1, updatedAt: 1, completedAt: null,
    lastTriggeredAt: null, ...over,
  };
}

const aiSpec = (over: Partial<ReminderExecutionSpec> = {}): ReminderExecutionSpec => ({
  version: 1, type: 'ai_task', instruction: 'Find the contact details of NIT Hamirpur.',
  capabilities: ['web_search'], outputFormat: 'spoken_answer', delivery: { notify: true, voice: true }, ...over,
});

const fakeSearch = (answer: SearchAnswer): SearchProvider => ({
  id: 'fake',
  search: vi.fn().mockResolvedValue(answer),
});

describe('ReminderExecutor', () => {
  it('a non-AI (null) reminder → simple (caller does classic notify)', async () => {
    const ex = new ReminderExecutor({ searchProvider: () => null });
    expect((await ex.execute(reminder(null))).kind).toBe('simple');
  });

  it('a read-only web_search task executes and returns the grounded answer', async () => {
    const search = fakeSearch({
      answer: 'Phone: +91-1972-254001. Email: registrar@nith.ac.in.',
      citations: [{ title: 'NIT Hamirpur', url: 'https://nith.ac.in' }],
    });
    const ex = new ReminderExecutor({ searchProvider: () => search });
    const out = await ex.execute(reminder(aiSpec()));
    expect(out.kind).toBe('answered');
    if (out.kind === 'answered') {
      expect(out.spoken).toContain('254001');
      expect(out.delivered).toContain('NIT Hamirpur contacts'); // title header
      expect(out.delivered).toContain('Sources:'); // citation appended to the delivered text
      expect(out.spoken).not.toContain('Sources:'); // spoken excludes URLs
    }
    expect(search.search).toHaveBeenCalledWith('Find the contact details of NIT Hamirpur.', expect.any(Object));
  });

  it('an empty capability list defaults to research (still searches)', async () => {
    const search = fakeSearch({ answer: 'ok', citations: [] });
    const ex = new ReminderExecutor({ searchProvider: () => search });
    const out = await ex.execute(reminder(aiSpec({ capabilities: [] })));
    expect(out.kind).toBe('answered');
    expect(search.search).toHaveBeenCalled();
  });

  it('a WRITE capability never auto-runs — it asks for confirmation and does NOT search', async () => {
    const search = fakeSearch({ answer: 'x', citations: [] });
    const ex = new ReminderExecutor({ searchProvider: () => search });
    const out = await ex.execute(reminder(aiSpec({ capabilities: ['web_search', 'email_send'] })));
    expect(out.kind).toBe('needs_confirmation');
    expect(search.search).not.toHaveBeenCalled();
  });

  it('web search off/offline → degraded with an honest, actionable message', async () => {
    const ex = new ReminderExecutor({ searchProvider: () => null });
    const out = await ex.execute(reminder(aiSpec()));
    expect(out.kind).toBe('degraded');
    if (out.kind === 'degraded') {
      expect(out.reason).toBe('no_search_provider');
      expect(out.delivered.toLowerCase()).toContain('web search');
    }
  });

  it('a read-only capability we cannot execute yet → degraded, not a crash', async () => {
    const ex = new ReminderExecutor({ searchProvider: () => fakeSearch({ answer: 'x', citations: [] }) });
    const out = await ex.execute(reminder(aiSpec({ capabilities: ['weather'] })));
    expect(out.kind).toBe('degraded');
    if (out.kind === 'degraded') expect(out.reason).toBe('unsupported_capability');
  });

  it('a search failure degrades (never throws)', async () => {
    const search: SearchProvider = { id: 'fake', search: vi.fn().mockRejectedValue(new Error('network down')) };
    const ex = new ReminderExecutor({ searchProvider: () => search });
    const out = await ex.execute(reminder(aiSpec()));
    expect(out.kind).toBe('degraded');
    if (out.kind === 'degraded') expect(out.reason).toBe('search_failed');
  });

  it('respects a hard deadline (aborts a hung search → timeout)', async () => {
    const search: SearchProvider = {
      id: 'slow',
      search: (_q, signal) =>
        new Promise((_res, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted')))),
    };
    const ex = new ReminderExecutor({ searchProvider: () => search, deadlineMs: 20 });
    const out = await ex.execute(reminder(aiSpec()));
    expect(out.kind).toBe('degraded');
    if (out.kind === 'degraded') expect(out.reason).toBe('timeout');
  });
});
