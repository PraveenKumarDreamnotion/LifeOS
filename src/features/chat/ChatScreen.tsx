import { useEffect, useState } from 'react';
import { ipc } from '../../lib/ipc';
import { MessageList } from './MessageList';
import { useConversation } from './useConversation';
import { useSessions } from './useSessions';

/**
 * The conversation Chat screen. A sessions sidebar (persistent, resumable chats — CONV) beside a
 * scrolling transcript. Opening a past chat hydrates its messages from the DB (settled proposal cards
 * included); the first message auto-titles the chat.
 * Reminders are created through the Action Dispatcher and linked to the chat that made them.
 */
export function ChatScreen({
  offline = false,
  openSessionId = null,
  onOpened,
}: {
  offline?: boolean;
  openSessionId?: string | null;
  onOpened?: () => void;
}) {
  const { sessions, currentId, newChat, select, remove, refresh } = useSessions();
  const [speaking, setSpeaking] = useState(false);
  const convo = useConversation(currentId);

  useEffect(() => ipc.onSpeaking(({ active }) => setSpeaking(active)), []);
  useEffect(
    () =>
      ipc.onLauncherSessionActivated(({ sessionId }) => {
        void refresh().then(() => select(sessionId));
      }),
    [refresh, select],
  );

  // Notification-click → open a specific email's chat. App owns the value (race-free: it's a prop,
  // set before/at mount). ONE-SHOT: consume it via onOpened after selecting, so a later remount
  // (e.g. navigating Settings→Chat) does NOT re-snap the user back into the email chat — that would
  // re-create the very view-hijack the quiet-create design prevents for the launcher.
  useEffect(() => {
    if (!openSessionId) return;
    void refresh().then(() => select(openSessionId));
    onOpened?.();
  }, [openSessionId, refresh, select, onOpened]);

  return (
    <div className="screen chat-screen chat-with-sessions">
      <aside className="chat-sidebar" aria-label="Chat history">
        <button className="new-chat-btn" onClick={() => void newChat()}>
          + New chat
        </button>
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id} className="session-row">
              <button
                className={s.id === currentId ? 'session-item active' : 'session-item'}
                onClick={() => select(s.id)}
                title={s.title}
              >
                {s.title}
              </button>
              <button
                className="session-del"
                title="Delete this chat"
                aria-label={`Delete chat: ${s.title}`}
                onClick={() => {
                  if (window.confirm(`Delete "${s.title}"? This can't be undone. (Your reminders are kept.)`)) void remove(s.id);
                }}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="chat-main">
        <h1 className="screen-title">Ask Yogi</h1>

        {offline && (
          <div className="offline-note" role="status">
            🔒 <strong>Working offline.</strong> Reminders, the time, and your schedule all work with no
            internet. Add your OpenAI key in Settings to also chat and get answers from the web.
          </div>
        )}

        <MessageList
          messages={convo.messages}
          busy={convo.busy}
          searching={convo.searching}
          onConfirm={convo.confirm}
          onCancel={convo.cancel}
          onRefine={(refined) => void convo.send(refined)}
          onConfirmDispatch={convo.confirmDispatch}
          onCancelDispatch={convo.cancelDispatch}
        />

        {convo.messages.length === 0 && (
          <div className="launcher-first launcher-empty-state">
            <div className="launcher-mark-big" aria-hidden>
              ●
            </div>
            <h2>Start a voice conversation</h2>
            <p className="launcher-empty-shortcut">
              Press <kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>Space</kbd> anywhere
            </p>
            <p>
              Yogi opens and starts listening right away — just speak, review, and send. Your
              conversation shows up here.
            </p>
          </div>
        )}

        {speaking && (
          <button className="stop-speaking" onClick={() => void ipc.stopSpeaking()}>
            ■ Stop speaking
          </button>
        )}

        {/* A subtle, always-present hint so the global voice shortcut is discoverable in every chat.
            Non-interactive, doesn't scroll with the transcript, and reads in both themes. */}
        <p className="chat-hint" aria-hidden="true">
          Press <kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>Space</kbd> anywhere to talk to Yogi
        </p>
      </div>
    </div>
  );
}
