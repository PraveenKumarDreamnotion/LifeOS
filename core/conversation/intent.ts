/**
 * The canonical conversation intent taxonomy (31 §2). Closed union — the LLM classifies each
 * turn as exactly one of these. EP-5 acts on the REPLY-ONLY intents (chat, question); ACTION
 * intents are carried but not executed until the Action Dispatcher (EP-6). Pure/DOM-free.
 */
export type ConversationIntent =
  | 'chat'
  | 'question'
  | 'research'
  | 'reminder_create'
  | 'reminder_update'
  | 'reminder_delete'
  | 'memory_save'
  | 'memory_query'
  | 'settings'
  | 'unknown';

export const CONVERSATION_INTENTS: ConversationIntent[] = [
  'chat',
  'question',
  'research',
  'reminder_create',
  'reminder_update',
  'reminder_delete',
  'memory_save',
  'memory_query',
  'settings',
  'unknown',
];

/** Reply-only: the model answers, no action. EP-5 handles these directly. */
export const REPLY_ONLY_INTENTS: ConversationIntent[] = ['chat', 'question', 'unknown'];

/** Action intents: routed to the dispatcher (EP-6). In EP-5 they fall to the local reminder path. */
export const ACTION_INTENTS: ConversationIntent[] = [
  'reminder_create',
  'reminder_update',
  'reminder_delete',
  'memory_save',
  'memory_query',
  'settings',
  'research',
];

export function isReplyOnly(intent: ConversationIntent): boolean {
  return REPLY_ONLY_INTENTS.includes(intent);
}
