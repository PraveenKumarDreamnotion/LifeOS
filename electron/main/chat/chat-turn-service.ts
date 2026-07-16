import { parseReminder } from '../../../core/parsing/parse-reminder';
import type { ShellTurn } from '../../../core/types/chat';

/**
 * The honest message shown offline ONLY for genuine reasoning — a request with no local handler and
 * no reminder shape. It names what DOES work offline first, so it never reads as "OpenAI is required
 * for everything" (the capability router already handled time/settings/greeting and reminders before
 * this is reached). Online this is never seen (the LLM answers).
 */
export const CHAT_PLACEHOLDER =
  'I can set reminders and tell you the time offline — but answering that needs an online AI provider. Add your OpenAI key in Settings to chat and answer questions.';
const UNDERSTOOD = "Here's what I understood.";

/**
 * ChatTurnService — the local-parser branch the ConversationEngine falls back to (offline chat,
 * action intents, reminder-shaped degrade). PURE: it runs the parser and returns a ShellTurn; it
 * does NOT persist (the engine owns the single faithful record now, so the SHOWN reply is stored,
 * not this placeholder — CONV Batch B). No LLM, no network.
 */
export class ChatTurnService {
  handleTurn(text: string): ShellTurn {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parse = parseReminder(text, new Date(), tz);

    if (parse.ok) return { reply: UNDERSTOOD, parse };
    if (parse.kind === 'clarification') return { reply: parse.clarification.question, parse };
    // Refusal / non-reminder → the honest placeholder (the engine may override with a real reply).
    return { reply: CHAT_PLACEHOLDER, parse: null };
  }
}
