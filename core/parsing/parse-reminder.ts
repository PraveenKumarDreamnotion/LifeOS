/**
 * The parser entry point (08 §1). A deterministic total function: text → ParseResult.
 * Pure — no I/O, no Electron, no Node. Ambiguity and refusal are RESULTS, not exceptions;
 * only a genuine bug throws.
 */
import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import type { ParseResult, ParsedReminder, ReminderIntent } from './types';
import { detectIntent } from './detect-intent';
import { extractRecurrence } from './extract-recurrence';
import { detectAmbiguity } from './detect-ambiguity';
import { extractTitle } from './extract-title';
import { scoreConfidence } from './score-confidence';
import { buildClarification } from './clarification';
import { buildRule } from '../scheduling/rrule';
import { nextOccurrence } from '../scheduling/next-occurrence';
import { normalizeReminderText } from './normalize-reminder';

const UNKNOWN_EXAMPLES = [
  'Remind me in 10 minutes to drink water',
  'Remind me tomorrow at 9 AM to attend the meeting',
  'Remind me every Monday at 7 AM to exercise',
];

export function parseReminder(text: string, refDate: Date, timezone: string): ParseResult {
  // STT-tolerant normalization FIRST: canonicalize a mis-heard reminder cue ("remained me",
  // "remains me", "it remind me") to "remind me" so offline dictation isn't rejected. Clean text is
  // returned unchanged, so typed/well-transcribed input is unaffected.
  const normalized = normalizeReminderText(text.trim().replace(/\s+/g, ' '));

  // 2. Intent — closed allow-list.
  const intent = detectIntent(normalized);
  if (intent === 'unknown') {
    return {
      ok: false,
      kind: 'refusal',
      refusal: {
        reason: 'unknown_intent',
        message: 'I only set reminders right now.',
        examples: UNKNOWN_EXAMPLES,
      },
    };
  }

  // 3. Recurrence — chrono cannot do this; runs before chrono.
  const rec = extractRecurrence(normalized);
  if (rec.kind === 'unsupported') {
    return {
      ok: false,
      kind: 'refusal',
      refusal: {
        reason: 'unsupported_recurrence',
        // Typed/spoken recurrence understands daily + weekly; monthly, yearly, intervals and end
        // dates are available from the “＋ New reminder” editor on the Schedules screen.
        message:
          'In chat I can repeat daily or weekly. For monthly, yearly or custom repeats, use “＋ New reminder” on the Schedules screen.',
        examples: ['Remind me every Monday at 7 AM to exercise', 'Remind me every day at 10 PM to sleep'],
      },
    };
  }

  // 4. chrono — forwardDate is mandatory (else "Friday" on a Friday resolves to last Friday).
  const results = chrono.parse(rec.strippedText, refDate, { forwardDate: true });
  const r = results[0] ?? null;

  // 6. Ambiguity — before persistence, never a guess.
  const amb = detectAmbiguity(r, rec, normalized);
  const dateText = r?.text ?? '';
  // Extract the title from the recurrence-stripped text (chrono parsed against it too), so
  // a leftover "every"/"daily" token doesn't end up in the title.
  const titlePreview = extractTitle(rec.strippedText, dateText, intent);

  if (amb) {
    return {
      ok: false,
      kind: 'clarification',
      clarification: buildClarification(amb, timezone, {
        intent: intent as Exclude<ReminderIntent, 'unknown'>,
        title: titlePreview || undefined,
        actionType: intent === 'create_sing_reminder' ? 'sing' : 'notify',
      }),
    };
  }

  // At this point r is non-null and the hour is certain.
  const title = titlePreview;
  if (!title && intent !== 'create_sing_reminder') {
    return {
      ok: false,
      kind: 'clarification',
      clarification: buildClarification({ kind: 'missing_title' }, timezone, {}),
    };
  }

  // 5/8. Build the scheduled instant + recurrence rule.
  const actionType = intent === 'create_sing_reminder' ? 'sing' : 'notify';
  const chronoDate = r!.date();
  const local = DateTime.fromJSDate(chronoDate, { zone: timezone });

  let scheduledAtUtcMs = chronoDate.getTime();
  let recurrenceRule: string | null = null;

  if (rec.kind === 'weekly' && rec.weekday !== undefined) {
    const rule = { freq: 'WEEKLY' as const, interval: 1, weekdays: [rec.weekday], hour: local.hour, minute: local.minute };
    recurrenceRule = buildRule(rule);
    scheduledAtUtcMs = nextOccurrence(rule, refDate.getTime(), timezone);
  } else if (rec.kind === 'daily') {
    const rule = { freq: 'DAILY' as const, interval: 1, hour: local.hour, minute: local.minute };
    recurrenceRule = buildRule(rule);
    scheduledAtUtcMs = nextOccurrence(rule, refDate.getTime(), timezone);
  }

  const scheduledIso = DateTime.fromMillis(scheduledAtUtcMs, { zone: timezone }).toISO() ?? '';

  const reminder: ParsedReminder = {
    intent: intent as Exclude<ReminderIntent, 'unknown'>,
    title: actionType === 'sing' ? 'Play Yogi song' : title,
    description: null,
    scheduledAtUtcMs,
    scheduledAtIso: scheduledIso,
    timezone,
    recurrenceRule,
    actionType,
    confidence: scoreConfidence(r, rec, title),
    source: 'local',
    matchedDateText: dateText,
  };

  return { ok: true, reminder };
}
