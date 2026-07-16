import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// controller.ts imports electron for globalShortcut/BrowserWindow. Only globalShortcut is called
// (registerShortcut); BrowserWindow is a type. Stub the module so the controller imports under
// vitest-node.
vi.mock('electron', () => ({
  BrowserWindow: class {},
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
}));

const { DesktopVoiceController } = await import('../../electron/main/desktop-voice/controller');
const { CH } = await import('../../core/types/channels');

const BASE_TIME = 1_700_000_000_000;

function harness(opts?: { getSttAutoSubmit?: () => boolean }) {
  const win = {
    isDestroyed: () => false,
    hide: vi.fn(),
    webContents: { send: vi.fn(), id: 1 },
  };
  const windowApi = {
    ensure: vi.fn(() => win),
    current: vi.fn(() => win),
    show: vi.fn(),
    positionOnShow: vi.fn(),
    setInteractive: vi.fn(),
    setHovered: vi.fn(),
  };

  let counter = 0;
  let clock = 0;
  const sessions = new Map<string, { id: string; title: string; updatedAt: number; emailMessageId?: string | null }>();
  const turns = new Map<string, unknown[]>();
  const chat = {
    createSession: vi.fn(() => {
      const id = `sess-${++counter}`;
      sessions.set(id, { id, title: 'New chat', updatedAt: ++clock, emailMessageId: null });
      turns.set(id, []);
      return { id };
    }),
    loadTurns: vi.fn((id: string) => turns.get(id) ?? []),
    deleteSession: vi.fn((id: string) => {
      sessions.delete(id);
      turns.delete(id);
    }),
    getSession: vi.fn((id: string) => sessions.get(id) ?? null),
    getTurn: vi.fn((id: string) => ({
      id,
      sessionId: 'sess-1',
      kind: 'chat',
      userText: 'hi',
      assistantText: 'reply',
      intent: null,
      proposalSummary: null,
      proposalStatus: null,
      reminderId: null,
      createdAt: 0,
    })),
    rename: vi.fn((id: string, title: string) => {
      const s = sessions.get(id);
      if (s) s.title = title;
    }),
    // Mirrors the repo's `ORDER BY updated_at DESC` with newest-first.
    listSessions: vi.fn(() => [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)),
    // Newest non-email chat — the launcher continuity fallback (Phase 3).
    mostRecentConversation: vi.fn(
      () => [...sessions.values()].filter((s) => !s.emailMessageId).sort((a, b) => b.updatedAt - a.updatedAt)[0],
    ),
    // Newest chat of ANY kind (Issue 3), email winning an exact tie — what the manual-launch resolver
    // uses so a freshly-delivered email/reminder surfaces first.
    mostRelevantConversation: vi.fn(
      () =>
        [...sessions.values()].sort(
          (a, b) => b.updatedAt - a.updatedAt || (b.emailMessageId ? 1 : 0) - (a.emailMessageId ? 1 : 0),
        )[0],
    ),
  };

  // Simulate a delivery bumping a session's updated_at (email/reminder), optionally as an email chat.
  const touchSession = (id: string, opts?: { email?: boolean }) => {
    const s = sessions.get(id);
    if (s) {
      s.updatedAt = ++clock;
      if (opts?.email) s.emailMessageId = `email-${id}`;
    }
  };
  const addEmailChat = () => {
    const id = `email-sess-${++counter}`;
    sessions.set(id, { id, title: '📧 New email', updatedAt: ++clock, emailMessageId: id });
    turns.set(id, []);
    return id;
  };

  const startTurn = vi.fn(() => 'turn-1');
  const settings = {
    get: vi.fn((k: string) => (k === 'desktop_voice_shortcut_enabled' ? 'true' : '')),
    set: vi.fn(),
  };
  const broadcasts: Array<{ ch: string; payload: unknown }> = [];
  const broadcast = vi.fn((ch: string, payload?: unknown) => {
    broadcasts.push({ ch, payload });
  });
  const stopSpeaking = vi.fn();
  const speak = vi.fn();

  // The shared active-conversation pointer (single source of truth, owned by main in production).
  let activeSessionId: string | null = null;
  const getActiveSessionId = vi.fn(() => activeSessionId);
  const setActiveSessionId = vi.fn((id: string) => {
    activeSessionId = id;
  });

  const controller = new DesktopVoiceController({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chat: chat as any,
    startTurn,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: settings as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window: windowApi as any,
    broadcast,
    stopSpeaking,
    speak,
    getActiveSessionId,
    setActiveSessionId,
    getSttAutoSubmit: opts?.getSttAutoSubmit,
  });

  return {
    controller, win, windowApi, chat, startTurn, settings, broadcast, broadcasts, stopSpeaking, speak, turns,
    getActiveSessionId, setActiveSessionId, setPointer: setActiveSessionId, touchSession, addEmailChat,
  };
}

/** Advance the fake clock past the 400ms shortcut debounce, then press the global shortcut. */
function press(controller: InstanceType<typeof DesktopVoiceController>) {
  vi.advanceTimersByTime(500);
  controller.toggleListening();
}

/** Drive a full send: press (listen) → press (stop) → review → send. Returns the session id used. */
function sendOnce(h: ReturnType<typeof harness>, text = 'hello there') {
  press(h.controller); // listening
  press(h.controller); // processing
  const sessionId = h.controller.snapshot().sessionId!;
  h.controller.markReviewReady(sessionId);
  const turnId = h.controller.sendTranscript(sessionId, text);
  h.turns.set(sessionId, [...(h.turns.get(sessionId) ?? []), { id: turnId }]); // the engine recorded a turn
  h.controller.markTurnDone(turnId);
  h.controller.setSpeaking(true);
  h.controller.setSpeaking(false); // TTS done → idle
  return sessionId;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_TIME);
});
afterEach(() => vi.useRealTimers());

describe('DesktopVoiceController — Issue A (shortcut / recording state machine)', () => {
  it('first press with no chats: creates the first conversation, shows launcher, begins listening', () => {
    const h = harness();
    press(h.controller);

    expect(h.controller.snapshot().phase).toBe('listening');
    expect(h.chat.createSession).toHaveBeenCalledTimes(1);
    expect(h.windowApi.show).toHaveBeenCalledTimes(1);
    const sessionId = h.controller.snapshot().sessionId;
    expect(sessionId).toBe('sess-1');
    expect(h.setActiveSessionId).toHaveBeenCalledWith('sess-1'); // pointer set
    expect(h.win.webContents.send).toHaveBeenCalledWith(CH.LAUNCHER_BEGIN_LISTENING, { sessionId });
    expect(h.broadcasts.some((b) => b.ch === CH.LAUNCHER_SESSION_ACTIVATED)).toBe(true);
  });

  it('second press: stops recording (processing) and never creates a second conversation', () => {
    const h = harness();
    press(h.controller); // listening
    press(h.controller); // stop

    expect(h.controller.snapshot().phase).toBe('processing');
    expect(h.chat.createSession).toHaveBeenCalledTimes(1);
    expect(h.win.webContents.send).toHaveBeenCalledWith(CH.LAUNCHER_STOP_LISTENING);
  });

  it('finalized transcript enters Review and makes the launcher interactive', () => {
    const h = harness();
    press(h.controller);
    press(h.controller);
    const sessionId = h.controller.snapshot().sessionId!;
    h.controller.markReviewReady(sessionId);

    expect(h.controller.snapshot().phase).toBe('review');
    expect(h.windowApi.setInteractive).toHaveBeenLastCalledWith(true);
  });

  it('CONTINUITY: a press after a completed send continues the SAME conversation (no new chat)', () => {
    const h = harness();
    const first = sendOnce(h); // one conversation, one turn
    expect(h.controller.snapshot().phase).toBe('idle');
    expect(h.chat.createSession).toHaveBeenCalledTimes(1);

    press(h.controller); // "third press" — used to start a new chat; must now CONTINUE
    expect(h.controller.snapshot().phase).toBe('listening');
    expect(h.controller.snapshot().sessionId).toBe(first);
    expect(h.chat.createSession).toHaveBeenCalledTimes(1); // still exactly one conversation
  });

  it('CONTINUITY: multiple consecutive sends all land in one conversation', () => {
    const h = harness();
    const a = sendOnce(h, 'first message');
    const b = sendOnce(h, 'second message');
    const c = sendOnce(h, 'third message');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(h.chat.createSession).toHaveBeenCalledTimes(1); // one chat for all three
    expect(h.startTurn).toHaveBeenCalledTimes(3); // three turns in it
  });

  it('CONTINUITY: after Dismiss, the next press continues the same conversation', async () => {
    const h = harness();
    press(h.controller);
    press(h.controller);
    const first = h.controller.snapshot().sessionId!;
    h.turns.set(first, [{ id: 't0' }]); // it already holds a real turn
    h.controller.markReviewReady(first);
    await h.controller.discardTranscript(first);
    expect(h.controller.snapshot().phase).toBe('idle');

    press(h.controller);
    expect(h.controller.snapshot().sessionId).toBe(first); // continues, does NOT create sess-2
    expect(h.chat.createSession).toHaveBeenCalledTimes(1);
  });

  it('NEW CHAT: when the pointer moves to an explicitly-created chat, the next press uses it', () => {
    const h = harness();
    sendOnce(h); // conversation sess-1 exists and is active
    const fresh = h.chat.createSession(); // user clicks "+ New chat" in the main window …
    h.setPointer(fresh.id); // … which reports the new open chat to main

    press(h.controller);
    expect(h.controller.snapshot().sessionId).toBe(fresh.id); // launcher speaks into the New chat
  });

  it('COLD START: no pointer but chats exist → continues the most-recent chat, does not create', () => {
    const h = harness();
    const older = h.chat.createSession(); // sess-1
    const newer = h.chat.createSession(); // sess-2 (most recent)
    h.chat.createSession.mockClear();

    press(h.controller); // pointer is null → most-recent fallback
    expect(h.controller.snapshot().sessionId).toBe(newer.id);
    expect(h.controller.snapshot().sessionId).not.toBe(older.id);
    expect(h.chat.createSession).not.toHaveBeenCalled();
  });

  it('ignores key-repeat: a second press inside 400ms is a no-op', () => {
    const h = harness();
    press(h.controller);
    h.controller.toggleListening(); // immediate repeat, no clock advance → debounced
    expect(h.controller.snapshot().phase).toBe('listening');
    expect(h.chat.createSession).toHaveBeenCalledTimes(1);
  });

  it('ignores the shortcut during processing and sending', () => {
    const h = harness();
    press(h.controller);
    press(h.controller); // processing
    press(h.controller); // ignored
    expect(h.controller.snapshot().phase).toBe('processing');

    const sessionId = h.controller.snapshot().sessionId!;
    h.controller.markReviewReady(sessionId);
    h.controller.sendTranscript(sessionId, 'remind me to call mom');
    expect(h.controller.snapshot().phase).toBe('sending');
    press(h.controller);
    expect(h.controller.snapshot().phase).toBe('sending');
  });

  it('while TTS is speaking, a press stops TTS and starts a new recording (continuing the chat)', () => {
    const h = harness();
    press(h.controller);
    press(h.controller);
    const sessionId = h.controller.snapshot().sessionId!;
    h.controller.markReviewReady(sessionId);
    h.controller.sendTranscript(sessionId, 'what is the weather');
    h.controller.setSpeaking(true);
    expect(h.controller.snapshot().phase).toBe('speaking');

    h.stopSpeaking.mockClear();
    press(h.controller);
    expect(h.stopSpeaking).toHaveBeenCalled();
    expect(h.controller.snapshot().phase).toBe('listening');
    expect(h.controller.snapshot().sessionId).toBe(sessionId); // same conversation
  });
});

describe('DesktopVoiceController — Issue B (review actions: Send / Dismiss)', () => {
  it('Send: routes the transcript to the active conversation and keeps the launcher VISIBLE', () => {
    const h = harness();
    press(h.controller);
    press(h.controller);
    const sessionId = h.controller.snapshot().sessionId!;
    h.controller.markReviewReady(sessionId);

    const turnId = h.controller.sendTranscript(sessionId, 'add milk to my list');
    expect(turnId).toBe('turn-1');
    // Routes through the SHARED entry point (same pipeline as the main chat). No originId — the
    // launcher is a pure subscriber, so it receives its own turn's broadcasts too.
    expect(h.startTurn).toHaveBeenCalledWith('add milk to my list', sessionId);
    expect(h.controller.snapshot().phase).toBe('sending');
    expect(h.setActiveSessionId).toHaveBeenCalledWith(sessionId); // pointer stays on this chat
    // Regression guard: the launcher must NOT hide on send — it shows Searching/Thinking and the reply.
    expect(h.win.hide).not.toHaveBeenCalled();
    expect(h.chat.rename).toHaveBeenCalled(); // 'New chat' titled from the transcript
  });

  it('Send arc: searching → complete → speaking → idle, launcher hides only at the end', () => {
    const h = harness();
    press(h.controller);
    press(h.controller);
    const sessionId = h.controller.snapshot().sessionId!;
    h.controller.markReviewReady(sessionId);
    const turnId = h.controller.sendTranscript(sessionId, 'search the web for news');

    h.controller.markSearching(turnId);
    expect(h.controller.snapshot().searching).toBe(true);
    expect(h.win.hide).not.toHaveBeenCalled();

    h.controller.markTurnDone(turnId);
    expect(h.controller.snapshot().phase).toBe('complete');
    expect(h.win.hide).not.toHaveBeenCalled();

    h.controller.setSpeaking(true);
    expect(h.controller.snapshot().phase).toBe('speaking');
    expect(h.win.hide).not.toHaveBeenCalled();

    h.controller.setSpeaking(false); // TTS finished → Idle
    expect(h.controller.snapshot().phase).toBe('idle');
    expect(h.controller.snapshot().sessionId).toBeNull();
    expect(h.win.hide).toHaveBeenCalledTimes(1);
  });

  it('Dismiss: hides the launcher, sends nothing, and does NOT delete the conversation', async () => {
    const h = harness();
    press(h.controller);
    press(h.controller);
    const sessionId = h.controller.snapshot().sessionId!;
    h.controller.markReviewReady(sessionId);

    await h.controller.discardTranscript(sessionId);
    expect(h.win.hide).toHaveBeenCalled();
    expect(h.chat.deleteSession).not.toHaveBeenCalled(); // shared chat is never deleted on dismiss
    expect(h.startTurn).not.toHaveBeenCalled(); // nothing sent
    expect(h.controller.snapshot().phase).toBe('idle');
    expect(h.controller.snapshot().sessionId).toBeNull();
  });

  it('Dismiss while TTS is speaking silences Yogi and keeps the conversation', async () => {
    const h = harness();
    press(h.controller);
    press(h.controller);
    const sessionId = h.controller.snapshot().sessionId!;
    h.controller.markReviewReady(sessionId);
    h.controller.sendTranscript(sessionId, 'what time is it');
    h.controller.setSpeaking(true);
    h.stopSpeaking.mockClear();

    await h.controller.discardTranscript(sessionId);
    expect(h.stopSpeaking).toHaveBeenCalled(); // TTS stopped
    expect(h.chat.deleteSession).not.toHaveBeenCalled();
    expect(h.controller.snapshot().phase).toBe('idle');
  });
});

describe('DesktopVoiceController — most-relevant default chat (Issue 3)', () => {
  it('a freshly-delivered email chat becomes the default on the next manual open', () => {
    const h = harness();
    const chatA = h.chat.createSession().id; // a normal chat (older)
    h.setPointer(chatA);
    const email = h.addEmailChat(); // a new email arrives (newest updated_at)

    press(h.controller); // manual open
    expect(h.controller.snapshot().sessionId).toBe(email); // notification surfaces first
    expect(h.chat.createSession).toHaveBeenCalledTimes(1); // did not create a new chat
  });

  it('an actively-used conversation is NOT hijacked by an OLDER email', () => {
    const h = harness();
    const email = h.addEmailChat(); // old email
    const chatA = h.chat.createSession().id; // newer normal chat (the one being used)
    h.setPointer(chatA);
    h.touchSession(chatA); // active use bumps it to newest

    press(h.controller);
    expect(h.controller.snapshot().sessionId).toBe(chatA); // continues the active chat
    expect(h.controller.snapshot().sessionId).not.toBe(email);
  });
});

describe('DesktopVoiceController — open a specific conversation (Issues 2 & 4)', () => {
  it('openConversation shows the launcher in a typeable Review state on that session', () => {
    const h = harness();
    const email = h.addEmailChat();

    h.controller.openConversation(email);
    expect(h.windowApi.show).toHaveBeenCalled();
    expect(h.windowApi.setInteractive).toHaveBeenLastCalledWith(true); // typeable + clickable
    expect(h.controller.snapshot().phase).toBe('review');
    expect(h.controller.snapshot().sessionId).toBe(email);
    expect(h.setActiveSessionId).toHaveBeenCalledWith(email); // pointer moved to the opened chat
    expect(h.broadcasts.some((b) => b.ch === CH.LAUNCHER_SESSION_ACTIVATED)).toBe(true);
  });

  it('openConversation while listening tears the mic down before switching', () => {
    const h = harness();
    press(h.controller); // listening
    const email = h.addEmailChat();
    h.win.webContents.send.mockClear();

    h.controller.openConversation(email);
    expect(h.win.webContents.send).toHaveBeenCalledWith(CH.LAUNCHER_STOP_LISTENING); // mic stopped
    expect(h.controller.snapshot().phase).toBe('review');
    expect(h.controller.snapshot().sessionId).toBe(email);
  });

  it('listSessions returns safe DTOs with an email/chat kind, newest first', () => {
    const h = harness();
    const chatA = h.chat.createSession().id;
    const email = h.addEmailChat();
    const list = h.controller.listSessions();

    expect(list[0]!.id).toBe(email); // newest first
    expect(list.find((s) => s.id === email)!.kind).toBe('email');
    expect(list.find((s) => s.id === chatA)!.kind).toBe('chat');
    expect(list.every((s) => typeof s.title === 'string' && typeof s.updatedAt === 'number')).toBe(true);
  });
});

describe('DesktopVoiceController — sttAutoSubmit flag (provider-specific launcher flow)', () => {
  it('defaults to false when no provider getter is wired (offline / Review behaviour)', () => {
    const h = harness();
    expect(h.controller.snapshot().sttAutoSubmit).toBe(false);
  });

  it('is true when the effective STT provider is OpenAI', () => {
    const h = harness({ getSttAutoSubmit: () => true });
    expect(h.controller.snapshot().sttAutoSubmit).toBe(true);
  });

  it('is derived live on every snapshot (switching the provider needs no restart)', () => {
    let openai = false;
    const h = harness({ getSttAutoSubmit: () => openai });
    expect(h.controller.snapshot().sttAutoSubmit).toBe(false);
    openai = true; // user switches STT provider to OpenAI mid-session
    expect(h.controller.snapshot().sttAutoSubmit).toBe(true);
  });
});

describe('DesktopVoiceController — conversation interruption', () => {
  it('pauseForReminder while listening: stops TTS, hides the launcher, resets to idle', () => {
    const h = harness();
    press(h.controller); // → listening
    expect(h.controller.isConversationActive()).toBe(true);
    const sessionId = h.controller.snapshot().sessionId!;
    h.stopSpeaking.mockClear();
    h.win.hide.mockClear();

    h.controller.pauseForReminder();
    expect(h.stopSpeaking).toHaveBeenCalled(); // conversation TTS stopped (no overlap)
    expect(h.win.hide).toHaveBeenCalled(); // launcher hidden → renderer unmounts → mic stops
    expect(h.controller.snapshot().phase).toBe('idle');

    // Resume re-opens listening on the SAME session (continue the conversation).
    h.controller.resumeAfterReminder();
    expect(h.controller.snapshot().phase).toBe('listening');
    expect(h.controller.snapshot().sessionId).toBe(sessionId);
    expect(h.setActiveSessionId).toHaveBeenCalledWith(sessionId);
  });

  it('a reminder finishing (setSpeaking false) must NOT collapse the paused launcher', () => {
    const h = harness();
    press(h.controller); // listening
    h.controller.pauseForReminder(); // interrupted
    h.win.hide.mockClear();

    // The reminder's own audio reports playing=false through the shared channel.
    h.controller.setSpeaking(false);
    // While interrupted this is ignored — the launcher stays paused, not re-hidden/reset by the bug.
    expect(h.controller.snapshot().phase).toBe('idle'); // unchanged (still paused)

    // Resume still works afterward.
    h.controller.resumeAfterReminder();
    expect(h.controller.snapshot().phase).toBe('listening');
  });

  it('pauseForReminder is a no-op when no conversation is active (idle launcher)', () => {
    const h = harness();
    expect(h.controller.isConversationActive()).toBe(false);
    h.controller.pauseForReminder();
    expect(h.stopSpeaking).not.toHaveBeenCalled();
    // resume is a no-op too (nothing was paused) → does not auto-open the mic.
    h.controller.resumeAfterReminder();
    expect(h.controller.snapshot().phase).toBe('idle');
    expect(h.windowApi.show).not.toHaveBeenCalled();
  });

  it('pauses mid-reply → resume RE-READS the interrupted reply, then sequences into listening', () => {
    const h = harness();
    press(h.controller); // listening
    press(h.controller);
    const sessionId = h.controller.snapshot().sessionId!;
    h.controller.markReviewReady(sessionId);
    h.controller.sendTranscript(sessionId, 'tell me a joke');
    // Persist the assistant reply so resume can re-read it.
    h.turns.get(sessionId)!.push({ kind: 'chat', assistantText: 'Why did the chicken cross the road? To get to the other side.' } as never);
    h.controller.setSpeaking(true); // Yogi is speaking the reply
    expect(h.controller.snapshot().phase).toBe('speaking');

    h.controller.pauseForReminder();
    expect(h.controller.snapshot().phase).toBe('idle');

    h.controller.resumeAfterReminder();
    // Re-read: back in 'speaking' and the reply is spoken again (recovering the lost context).
    expect(h.controller.snapshot().phase).toBe('speaking');
    expect(h.speak).toHaveBeenCalledWith(expect.stringContaining('chicken cross the road'));
    expect(h.controller.snapshot().sessionId).toBe(sessionId);

    // When the re-read finishes, it sequences into listening so the user can continue.
    h.controller.setSpeaking(false);
    expect(h.controller.snapshot().phase).toBe('listening');
  });

  it('auto-resume OFF → resume re-opens the launcher without re-reading', () => {
    const h = harness();
    h.settings.get.mockImplementation(((k: string) =>
      k === 'desktop_voice_shortcut_enabled' ? 'true' : k === 'conversation_auto_resume' ? 'false' : '') as never);
    press(h.controller);
    press(h.controller);
    const sessionId = h.controller.snapshot().sessionId!;
    h.controller.markReviewReady(sessionId);
    h.controller.sendTranscript(sessionId, 'tell me a joke');
    h.turns.get(sessionId)!.push({ kind: 'chat', assistantText: 'A joke reply.' } as never);
    h.controller.setSpeaking(true);
    h.speak.mockClear();

    h.controller.pauseForReminder();
    h.controller.resumeAfterReminder();
    expect(h.speak).not.toHaveBeenCalled(); // no auto re-read
    expect(h.controller.snapshot().phase).toBe('listening'); // re-opens ready
  });
});
