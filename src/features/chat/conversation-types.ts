import type { ParseResult } from '../../../core/parsing/types';

/**
 * The renderer's conversation model (31 §4.1) — the message list that replaces `ChatScreen`'s
 * single `ParseResult` slot (30 §3.1). EP-2 carries the local parser's `ParseResult` inside a
 * proposal so the confirmation card can render as a message-bubble variant; EP-5 will add
 * streaming assistant text and richer proposal types without changing this shape.
 */
export type ProposalStatus = 'pending' | 'executed' | 'cancelled' | 'failed';

export interface MessageProposal {
  /** ok → confirmation card; clarification → question + chips (no Confirm). */
  parse: ParseResult;
  status: ProposalStatus;
  /** The original user text for this turn, so a clarification chip can refine and re-send. */
  sourceText: string;
  /** e.g. "✓ Saved — Call the dentist" once confirmed/executed. */
  resolvedSummary?: string;
  /** An inline error if Confirm failed (the proposal stays pending, Confirm re-enabled). */
  error?: string;
}

/**
 * EP-6 dispatcher proposal — a confirmable card whose action is stored in MAIN (keyed by turnId).
 * Confirm relays only the turnId; the renderer never holds the reminder fields (36 §4.3). Distinct
 * from the EP-2 `MessageProposal`, which carries the local `ParseResult` in the renderer.
 */
export interface DispatchProposal {
  turnId: string;
  /** The resolved one-line summary the user confirms ("Call Rahul · Mon, Jul 13, 9:00 AM · one-time"). */
  summary: string;
  status: ProposalStatus;
  resolvedSummary?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  /** 'reminder' = a fired reminder delivered into the chat; 'email' = a new email delivered into
   *  its own chat (Phase 3). Both are assistant-only and styled distinctly; undefined = normal. */
  kind?: 'reminder' | 'email';
  /** An in-flight turn started in ANOTHER window (the launcher) — shows a live thinking/searching
   *  placeholder until its reply arrives (real-time sync). undefined = a settled message. */
  pending?: 'thinking' | 'searching';
  /** EP-2 local-parse proposal (renderer holds the ParseResult). */
  proposal?: MessageProposal;
  /** EP-6 dispatcher proposal (action stored in main; Confirm relays the turnId). */
  dispatchProposal?: DispatchProposal;
}
