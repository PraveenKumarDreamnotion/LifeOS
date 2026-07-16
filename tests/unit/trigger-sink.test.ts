import { describe, it, expect, vi } from 'vitest';
import { createTriggerSink } from '../../electron/scheduler/trigger-sink';
import type { Reminder } from '../../core/types/reminder';
import type { TextToSpeechProvider } from '../../core/tts/tts-provider';

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    title: 'Call Rahul',
    description: null,
    scheduledAt: 1,
    nextFireAt: 1,
    timezone: 'UTC',
    recurrenceRule: null,
    actionType: 'notify',
    status: 'pending',
    source: 'local',
    isPaused: false,
    sessionId: null,
    execution: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    lastTriggeredAt: null,
    ...overrides,
  };
}

function makeSink(deliverToChat?: (r: Reminder) => void, executeReminder?: (r: Reminder) => void) {
  const notify = vi.fn();
  const record = vi.fn();
  const showReminder = vi.fn();
  const sink = createTriggerSink({
    notifier: { show: notify } as never,
    history: { record } as never,
    audioWindow: () => null, // best-effort tts/audio steps skip
    mainWindow: () => null, // ui step skips
    ttsEnabled: () => false,
    ttsProvider: () => ({}) as TextToSpeechProvider,
    ttsVoice: () => 'default',
    ttsRate: () => 1,
    setTtsDegraded: () => {},
    deliverToChat,
    showReminder,
    executeReminder,
    popupEnabled: () => false,
  });
  return { sink, notify, record, showReminder };
}

const AI_SPEC = {
  version: 1 as const,
  type: 'ai_task' as const,
  instruction: 'Find the contact details of NIT Hamirpur.',
  capabilities: ['web_search' as const],
  outputFormat: 'spoken_answer' as const,
  delivery: { notify: true, voice: true },
};

describe('trigger-sink — conversational delivery (DELIVERY)', () => {
  it('always notifies + records history (unconditional, first)', () => {
    const { sink, notify, record } = makeSink();
    sink.fire(reminder());
    expect(notify).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('delivers into the chat when the reminder has a sessionId', () => {
    const deliverToChat = vi.fn();
    const { sink } = makeSink(deliverToChat);
    const r = reminder({ sessionId: 'sess-1' });
    sink.fire(r);
    expect(deliverToChat).toHaveBeenCalledWith(r);
  });

  it('does NOT deliver into a chat for a null-session reminder (today’s behavior exactly)', () => {
    const deliverToChat = vi.fn();
    const { sink, notify, record } = makeSink(deliverToChat);
    sink.fire(reminder({ sessionId: null }));
    expect(deliverToChat).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1); // still notified + recorded, unchanged
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('a throw in chat delivery never blocks the notification (best-effort)', () => {
    const deliverToChat = vi.fn(() => {
      throw new Error('db busy');
    });
    const { sink, notify } = makeSink(deliverToChat);
    expect(() => sink.fire(reminder({ sessionId: 'sess-1' }))).not.toThrow();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe('trigger-sink — conversation interruption (pause on fire)', () => {
  function sinkWith(popupEnabled: boolean, pauseConversation: () => void) {
    return createTriggerSink({
      notifier: { show: vi.fn() } as never,
      history: { record: vi.fn() } as never,
      audioWindow: () => null,
      mainWindow: () => null,
      ttsEnabled: () => false,
      ttsProvider: () => ({}) as TextToSpeechProvider,
      ttsVoice: () => 'default',
      ttsRate: () => 1,
      setTtsDegraded: () => {},
      showReminder: vi.fn(),
      popupEnabled: () => popupEnabled,
      pauseConversation,
    });
  }

  it('pauses the conversation before speaking when the popup is enabled', () => {
    const pause = vi.fn();
    sinkWith(true, pause).fire(reminder());
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('does NOT pause when the popup is off (legacy modal owns the surface, no resume signal)', () => {
    const pause = vi.fn();
    sinkWith(false, pause).fire(reminder());
    expect(pause).not.toHaveBeenCalled();
  });
});

describe('trigger-sink — ai_task execution (reminder-execution)', () => {
  it('an ai_task reminder runs the executor and suppresses the default title delivery', () => {
    const deliverToChat = vi.fn();
    const executeReminder = vi.fn();
    const { sink, notify, record } = makeSink(deliverToChat, executeReminder);
    const r = reminder({ sessionId: 'sess-1', execution: AI_SPEC });
    sink.fire(r);
    // Notify + history stay UNCONDITIONAL.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    // The executor runs; the plain title delivery is suppressed (the answer replaces it).
    expect(executeReminder).toHaveBeenCalledWith(r);
    expect(deliverToChat).not.toHaveBeenCalled();
  });

  it('a plain reminder still uses the default delivery and does NOT invoke the executor', () => {
    const deliverToChat = vi.fn();
    const executeReminder = vi.fn();
    const { sink } = makeSink(deliverToChat, executeReminder);
    const r = reminder({ sessionId: 'sess-1', execution: null });
    sink.fire(r);
    expect(deliverToChat).toHaveBeenCalledWith(r);
    expect(executeReminder).not.toHaveBeenCalled();
  });

  it('with no executor wired, an ai_task reminder falls back to the default title delivery', () => {
    const deliverToChat = vi.fn();
    const { sink } = makeSink(deliverToChat, undefined);
    const r = reminder({ sessionId: 'sess-1', execution: AI_SPEC });
    sink.fire(r);
    expect(deliverToChat).toHaveBeenCalledWith(r); // graceful — behaves like a plain reminder
  });

  it('a throw in the executor never blocks the notification (best-effort)', () => {
    const executeReminder = vi.fn(() => {
      throw new Error('boom');
    });
    const { sink, notify } = makeSink(undefined, executeReminder);
    expect(() => sink.fire(reminder({ sessionId: 'sess-1', execution: AI_SPEC }))).not.toThrow();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
