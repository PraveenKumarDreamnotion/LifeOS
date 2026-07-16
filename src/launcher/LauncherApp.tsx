import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Markdown } from '../components/Markdown';
import { decideTranscriptAction } from './stt-flow';
import { useSpeech } from '../hooks/useSpeech';
import { DESKTOP_VOICE_IDLE_STATE, type DesktopVoiceState } from '../../core/types/desktop-voice';
import { useLauncherMessages } from './useLauncherMessages';
import type { LauncherSession } from '../types/window';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function statusLabel(state: DesktopVoiceState, listening: boolean, processing: boolean): string {
  if (listening) return 'Listening';
  if (processing || state.phase === 'processing') return 'Transcribing';
  if (state.searching) return 'Searching';
  if (state.phase === 'sending') return 'Thinking';
  if (state.phase === 'speaking') return 'Speaking';
  if (state.phase === 'review') return 'Review';
  if (state.phase === 'complete') return 'Done';
  if (state.phase === 'error') return 'Error';
  return 'Ready';
}

/**
 * Live voice bars — each bar's height is driven by the REAL microphone RMS (speech.volume), not a
 * fixed loop. Rendered only while listening, so the bars stop the instant recording ends (§voice viz).
 */
function Waveform({ volume }: { volume: number }) {
  return (
    <div className="launcher-wave active" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => {
        const factor = 0.3 + volume * 5.0;
        const barScale = Math.max(0.2, Math.min(3.5, factor * (1.0 + Math.sin(i * 1.5) * 0.3)));
        return <span key={i} style={{ transform: `scaleY(${barScale})`, transition: 'transform 80ms ease-out' }} />;
      })}
    </div>
  );
}

export function LauncherApp() {
  const [voiceState, setVoiceState] = useState<DesktopVoiceState>(DESKTOP_VOICE_IDLE_STATE);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [recordedDuration, setRecordedDuration] = useState<number | null>(null);
  // Chat switcher (Issue 4): the list of conversations + whether the dropdown is open.
  const [sessions, setSessions] = useState<LauncherSession[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  // The launcher's compact conversation — the SAME turn stream the main chat renders (real-time sync).
  const messages = useLauncherMessages(sessionId);

  const refreshSessions = useCallback(async () => {
    const r = await window.lifeosLauncher.listSessions();
    if (r.ok) setSessions(r.data);
  }, []);

  // Keep the header title / switcher list current whenever the active conversation changes.
  useEffect(() => {
    if (!sessionId) return;
    void refreshSessions();
  }, [sessionId, refreshSessions]);

  // Reset the dropdown when the launcher goes back to its hidden resting state.
  useEffect(() => {
    if (voiceState.phase === 'idle' || voiceState.phase === 'hover') setSwitcherOpen(false);
  }, [voiceState.phase]);

  const toggleSwitcher = useCallback(() => {
    setSwitcherOpen((open) => {
      if (!open) void refreshSessions();
      return !open;
    });
  }, [refreshSessions]);

  const selectSession = useCallback(
    async (id: string) => {
      setSwitcherOpen(false);
      if (id === sessionId) return;
      await window.lifeosLauncher.openConversation(id);
    },
    [sessionId],
  );

  const activeTitle = sessions.find((s) => s.id === sessionId)?.title ?? 'Yogi';

  // Provider-specific STT flow. OpenAI STT is a hands-free batch provider: the recognized text is
  // submitted straight to the chat (no editable draft, no Send button). Offline STT keeps the review
  // step so the user can edit before sending. `autoSubmitRef` mirrors the flag main computes from the
  // effective provider (openai + key + consent) so the latest value is read without re-subscribing
  // useSpeech to a changing callback.
  const autoSubmitRef = useRef(false);
  useEffect(() => {
    autoSubmitRef.current = voiceState.sttAutoSubmit ?? false;
  }, [voiceState.sttAutoSubmit]);
  // True from the moment an OpenAI transcript is auto-submitted until the next turn begins — it
  // suppresses the empty-transcript recovery so it can't race a reviewReady against the send.
  const justAutoSubmittedRef = useRef(false);

  const onTranscript = useCallback(
    (transcript: string) => {
      const action = decideTranscriptAction({ autoSubmit: autoSubmitRef.current, sessionId, transcript });
      if (action.type === 'submit') {
        // OpenAI STT — submit immediately and skip Review entirely. The launcher moves to the normal
        // response arc (sending → searching → speaking), showing the user's message and the loading
        // indicators, with no extra click. The guard ref blocks the empty-transcript recovery from
        // racing a stray reviewReady against this send.
        justAutoSubmittedRef.current = true;
        setText('');
        void window.lifeosLauncher.sendTranscript({ sessionId: sessionId!, text: action.text });
        return;
      }
      if (action.type === 'review') {
        // Offline STT — show the editable transcript and the Send button (unchanged behaviour).
        setText(action.text);
        if (sessionId) void window.lifeosLauncher.reviewReady({ sessionId });
      }
    },
    [sessionId],
  );

  const beforeStart = useCallback(() => {
    void window.lifeosLauncher.tts.stop();
  }, []);

  const speech = useSpeech(onTranscript, window.lifeosLauncher.speech, beforeStart);

  const listening = speech.state === 'listening' || speech.state === 'initializing';
  const processing = speech.state === 'processing';

  useEffect(() => {
    if (speech.state === 'error' && speech.errorMsg) {
      void window.lifeosLauncher.setError(speech.errorMsg);
    }
  }, [speech.state, speech.errorMsg]);

  useEffect(() => {
    let cancelled = false;
    void window.lifeosLauncher.getState().then((r) => {
      if (!cancelled && r.ok) {
        setVoiceState(r.data);
        setSessionId(r.data.sessionId);
      }
    });
    const off = window.lifeosLauncher.onStateChanged((state) => {
      setVoiceState(state);
      if (state.sessionId) setSessionId(state.sessionId);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    if (!listening) {
      if (voiceState.startedAt && recordedDuration === null) {
        setRecordedDuration(Date.now() - voiceState.startedAt);
      }
      return;
    }
    setRecordedDuration(null);
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [listening, voiceState.startedAt]);

  useEffect(() => {
    return window.lifeosLauncher.onBeginListening(({ sessionId: nextSessionId }) => {
      setSessionId(nextSessionId);
      setText('');
      justAutoSubmittedRef.current = false; // a fresh turn clears any prior auto-submit guard
      if (speech.state !== 'listening' && speech.state !== 'initializing') speech.toggle();
    });
  }, [speech.state, speech.toggle]);

  useEffect(() => {
    return window.lifeosLauncher.onStopListening(() => {
      if (speech.state === 'listening' || speech.state === 'initializing') speech.toggle();
    });
  }, [speech.state, speech.toggle]);

  // Recovery: an empty final transcript never calls onTranscript, so the controller would stay
  // stuck in 'processing'. When STT has finished (speech idle) but we're still processing with no
  // text, enter Review anyway so the user can dismiss or type. `justAutoSubmittedRef` suppresses this
  // in the OpenAI auto-submit path: there, onTranscript clears `text` and fires sendTranscript, so
  // without the guard this effect would race a stray reviewReady against the response arc.
  useEffect(() => {
    if (
      voiceState.phase === 'processing' &&
      speech.state === 'idle' &&
      !text.trim() &&
      sessionId &&
      !justAutoSubmittedRef.current
    ) {
      void window.lifeosLauncher.reviewReady({ sessionId });
    }
  }, [voiceState.phase, speech.state, text, sessionId]);

  useEffect(() => window.lifeosLauncher.tts.onSpeaking(({ active }) => setSpeaking(active)), []);

  // Keep the newest message in view (auto-scroll), like the reminder popup and main chat.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, voiceState.phase]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || !sessionId || voiceState.phase === 'sending') return;
    setText('');
    // Fire-and-forget: the sent turn appears in the list via the shared turn broadcasts (started →
    // searching → appended), exactly as it does in the main chat.
    await window.lifeosLauncher.sendTranscript({ sessionId, text: trimmed });
  };

  const discard = async () => {
    const currentSession = sessionId;
    setText('');
    await window.lifeosLauncher.discardTranscript({ sessionId: currentSession || '' });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (switcherOpen) {
        setSwitcherOpen(false); // first Escape closes the chat switcher, not the launcher
        return;
      }
      void discard();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionId, switcherOpen]);

  const elapsed = voiceState.startedAt
    ? formatElapsed(recordedDuration !== null ? recordedDuration : now - voiceState.startedAt)
    : '0:00';

  const canEdit = voiceState.phase === 'review' || voiceState.phase === 'error';

  // Render nothing at rest so the window is truly empty when hidden AND the slide-in animation
  // replays on every show (the card remounts) — mirrors the reminder popup's `if (!data) return null`.
  if (voiceState.phase === 'idle' || voiceState.phase === 'hover') return null;

  return (
    <section
      className={`launcher launcher-${voiceState.phase}`}
      aria-label="Yogi voice launcher"
      onPointerEnter={() => void window.lifeosLauncher.hoverChanged(true)}
      onPointerLeave={() => void window.lifeosLauncher.hoverChanged(false)}
    >
      <header className="launcher-head">
        <span className="launcher-avatar" aria-hidden>
          ●
        </span>
        {/* Chat switcher (Issue 4): the active conversation's title doubles as the dropdown trigger,
            so the user always knows which chat they're in and can jump to another in one click. */}
        <button
          type="button"
          className="launcher-switcher-btn"
          onClick={toggleSwitcher}
          aria-haspopup="listbox"
          aria-expanded={switcherOpen}
          title="Switch conversation"
        >
          <span className="launcher-switcher-title">{activeTitle}</span>
          <span className="launcher-switcher-caret" aria-hidden>
            ▾
          </span>
        </button>
        <span className="launcher-timer">{elapsed}</span>
        <span className="launcher-status">{statusLabel(voiceState, listening, processing)}</span>
        <button
          type="button"
          className="launcher-close-btn"
          onClick={() => void discard()}
          title="Close launcher"
          aria-label="Close launcher"
        >
          ✕
        </button>
      </header>

      {switcherOpen && (
        <div className="launcher-switcher-menu" role="listbox" aria-label="Conversations">
          {sessions.length === 0 && <div className="launcher-switcher-empty">No conversations yet</div>}
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={s.id === sessionId}
              className={s.id === sessionId ? 'launcher-switcher-item active' : 'launcher-switcher-item'}
              onClick={() => void selectSession(s.id)}
            >
              <span className="launcher-switcher-item-icon" aria-hidden>
                {s.kind === 'email' ? '📧' : '💬'}
              </span>
              <span className="launcher-switcher-item-title">{s.title}</span>
              {s.id === sessionId && (
                <span className="launcher-switcher-check" aria-hidden>
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* The active conversation — same messages as the main chat, kept in sync in real time. */}
      <div className="launcher-scroll">
        {messages.length === 0 && !listening && <p className="launcher-empty">Speak to start a conversation.</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'launcher-msg user' : 'launcher-msg assistant'}>
            {m.pending === 'searching' ? (
              <span className="launcher-msg-status">🔎 Searching the web…</span>
            ) : m.pending === 'thinking' ? (
              <span className="typing" aria-label="Yogi is thinking">
                <span />
                <span />
                <span />
              </span>
            ) : m.role === 'assistant' ? (
              // Assistant replies render as Markdown so headings/lists/bold match the main chat
              // (no literal `**`). The user's own transcript stays plain text.
              <Markdown text={m.text} className="launcher-md" />
            ) : (
              m.text
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* The voice composer — record / review / speak controls sit below the conversation. */}
      <div className="launcher-composer">
        {listening ? (
          <>
            <Waveform volume={speech.volume} />
            <p className="launcher-note">{speech.partial || 'Listening…'}</p>
          </>
        ) : canEdit ? (
          <form
            className="launcher-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void submit();
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              readOnly={listening || processing}
              aria-label="Launcher transcript"
              rows={2}
              placeholder="Ask Yogi"
            />
            <div className="launcher-actions">
              <button type="button" className="launcher-ghost" onClick={() => void discard()}>
                Dismiss
              </button>
              <button type="submit" className="launcher-send" disabled={!text.trim() || listening || processing}>
                Send
              </button>
            </div>
          </form>
        ) : null}
        {(voiceState.error || speech.errorMsg) && <p className="launcher-error">{voiceState.error || speech.errorMsg}</p>}
        {speaking && (
          <button className="launcher-stop" onClick={() => void window.lifeosLauncher.tts.stop()}>
            ■ Stop speaking
          </button>
        )}
      </div>
    </section>
  );
}
