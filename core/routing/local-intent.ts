/**
 * Local-intent classification with CONFIDENCE SCORING — the capability router's first stage.
 *
 * The goal (per the offline-mode work): recognise reminders and simple device commands ROBUSTLY,
 * on-device, with no cloud LLM — tolerant of natural phrasing and minor speech-to-text noise. Rather
 * than one brittle regex per phrase, each candidate intent accumulates a score from weighted signals
 * and the highest wins (below a floor → 'none' → the LLM online, or the honest offline notice).
 *
 * Two matching styles, on purpose:
 *  • Reminders are SCORED — a reminder verb ("remind me", "ping me", "don't forget", "wake me", …)
 *    plus an optional time expression ("in 5 min", "after one minute", "tomorrow at 9", "every
 *    Monday"). This tolerates word order ("after one minute remind me…"), extra words, and STT slop.
 *  • Deterministic device commands (time / date / settings / schedules) are WHOLE-COMMAND matches —
 *    they must BE the utterance, so "what time is it in Tokyo" (a tail the local clock can't answer)
 *    falls through to the LLM instead of getting a wrong local answer.
 *
 * The actual reminder field extraction still belongs to parseReminder; this only decides routing.
 * Pure: no I/O, no Node/DOM.
 */
import { detectIntent } from '../parsing/detect-intent';
import { normalizeReminderText } from '../parsing/normalize-reminder';

export type LocalIntent = 'reminder' | 'time' | 'date' | 'settings' | 'schedules' | 'greeting' | 'help' | 'none';

export interface LocalClassification {
  intent: LocalIntent;
  /** 0–1. Reminders scale with how many reminder signals fired; device commands are ~0.95 or 0. */
  confidence: number;
}

/** Below this, we don't claim a local intent — the turn goes to the LLM (online) / offline notice. */
export const LOCAL_CONFIDENCE_FLOOR = 0.5;

// ── Reminder signals (scored) ──────────────────────────────────────────────
/** Explicit "please remind/alert me" verbs. Broad but anchored to a person-directed cue so a bare
 *  "call John" (a statement) doesn't score. Aligned with detect-intent so the parser agrees. */
const REMINDER_VERBS =
  /\b(?:remind(?:\s+me)?|don'?t\s+(?:let\s+me\s+)?forget|wake\s+me|nudge\s+me|ping\s+me|buzz\s+me|alert\s+me|notify\s+me|(?:set|give|make|create|add)\s+(?:me\s+|us\s+)?(?:a|an)\s+(?:reminder|alarm)|make\s+sure\s+i)\b/i;
/** A time/when expression. Its presence corroborates a reminder and disambiguates phrasing. */
const TIME_EXPR =
  /\b(?:in\s+\w+\s+(?:second|minute|min|hour|day|week)s?|after\s+\w+\s+(?:second|minute|min|hour|day|week)s?|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)\b|tomorrow|tonight|today|this\s+(?:morning|afternoon|evening|noon)|every\s+\w+|each\s+\w+|next\s+\w+|on\s+(?:mon|tue|wed|thu|fri|sat|sun)\w*|o'?clock|midnight|noon)\b/i;

function reminderScore(raw: string): number {
  // Normalize a mis-transcribed cue ("remained me" → "remind me") first, so STT errors still score.
  const t = normalizeReminderText(raw);
  let score = 0;
  // The parser's own gate is the strongest signal — if IT sees a reminder, we agree fully.
  if (detectIntent(t) !== 'unknown') score += 0.7;
  else if (REMINDER_VERBS.test(t)) score += 0.6; // a reminder verb the parser's list may miss
  if (TIME_EXPR.test(t)) score += 0.25; // a "when" corroborates
  return Math.min(score, 1);
}

// ── Deterministic device commands (whole-command, anchored) ────────────────
const TIME_RE = /^(?:what(?:'s| is)?\s+(?:the\s+)?time|what\s+time\s+is\s+it|current\s+time|time\s+(?:right\s+)?now|the\s+time\s+please)\??$/i;
const DATE_RE = /^(?:what(?:'s| is)?\s+(?:the\s+|today'?s\s+)?date|what\s+day\s+is\s+(?:it|today)|what'?s\s+today|today'?s\s+date)\??$/i;
const SETTINGS_RE = /^(?:open|show|go\s+to|take\s+me\s+to|launch)\s+(?:the\s+)?(?:settings|preferences|options)\??$/i;
const SCHEDULES_RE = /^(?:(?:show|list|see|open|view)\s+(?:me\s+)?(?:my\s+)?(?:reminders|schedules?)|my\s+(?:reminders|schedule)|what(?:'s| are)?\s+(?:my\s+)?(?:upcoming\s+)?reminders|upcoming\s+reminders)\??$/i;
// A trailing "yogi"/"there" is allowed so "Hey Yogi." / "Hi Yogi" ARE greetings; a longer tail
// ("hey yogi, how are you") is NOT — that's conversation and goes to the LLM (or the offline notice).
const GREETING_RE = /^(?:hi+|hey+|hello+|yo|howdy|good\s+(?:morning|afternoon|evening|night)|thanks?|thank\s+(?:you|u)|thx|ty|cheers)(?:\s+(?:yogi|there|buddy|friend))?[!.,\s]*$/i;
const HELP_RE = /^(?:help|what\s+can\s+you\s+do|what\s+do\s+you\s+do|how\s+do\s+(?:you|i)\s+(?:use|work)\b.*|what\s+are\s+your\s+(?:features|capabilities))\??$/i;

/**
 * Classify with confidence. Reminders are scored (tolerant); device commands are whole-command.
 * The highest-scoring candidate wins; ties break toward reminders (the primary offline capability).
 */
export function classifyLocalIntent(text: string): LocalClassification {
  const t = text.trim();
  if (!t) return { intent: 'none', confidence: 0 };

  const candidates: LocalClassification[] = [
    { intent: 'reminder', confidence: reminderScore(t) },
    { intent: 'time', confidence: TIME_RE.test(t) ? 0.95 : 0 },
    { intent: 'date', confidence: DATE_RE.test(t) ? 0.95 : 0 },
    { intent: 'settings', confidence: SETTINGS_RE.test(t) ? 0.95 : 0 },
    { intent: 'schedules', confidence: SCHEDULES_RE.test(t) ? 0.9 : 0 },
    { intent: 'greeting', confidence: GREETING_RE.test(t) ? 0.9 : 0 },
    { intent: 'help', confidence: HELP_RE.test(t) ? 0.85 : 0 },
  ];

  const best = candidates.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return best.confidence >= LOCAL_CONFIDENCE_FLOOR ? best : { intent: 'none', confidence: best.confidence };
}
