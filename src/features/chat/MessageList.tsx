import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from './conversation-types';
import type { ParsedReminder } from '../../../core/parsing/types';

/**
 * The scrolling conversation transcript (43). Auto-scrolls to the newest message; `aria-live`
 * so a screen reader announces Yogi's replies. An empty state invites the first message.
 */
export function MessageList({
  messages,
  busy,
  searching,
  onConfirm,
  onCancel,
  onRefine,
  onConfirmDispatch,
  onCancelDispatch,
}: {
  messages: ChatMessage[];
  busy: boolean;
  searching: boolean;
  onConfirm: (messageId: string, r: ParsedReminder) => void;
  onCancel: (messageId: string) => void;
  onRefine: (text: string) => void;
  onConfirmDispatch: (messageId: string, turnId: string) => void;
  onCancelDispatch: (messageId: string, turnId: string) => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, busy, searching]);

  return (
    <div className="message-list" aria-live="polite">
      {messages.length === 0 && (
        <p className="dim empty-conversation">
          Ask Yogi to set a reminder — e.g. &ldquo;remind me in 10 minutes to drink water.&rdquo;
        </p>
      )}
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          busy={busy}
          onConfirm={onConfirm}
          onCancel={onCancel}
          onRefine={onRefine}
          onConfirmDispatch={onConfirmDispatch}
          onCancelDispatch={onCancelDispatch}
        />
      ))}
      {busy && (
        <div className="msg msg-assistant">
          <div className="bubble">
            {searching ? (
              <p className="bubble-text dim">🔎 Searching the web…</p>
            ) : (
              <p className="bubble-text dim" aria-label="Yogi is thinking">
                <span className="typing" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </p>
            )}
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
