/**
 * The spoken line for a fired reminder. Voice-first, so it should sound like a person, not a data
 * field being read out. The old behaviour spoke the raw title AND "It's time — <title>" from two
 * places, so the user heard a clipped double ("Call… It's time — Call Biplab"). This is the single
 * natural template: a short greeting, then the reminder delivered conversationally.
 *
 * Reminder titles are usually imperative actions extracted from "remind me to X" ("Call Biplab",
 * "Drink water"), so "It's time to <lower-cased title>" reads naturally for the common case; a
 * non-action title still reads acceptably. Pure: no I/O, safe to share across main + popup.
 */
export function spokenReminder(title: string): string {
  const t = (title ?? '').trim();
  if (!t) return "Hi there. It's time for your reminder.";
  const body = t.charAt(0).toLowerCase() + t.slice(1);
  return `Hi there. It's time to ${body}.`;
}
