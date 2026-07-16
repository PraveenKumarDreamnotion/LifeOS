import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Markdown } from '../components/Markdown';
import { useSpeech } from '../hooks/useSpeech';
import type { ReminderPopupData, ReminderPopupAction } from '../../core/types/popup';
import type { ChatDonePayload } from '../../core/types/chat';

/**
 * The reminder popup UI (55 §4/§5, P2-A) — a lightweight always-on-top toast that is ALSO a chat
 * client. It renders the current reminder + a "+N more" chip, offers Complete / Snooze / Dismiss,
 * and lets the user chat back — by text OR voice — in the reminder's session (Yogi answers with full
 * context). Main speaks the reminder on show. The mic is live: a spoken reply runs the same submit
 * path as typing, so speech drives both chat and natural-language lifecycle (snooze/complete/cancel).
 */

const SNOOZE_OPTIONS: { label: string; minutes: number }[] = [
  { label: '10 min', minutes: 10 },
  { label: '1 hour', minutes: 60 },
  { label: '3 hours', minutes: 180 },
];

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

/** Popup-side chat adapter: send in a session, resolve Yogi's reply (matched by turnId; fan-out safe).
 *  A client timeout guarantees the popup never hangs forever if main goes silent. */
function popupChatSend(text: string, sessionId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const buffered: ChatDonePayload[] = [];
    let targetId: string | null = null;
    let settled = false;
    const finish = () => {
      settled = true;
      clearTimeout(timeout);
      unsub();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      finish();
      reject(new Error('timeout'));
    }, 50_000);
    const settle = (p: ChatDonePayload) => {
      finish();
      resolve(p.reply);
    };
    const unsub = window.lifeosPopup.chat.onDone((p: ChatDonePayload) => {
      if (settled) return;
      if (targetId !== null && p.turnId === targetId) settle(p);
      else buffered.push(p);
    });
    window.lifeosPopup.chat
      .send(text, sessionId)
      .then((r) => {
        if (!r.ok) {
          finish();
          reject(new Error(r.error.message));
          return;
        }
        targetId = r.data.turnId;
        const already = buffered.find((p) => p.turnId === targetId);
        if (already && !settled) settle(already);
      })
      .catch((e) => {
        finish();
        reject(e as Error);
      });
  });
}

let msgCounter = 0;

export function PopupApp() {
  const [data, setData] = useState<ReminderPopupData | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const sessionRef = useRef<string | null>(null); // resolved/lazily-minted session for this reminder
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true); // stay pinned to the bottom UNLESS the user scrolled up to read
  const submitRef = useRef<(t: string) => void>(() => {});

  useEffect(() => {
    return window.lifeosPopup.onShow((d) => {
      setData(d);
      setSnoozeOpen(false);
      setMessages([]); // a new reminder starts a fresh popup exchange (it continues d.sessionId)
      setText('');
      setSearching(false);
      stickRef.current = true;
      sessionRef.current = d.sessionId;
    });
  }, []);

  // Auto-scroll only when the user is already at the bottom — never yank them away from older messages.
  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // Voice: the popup owns the mic while open; a final transcript runs through the SAME submit path
  // as typing (lifecycle-or-chat), so speaking continues the reminder's conversation just like text.
  // Pressing the mic interrupts Yogi mid-sentence (stop speech, then listen).
  const onTranscript = useCallback((t: string) => submitRef.current(t), []);
  const speech = useSpeech(onTranscript, window.lifeosPopup.speech, () => void window.lifeosPopup.tts.stop());

  useEffect(() => window.lifeosPopup.tts.onSpeaking(({ active }) => setSpeaking(active)), []);
  useEffect(() => window.lifeosPopup.onSearching(() => setSearching(true)), []);

  if (!data) return null;

  const act = (a: ReminderPopupAction) => void window.lifeosPopup.action(a);

  async function submit(input: string) {
    const t = input.trim();
    if (!t || !data || busy) return;
    setText('');
    setMessages((m) => [...m, { id: ++msgCounter, role: 'user', text: t }]);
    setBusy(true);
    setSearching(false);
    const reminderId = data.reminderId;
    try {
      // First: is it a lifecycle command (complete/snooze/cancel/…)? Main classifies deterministically.
      const res = await window.lifeosPopup.message({ reminderId, text: t });
      if (res.ok && !res.data.chat) {
        if (res.data.reply) setMessages((m) => [...m, { id: ++msgCounter, role: 'assistant', text: res.data.reply! }]);
        // On a lifecycle action the popup auto-advances shortly (main drives it) — nothing else to do.
        return;
      }
      // Otherwise it's a normal chat turn — answer with the reminder's conversation context.
      if (!sessionRef.current) {
        const s = await window.lifeosPopup.chat.createSession();
        if (s.ok) sessionRef.current = s.data.id;
      }
      const sid = sessionRef.current;
      const reply = sid ? await popupChatSend(t, sid) : "I couldn't start a conversation just now.";
      setMessages((m) => [...m, { id: ++msgCounter, role: 'assistant', text: reply }]);
    } catch {
      setMessages((m) => [...m, { id: ++msgCounter, role: 'assistant', text: "I couldn't reach the assistant just now." }]);
    } finally {
      setBusy(false);
      setSearching(false);
    }
  }
  submitRef.current = (t: string) => void submit(t); // keep the mic wired to the latest submit

  const listening = speech.state === 'listening' || speech.state === 'initializing';

  return (
    <div className="popup" role="alertdialog" aria-label="Reminder from Yogi">
      <header className="popup-head">
        <span className="popup-avatar" aria-hidden>
          ●
        </span>
        <span className="popup-brand">Yogi</span>
        <span className="popup-time">Reminder · {data.timeLabel}</span>
        <button className="popup-x" aria-label="Close" onClick={() => act({ reminderId: data.reminderId, action: 'hide' })}>
          ✕
        </button>
      </header>

      <div className="popup-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="popup-body-content" aria-live="assertive">
          <h1 className="popup-title">{data.title}</h1>
          {data.description && <p className="popup-desc">{data.description}</p>}
          <p className="popup-spoken">“{data.spokenLine}”</p>
        </div>

        {messages.length > 0 && (
          <div className="popup-messages">
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'popup-msg user' : 'popup-msg assistant'}>
                {m.role === 'assistant' ? <Markdown text={m.text} className="popup-md" /> : m.text}
              </div>
            ))}
            {busy && (
              <div className="popup-msg assistant dim">
                {searching ? (
                  '🔎 Searching the web…'
                ) : (
                  <span className="typing" aria-label="Yogi is thinking">
                    <span />
                    <span />
                    <span />
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {speaking && (
        <button className="popup-stop-speaking" onClick={() => void window.lifeosPopup.tts.stop()}>
          ■ Stop speaking
        </button>
      )}

      <form className="popup-composer" onSubmit={(e: FormEvent) => { e.preventDefault(); void submit(text); }}>
        <button
          type="button"
          className={listening ? 'popup-mic listening' : 'popup-mic'}
          onClick={speech.toggle}
          disabled={busy}
          aria-label={listening ? 'Stop listening' : 'Speak to Yogi'}
          title={listening ? 'Listening — click to stop' : 'Speak to Yogi'}
        >
          {speech.state === 'processing' ? '…' : '🎤'}
        </button>
        <input
          className="popup-input"
          value={listening ? speech.partial || 'Listening…' : text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Reply to Yogi — or press the mic"
          maxLength={2000}
          readOnly={listening}
        />
        <button type="submit" className="popup-send" disabled={busy || listening || !text.trim()}>
          ➤
        </button>
      </form>
      {speech.errorMsg && <p className="popup-mic-err">{speech.errorMsg}</p>}

      <footer className="popup-actions">
        <button className="popup-btn primary" onClick={() => act({ reminderId: data.reminderId, action: 'complete' })}>
          Complete
        </button>
        {data.canSnooze && (
          <div className="popup-snooze">
            <button className="popup-btn" onClick={() => setSnoozeOpen((v) => !v)} aria-expanded={snoozeOpen}>
              Snooze ▾
            </button>
            {snoozeOpen && (
              <div className="popup-snooze-menu" role="menu">
                {SNOOZE_OPTIONS.map((o) => (
                  <button key={o.minutes} role="menuitem" onClick={() => act({ reminderId: data.reminderId, action: 'snooze', minutes: o.minutes })}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button className="popup-btn ghost" onClick={() => act({ reminderId: data.reminderId, action: 'dismiss' })}>
          Dismiss
        </button>
        {data.queued > 0 && <span className="popup-queue">+{data.queued} more</span>}
      </footer>
    </div>
  );
}
