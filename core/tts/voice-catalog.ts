/**
 * Voice catalog (35 §1, §2.1) — friendly labels the user chooses, resolved per provider: to an
 * OpenAI voice id when the provider is OpenAI, or to the closest Windows OS voice offline. The
 * user picks a personality once (`tts_voice` = the friendly key); resolution happens at use time.
 *
 * Pure and DOM-free (ESLint-walled core): `windowsMatch` takes the voice's name/lang as primitives
 * — never a `SpeechSynthesisVoice` — so this compiles under the node tsconfig too. The audio
 * window applies it against its own `getVoices()`.
 *
 * Only the STABLE OpenAI voices are mapped (alloy/echo/fable/onyx/nova/shimmer) — the newer,
 * uncertain-branding voices are avoided so a POST never 400s on an unknown id (35 §2 RISK).
 */
export type OpenAiVoiceId = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export const DEFAULT_VOICE_KEY = 'calm';

const FEMALE_RE = /female|zira|hazel|eva|aria|jenny|susan|catherine|linda|heera/i;
const MALE_RE = /\bmale\b|david|mark|guy|ryan|george|christopher|james|paul|ravi/i;

export interface FriendlyVoice {
  key: string; // persisted (tts_voice), e.g. 'warm_female'
  label: string; // shown, e.g. 'Warm Female'
  hint: string;
  openaiVoice: OpenAiVoiceId;
  /** True for an OS voice (by name/lang) that best fits this personality; else the en fallback. */
  windowsMatch: (name: string, lang: string) => boolean;
}

const NEUTRAL = () => false; // no specific OS match → the audio window uses its en fallback chain

export const VOICE_CATALOG: FriendlyVoice[] = [
  { key: 'calm', label: 'Calm', hint: 'Neutral, even — the default', openaiVoice: 'alloy', windowsMatch: NEUTRAL },
  { key: 'warm_female', label: 'Warm Female', hint: 'Bright, welcoming', openaiVoice: 'nova', windowsMatch: (n) => FEMALE_RE.test(n) },
  { key: 'soft_female', label: 'Soft Female', hint: 'Gentle, breathy', openaiVoice: 'shimmer', windowsMatch: (n) => FEMALE_RE.test(n) },
  { key: 'clear_male', label: 'Clear Male', hint: 'Crisp, measured', openaiVoice: 'echo', windowsMatch: (n) => MALE_RE.test(n) },
  { key: 'pro_male', label: 'Professional Male', hint: 'Deep, authoritative', openaiVoice: 'onyx', windowsMatch: (n) => MALE_RE.test(n) },
  { key: 'storyteller', label: 'Storyteller', hint: 'Expressive, narrative', openaiVoice: 'fable', windowsMatch: NEUTRAL },
];

function findVoice(key: string): FriendlyVoice {
  return VOICE_CATALOG.find((v) => v.key === key) ?? VOICE_CATALOG[0]!;
}

/** Resolve a friendly key to an OpenAI voice id (unknown key → the default 'alloy', never fails). */
export function openAiVoiceFor(key: string): OpenAiVoiceId {
  return findVoice(key).openaiVoice;
}

/** The OS-voice match predicate for a friendly key (used by the audio window). */
export function windowsMatchFor(key: string): (name: string, lang: string) => boolean {
  return findVoice(key).windowsMatch;
}
