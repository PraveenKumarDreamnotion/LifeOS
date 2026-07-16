import type { ParseResult } from '../parsing/types';
import type { Proposal } from '../actions/action';

/**
 * The EP-2 conversation "turn" (43). A SYNCHRONOUS shell turn produced by the local parser —
 * no LLM, no streaming. EP-5 replaces the producer with the real ConversationEngine +
 * AssistantTurn (31 §3/§5), but the renderer contract (a reply string + an optional reminder
 * proposal) stays stable so the message-list UI does not change when the brain arrives.
 */
export interface ShellTurn {
  /** Yogi's assistant text for this turn. */
  reply: string;
  /** The reminder parse for a proposal/clarification bubble; null for the placeholder/refusal. */
  parse: ParseResult | null;
}

/**
 * The chat:done broadcast payload (EP-5). A completed turn's ShellTurn tagged with the turnId
 * from chat:send, so the renderer can match the async result to the request it sent. The renderer
 * NEVER receives raw model JSON — only the validated reply text and (from EP-6) a proposal.
 */
export interface ChatDonePayload extends ShellTurn {
  turnId: string;
  /** EP-6: a dispatcher proposal (confirmable via action:confirm(turnId)). Present instead of a
   *  local `parse` proposal when dispatcher_enabled and the turn produced a reminder. */
  proposal?: Proposal;
}

/**
 * Persistent chat types (CONV) — shared so the renderer can type sessions/turns without importing
 * main-process code. `ChatTurn` is the FAITHFUL render source: `assistantText` is what was shown.
 */
export type PersistedProposalStatus = 'pending' | 'executed' | 'cancelled';

/** 'chat' = a normal user/assistant exchange; 'reminder' = a fired reminder delivered into the chat;
 *  'email' = a new email delivered into its own chat (Phase 3). Delivery kinds (reminder/email) are
 *  assistant-only (no user text). */
export type ChatTurnKind = 'chat' | 'reminder' | 'email';

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Set when this chat was auto-created for a delivered email (Phase 3); links to the Gmail
   *  message id. Marks an "email chat" so it can be excluded from voice-continuity fallbacks. */
  emailMessageId?: string | null;
}

export interface ChatTurn {
  id: string; // == the engine turnId
  sessionId: string;
  kind: ChatTurnKind;
  userText: string;
  assistantText: string; // what was SHOWN
  intent: string | null;
  proposalSummary: string | null;
  proposalStatus: PersistedProposalStatus | null;
  reminderId: string | null;
  createdAt: number;
}
