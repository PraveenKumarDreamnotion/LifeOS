/**
 * STT-tolerant reminder normalization.
 *
 * Offline on-device STT (the small sherpa model) frequently mis-hears the reminder cue "remind me":
 * observed real transcripts include "it REMAINED me in one minute", "REMAINS me to call John",
 * "IT remind me…", "WHO remind me after…". The parser needs the literal "remind me", so these fall
 * through to the offline "needs an online provider" notice — even though the user clearly asked for a
 * reminder. This is the "tolerant of minor speech-to-text errors" requirement.
 *
 * The fix is principled, not per-phrase: detect a token that is within a small EDIT DISTANCE of the
 * "remind" verb family and is followed by "me", canonicalize it to "remind me", and drop the leading
 * filler words STT tends to prepend ("it", "who", "hey", "yogi", …). The corrected text then flows
 * through the normal parser (title + time extraction) unchanged. Clean input is returned untouched.
 *
 * Pure: no I/O, no Node/DOM.
 */

/** Bounded Levenshtein — returns the true distance, or `max + 1` once it provably exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = Array.from({ length: bl + 1 }, (_, i) => i);
  for (let i = 1; i <= al; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // whole row already past the budget
    prev = curr;
  }
  return prev[bl]!;
}

/** The "remind" verb family we canonicalize toward (NOT the noun "reminder" — that stays as-is). */
const REMIND_TARGETS = ['remind', 'reminds', 'reminded', 'reminding'];

/** True if `word` is a (possibly STT-garbled) form of the "remind" verb. Length-gated so short words
 *  can't match, and never matches the noun "reminder"/"reminders" (handled by the normal parser). */
export function isRemindVerbCue(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 5 || w.length > 10) return false;
  if (w.startsWith('reminder')) return false; // the noun — leave "set a reminder" alone
  return REMIND_TARGETS.some((t) => editDistance(w, t, 2) <= 2);
}

/** Filler STT commonly prepends before the cue; safe to drop when it sits right before "remind". */
const LEADING_FILLER = new Set([
  'it', 'i', 'you', 'we', 'who', 'he', 'she', 'they', 'please', 'hey', 'hi', 'yogi', 'ok', 'okay',
  'so', 'um', 'uh', 'and', 'now', 'just', 'can', 'could', 'would', 'will', 'to',
]);

const IS_ME = (w: string) => /^me[.,!?]?$/i.test(w);

/**
 * Canonicalize an STT-corrupted reminder cue to "remind me", dropping leading filler. Returns the
 * text unchanged when there is no confident reminder-verb cue followed by "me".
 */
export function normalizeReminderText(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length === 0) return text;

  // Find the first "<remind-ish> me" cue.
  let cueIdx = -1;
  for (let i = 0; i < words.length - 1; i++) {
    if (isRemindVerbCue(words[i]!) && IS_ME(words[i + 1]!)) {
      cueIdx = i;
      break;
    }
  }
  if (cueIdx === -1) return text; // no confident cue → leave it alone

  // Drop the contiguous run of leading filler immediately before the cue ("it"/"who"/"hey yogi"…).
  let start = cueIdx;
  while (start > 0 && LEADING_FILLER.has(words[start - 1]!.toLowerCase().replace(/[^a-z]/g, ''))) {
    start--;
  }

  const before = words.slice(0, start); // meaningful content before the filler run (e.g. a time phrase)
  const after = words.slice(cueIdx + 2); // everything after "<cue> me"
  const rebuilt = [...before, 'remind', 'me', ...after].join(' ').replace(/\s+/g, ' ').trim();
  return rebuilt;
}
