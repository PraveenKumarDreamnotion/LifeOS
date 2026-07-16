const FEMALE_RE = /female|zira|hazel|eva|aria|jenny|susan|catherine|linda|heera/i;
const MALE_RE = /\bmale\b|david|mark|guy|ryan|george|christopher|james|paul|ravi/i;
const NEUTRAL = () => false;
const VOICE_CATALOG = [
  { key: "calm", label: "Calm", hint: "Neutral, even — the default", openaiVoice: "alloy", windowsMatch: NEUTRAL },
  { key: "warm_female", label: "Warm Female", hint: "Bright, welcoming", openaiVoice: "nova", windowsMatch: (n) => FEMALE_RE.test(n) },
  { key: "soft_female", label: "Soft Female", hint: "Gentle, breathy", openaiVoice: "shimmer", windowsMatch: (n) => FEMALE_RE.test(n) },
  { key: "clear_male", label: "Clear Male", hint: "Crisp, measured", openaiVoice: "echo", windowsMatch: (n) => MALE_RE.test(n) },
  { key: "pro_male", label: "Professional Male", hint: "Deep, authoritative", openaiVoice: "onyx", windowsMatch: (n) => MALE_RE.test(n) },
  { key: "storyteller", label: "Storyteller", hint: "Expressive, narrative", openaiVoice: "fable", windowsMatch: NEUTRAL }
];
function findVoice(key) {
  return VOICE_CATALOG.find((v) => v.key === key) ?? VOICE_CATALOG[0];
}
function windowsMatchFor(key) {
  return findVoice(key).windowsMatch;
}
export {
  VOICE_CATALOG as V,
  windowsMatchFor as w
};
