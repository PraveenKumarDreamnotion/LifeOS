/**
 * LocalCommandRouter (Issue: offline mode) — the capability-first layer that answers LOCAL commands
 * WITHOUT the cloud LLM, in both offline and online modes. It is the "├── Local command → execute
 * locally (no OpenAI required)" branch of the capability router.
 *
 * Policy:
 *  • time / settings — ALWAYS handled locally (deterministic, actionable; no reason to spend an LLM
 *    call). This is the "hybrid: execute the local portion" behaviour online, too.
 *  • greeting / help — handled locally ONLY when there is no LLM (offline), so online chat keeps the
 *    model's warmth. Online → returns null → the engine's normal LLM path answers.
 *  • reminder / none — returns null: reminders go through the existing parser path; genuine reasoning
 *    goes to the LLM (online) or the honest "needs an online provider" notice (offline).
 *
 * Returns a ShellTurn (a normal assistant reply, parse:null) or null ("not a local command").
 */
import type { ShellTurn } from '../../../core/types/chat';
import { classifyLocalIntent } from '../../../core/routing/local-intent';

export type NavScreen = 'settings' | 'schedules';

export interface LocalCommandDeps {
  now: () => number;
  timezone: () => string;
  /** Optional app-control hook: switch the main window to a screen. Absent → a helpful text reply. */
  navigate?: (screen: NavScreen) => void;
}

/** (text, hasLlm) → a local reply, or null when this isn't a locally-handled command. */
export type LocalCommandRouter = (text: string, hasLlm: boolean) => ShellTurn | null;

const GREETING_REPLY =
  "Hi! I'm Yogi. I can set reminders, tell you the time, and manage your schedule — all offline. What would you like to do?";

const HELP_REPLY =
  'I can set reminders (try "remind me tomorrow at 9 AM to call John"), tell you the time and date, open Settings, and show your schedule — all without an internet connection. Connect an AI provider in Settings to also chat and look things up on the web.';

export function makeLocalCommandRouter(deps: LocalCommandDeps): LocalCommandRouter {
  return (text: string, hasLlm: boolean): ShellTurn | null => {
    const { intent } = classifyLocalIntent(text);
    switch (intent) {
      case 'time':
        return { reply: formatTimeReply(deps.now(), deps.timezone()), parse: null };
      case 'date':
        return { reply: formatDateReply(deps.now(), deps.timezone()), parse: null };
      case 'settings':
        deps.navigate?.('settings');
        return {
          reply: deps.navigate ? 'Opening Settings.' : 'You can open Settings from the ⚙ tab on the left.',
          parse: null,
        };
      case 'schedules':
        deps.navigate?.('schedules');
        return {
          reply: deps.navigate ? 'Here are your schedules.' : 'Your reminders are on the Schedules tab.',
          parse: null,
        };
      case 'greeting':
        return hasLlm ? null : { reply: GREETING_REPLY, parse: null };
      case 'help':
        return hasLlm ? null : { reply: HELP_REPLY, parse: null };
      case 'reminder':
      case 'none':
      default:
        return null; // reminders → parser path; none → LLM (online) / honest notice (offline)
    }
  };
}

/** A friendly spoken-style "it's <time> on <date>" answer in the user's timezone. */
export function formatTimeReply(nowMs: number, timezone: string): string {
  const d = new Date(nowMs);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(d);
  const date = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
  return `It's ${time} on ${date}.`;
}

/** A spoken-style "Today is <weekday>, <month> <day>, <year>." answer. */
export function formatDateReply(nowMs: number, timezone: string): string {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(nowMs));
  return `Today is ${date}.`;
}
