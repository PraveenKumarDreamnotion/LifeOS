/**
 * VoiceConfirmMatcher (36 §4.1, 48 §New services) — the LOCAL, closed-set phrase matcher that lets
 * a spoken "yes"/"no" confirm or cancel a pending proposal. It runs ONLY in main, against a fixed
 * list, and NEVER goes to the LLM — a prompt-injected model cannot turn "no thanks" into a confirm
 * because the transcript is never round-tripped for a yes/no decision (41 §8.5).
 *
 * Deliberately conservative (the safe direction on ambiguity is "do not confirm", 48 §MVP): a
 * qualified/partial answer ("yes but change the time", "maybe later") resolves to `neither` so the
 * card stays pending. A missed "yes" costs one button press; a false "yes" would persist an
 * unwanted action.
 */
export type VoiceMatch = 'affirm' | 'negate' | 'repeat' | 'neither';

const AFFIRM = ['yes', 'yeah', 'yep', 'yup', 'confirm', 'sure', 'okay', 'ok', 'correct', 'yup'];
const AFFIRM_PHRASES = ['do it', 'go ahead', 'sounds good', 'that works'];
const NEGATE = ['no', 'nope', 'nah', 'cancel', 'stop', "don't", 'dont', 'nevermind'];
const NEGATE_PHRASES = ['never mind', 'forget it', 'no thanks'];
const REPEAT = ['repeat'];
const REPEAT_PHRASES = ['say again', 'what was that', 'read it back', 'what did you say'];

/** A "qualified" answer carries a decision word but ALSO a change/condition/negation → neither.
 *  "not" is here so "I'm not sure" / "not now" never read as the "sure"/affirm inside them. */
const QUALIFIER_WORDS = ['but', 'instead', 'change', 'except', 'actually', 'not'];
const QUALIFIER_PHRASES = ['make it'];

export function matchVoiceConfirm(transcript: string): VoiceMatch {
  const norm = normalise(transcript);
  if (!norm) return 'neither';

  const words = norm.split(' ');
  const hasWord = (set: string[]) => words.some((w) => set.includes(w));
  const hasPhrase = (set: string[]) => set.some((p) => norm.includes(p));

  // A qualified utterance is never a clean yes/no — stay pending (false-positive prevention).
  if (hasWord(QUALIFIER_WORDS) || hasPhrase(QUALIFIER_PHRASES)) return 'neither';

  // Negate wins ties (fails safe: a "no" mixed with a "yes" cancels rather than persists).
  if (hasWord(NEGATE) || hasPhrase(NEGATE_PHRASES)) return 'negate';
  if (hasWord(AFFIRM) || hasPhrase(AFFIRM_PHRASES)) return 'affirm';
  if (hasWord(REPEAT) || hasPhrase(REPEAT_PHRASES)) return 'repeat';
  return 'neither';
}

/** Lowercase, strip punctuation, collapse whitespace — so "Yes!" and " yes ." both match "yes". */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
