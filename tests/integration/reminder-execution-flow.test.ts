import { describe, it, expect, vi } from 'vitest';
import { createTriggerSink } from '../../electron/scheduler/trigger-sink';
import { ReminderExecutor } from '../../electron/reminders/reminder-executor';
import type { Reminder } from '../../core/types/reminder';
import type { SearchProvider } from '../../core/search/search-provider';
import type { TextToSpeechProvider } from '../../core/tts/tts-provider';

/**
 * The reported fix, validated as a CHAIN (advisor #2): a fired ai_task reminder runs the real
 * executor through the real trigger-sink wiring and delivers + speaks the ANSWER (not the title),
 * while the unconditional notify/history still fire first. No audio, no keys — fully deterministic.
 * This mirrors the executeReminder closure wired in electron/main/index.ts.
 */
function reminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1', title: 'NIT Hamirpur contacts', description: null, scheduledAt: 1, nextFireAt: 1,
    timezone: 'UTC', recurrenceRule: null, actionType: 'notify', status: 'pending', source: 'local',
    isPaused: false, sessionId: 's1',
    execution: {
      version: 1, type: 'ai_task', instruction: 'Find the contact details of NIT Hamirpur.',
      capabilities: ['web_search'], outputFormat: 'spoken_answer', delivery: { notify: true, voice: true },
    },
    createdAt: 1, updatedAt: 1, completedAt: null, lastTriggeredAt: null, ...over,
  };
}

function harness(search: SearchProvider | null, r: Reminder) {
  const notify = vi.fn();
  const record = vi.fn();
  const delivered: { text: string }[] = [];
  const spoken: string[] = [];
  const executor = new ReminderExecutor({ searchProvider: () => search });

  // The deliver/speak fns the index.ts executeReminder closure would call.
  const deliverTextToChat = (rem: Reminder, text: string) => {
    if (rem.sessionId) delivered.push({ text });
  };
  const speakText = (text: string) => spoken.push(text);

  let executePromise: Promise<void> = Promise.resolve();
  const sink = createTriggerSink({
    notifier: { show: notify } as never,
    history: { record } as never,
    audioWindow: () => null,
    mainWindow: () => null,
    ttsEnabled: () => true,
    ttsProvider: () => ({}) as TextToSpeechProvider,
    ttsVoice: () => 'default',
    ttsRate: () => 1,
    setTtsDegraded: () => {},
    popupEnabled: () => false,
    deliverToChat: (rem) => deliverTextToChat(rem, `⏰ Reminder — ${rem.title}`),
    showReminder: () => {},
    executeReminder: (rem) => {
      executePromise = executor.execute(rem).then((outcome) => {
        if (outcome.kind === 'simple') return;
        deliverTextToChat(rem, outcome.delivered);
        if (rem.execution?.delivery.voice !== false) speakText(outcome.spoken);
      });
    },
  });

  sink.fire(r);
  return { notify, record, delivered, spoken, settle: () => executePromise };
}

describe('fired ai_task reminder — end-to-end trigger-sink + executor', () => {
  it('researches, then delivers + speaks the ANSWER (title delivery suppressed)', async () => {
    const search: SearchProvider = {
      id: 'fake',
      search: vi.fn().mockResolvedValue({
        answer: 'Phone: +91-1972-254001. Email: registrar@nith.ac.in.',
        citations: [{ title: 'NIT Hamirpur', url: 'https://nith.ac.in' }],
      }),
    };
    const h = harness(search, reminder());
    // Unconditional heads-up fired immediately.
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.record).toHaveBeenCalledTimes(1);

    await h.settle();

    // Exactly one chat delivery — the ANSWER, not the "⏰ Reminder — <title>" placeholder.
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0]!.text).toContain('254001');
    expect(h.delivered[0]!.text).not.toMatch(/^⏰ Reminder — NIT Hamirpur contacts$/);
    expect(h.delivered[0]!.text).toContain('Sources:');
    // The answer is spoken (voice-first), without the source URLs.
    expect(h.spoken).toHaveLength(1);
    expect(h.spoken[0]).toContain('254001');
    expect(h.spoken[0]).not.toContain('Sources:');
    expect(search.search).toHaveBeenCalledWith('Find the contact details of NIT Hamirpur.', expect.any(Object));
  });

  it('offline (no search provider) → still delivers + speaks an honest degrade message, never the title', async () => {
    const h = harness(null, reminder());
    await h.settle();
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0]!.text.toLowerCase()).toContain('web search');
    expect(h.spoken).toHaveLength(1);
    // The unconditional notification still fired regardless.
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('a plain (non-AI) reminder is unaffected — delivers the classic title line, no research', async () => {
    const search: SearchProvider = { id: 'fake', search: vi.fn() };
    const h = harness(search, reminder({ execution: null }));
    await h.settle();
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0]!.text).toBe('⏰ Reminder — NIT Hamirpur contacts');
    expect(search.search).not.toHaveBeenCalled();
  });
});
