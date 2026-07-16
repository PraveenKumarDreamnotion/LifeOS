/**
 * Email summarization (Phase 3) — pure prompt + schema + formatters (no fetch, no electron).
 *
 * The summary is produced by the SAME gated LLM seam the conversation uses (structured outputs), so
 * key handling + consent + the offline gate are all inherited. Formatters build the assistant turn
 * text (which doubles as Yogi's context — it's delivered as a chat turn) and the spoken line.
 */
import type { LlmTurnInput } from '../llm/llm-provider';
import type { EmailAiContext, WebResearch } from './types';

/** Minimal message view the formatters + prompt need (works for a stored message or a NewMessage). */
export interface SummarizableEmail {
  fromName: string | null;
  fromAddress: string | null;
  subject: string;
  snippet: string;
}

export const EMAIL_SUMMARY_SYSTEM = [
  'You are Yogi, summarizing an email for a busy user. You are given the sender, subject, and a short preview.',
  'Produce a concise, FACTUAL understanding — never invent details that are not present.',
  '- summary: 1–2 plain-language sentences of what the email is about.',
  '- senderIntent: what the sender wants, in a few words.',
  '- actionItems: concrete things the user may need to do (empty array if none).',
  '- keyDates: any dates/deadlines/times mentioned (empty array if none).',
  "- priority: 'high' for time-sensitive or important mail (bills, security alerts, deadlines, travel, legal/medical),",
  "  'low' for promotions/newsletters, otherwise 'normal'.",
  '- researchWorthwhile: DEFAULT false. Set true ONLY when a live web lookup would genuinely help the',
  '  user act on this specific email — e.g. a visa/immigration update, a flight delay/cancellation, a',
  '  government/legal/tax notice, a medical appointment, a shipping/delivery delay, a university',
  '  admission, or a conference/event. NEVER for newsletters, promotions, social, or ordinary personal mail.',
  '- researchQuery: when researchWorthwhile, a concise, focused web-search query (e.g. "US F1 visa',
  '  interview wait time Delhi 2026"); otherwise an empty string.',
].join('\n');

/** Strict JSON schema for OpenAI Structured Outputs. */
export const EMAIL_SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'senderIntent', 'actionItems', 'keyDates', 'priority', 'researchWorthwhile', 'researchQuery'],
  properties: {
    summary: { type: 'string' },
    senderIntent: { type: 'string' },
    actionItems: { type: 'array', items: { type: 'string' } },
    keyDates: { type: 'array', items: { type: 'string' } },
    priority: { type: 'string', enum: ['low', 'normal', 'high'] },
    researchWorthwhile: { type: 'boolean' },
    researchQuery: { type: 'string' },
  },
} as const;

function emailForSummary(m: SummarizableEmail): string {
  const from = `${m.fromName ?? ''} <${m.fromAddress ?? ''}>`.trim();
  return `From: ${from}\nSubject: ${m.subject || '(no subject)'}\n\nPreview:\n${m.snippet || '(no preview)'}`;
}

/** Build the LLM input for a single-email summary (reminders/memories empty — irrelevant here). */
export function buildEmailSummaryInput(m: SummarizableEmail, nowIso: string, timezone: string): LlmTurnInput {
  return {
    system: EMAIL_SUMMARY_SYSTEM,
    nowIso,
    timezone,
    reminders: [],
    memories: [],
    messages: [{ role: 'user', text: emailForSummary(m) }],
    responseSchema: EMAIL_SUMMARY_JSON_SCHEMA,
  };
}

/** Coerce the raw LLM JSON into a validated EmailAiContext (never throws — degrades to defaults). */
export function parseEmailContext(raw: unknown): EmailAiContext {
  const o = (raw ?? {}) as Record<string, unknown>;
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const priority = o.priority === 'high' || o.priority === 'low' ? o.priority : 'normal';
  const researchQuery = typeof o.researchQuery === 'string' ? o.researchQuery : '';
  return {
    summary: typeof o.summary === 'string' ? o.summary : '',
    senderIntent: typeof o.senderIntent === 'string' ? o.senderIntent : '',
    actionItems: strArray(o.actionItems),
    keyDates: strArray(o.keyDates),
    priority,
    // Only worthwhile if the model said so AND gave a non-empty query (fail-safe: no query → skip).
    researchWorthwhile: o.researchWorthwhile === true && researchQuery.trim().length > 0,
    researchQuery,
  };
}

export function senderLabel(m: SummarizableEmail): string {
  return m.fromName || m.fromAddress || 'Unknown sender';
}

/** The assistant turn text delivered into the email's chat. Doubles as Yogi's context (it's the
 *  turn the engine reads from recentTurns), so it carries the summary + action items + dates. */
export function formatDeliveryText(m: SummarizableEmail, ctx: EmailAiContext | null): string {
  const lines = [`📧 New email from ${senderLabel(m)}`, `Subject: ${m.subject || '(no subject)'}`, ''];
  if (ctx && ctx.summary) {
    lines.push(ctx.summary);
    if (ctx.actionItems.length) {
      lines.push('', 'What you may need to do:', ...ctx.actionItems.map((a) => `• ${a}`));
    }
    if (ctx.keyDates.length) lines.push('', `Key dates: ${ctx.keyDates.join(', ')}`);
  } else {
    lines.push(m.snippet || '(no preview available)');
  }
  lines.push('', 'Ask me to summarize this, who sent it, what action it needs, or to research it.');
  return lines.join('\n');
}

/** The research turn appended to an email's chat (Phase 4). Assistant-only (empty user text via
 *  recordEmailDelivery) so it lands in Yogi's context for cross-questions. */
export function formatResearchText(r: WebResearch): string {
  const lines = ['🔎 I looked into this for you:', '', r.answer];
  if (r.citations.length) {
    lines.push('', 'Sources:', ...r.citations.slice(0, 5).map((c) => `• ${c.title} — ${c.url}`));
  }
  return lines.join('\n');
}

function firstSentence(text: string, cap = 160): string {
  const s = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return s.length > cap ? `${s.slice(0, cap - 1)}…` : s;
}

/** The spoken (TTS) line — ONE utterance per batch (never N overlapping). */
export function formatSpokenLine(newCount: number, first: SummarizableEmail | null, ctx: EmailAiContext | null): string {
  if (newCount <= 0) return '';
  if (newCount === 1 && first) {
    const gist = ctx?.summary ? ` ${firstSentence(ctx.summary)}` : '';
    return `You've got a new email from ${senderLabel(first)}.${gist}`;
  }
  return `You've got ${newCount} new emails.`;
}
