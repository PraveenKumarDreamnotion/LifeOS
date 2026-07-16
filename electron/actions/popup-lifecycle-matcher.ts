/**
 * Popup lifecycle matcher (55 §5, P2-B) — a LOCAL, deterministic classifier for what the user
 * typed/said in the reminder popup. The popup is about ONE specific reminder, so there is no
 * reference resolution: a lifecycle phrase maps straight to that reminder. Runs in main, never the
 * LLM (no LLM actuation), and works fully offline. Anything it doesn't recognise → `none`, and the
 * popup falls back to a normal chat turn (the model answers conversationally).
 *
 * Deliberately conservative on `cancel` (it deletes): a bare intent word is required.
 */
export type PopupLifecycle =
  | { kind: 'complete' }
  | { kind: 'dismiss' }
  | { kind: 'snooze'; minutes: number }
  | { kind: 'cancel' }
  | { kind: 'none' };

const DEFAULT_SNOOZE_MIN = 10;

export function matchPopupLifecycle(text: string): PopupLifecycle {
  const t = text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { kind: 'none' };

  // cancel / delete this reminder (checked first — strongest consequence).
  if (/\b(cancel|delete|remove)\b/.test(t)) return { kind: 'cancel' };

  // complete / done / "I already called him".
  if (/\b(complete|completed|done|finished|mark(ed)? (it |this )?(done|complete))\b/.test(t) ||
      /\balready (did|done|called|finished|completed|handled)\b/.test(t) ||
      /\bdid it\b/.test(t)) {
    return { kind: 'complete' };
  }

  // snooze / remind me again (+ optional duration).
  if (/\b(snooze|remind me (again|later)|later)\b/.test(t) || /\bin \d+\s*(min|minute|hour|hr)/.test(t) || /\b(an hour|half an hour)\b/.test(t)) {
    return { kind: 'snooze', minutes: parseSnoozeMinutes(t) };
  }

  if (/\b(dismiss|ignore)\b/.test(t)) return { kind: 'dismiss' };

  return { kind: 'none' };
}

/** Extract a snooze duration in minutes; default 10 if a snooze intent carried no explicit time. */
export function parseSnoozeMinutes(text: string): number {
  const t = text.toLowerCase();
  const m = t.match(/(\d+)\s*(minutes?|mins?|hours?|hrs?)/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    return /hour|hr/.test(m[2]!) ? n * 60 : n;
  }
  if (/half an hour/.test(t)) return 30;
  if (/\b(an|one) hour\b/.test(t)) return 60;
  return DEFAULT_SNOOZE_MIN;
}

/** "30 minutes" / "1 hour" / "2 hours" — for the confirming reply. */
export function formatSnooze(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
