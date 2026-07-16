# 35 — Voice System

> **v2 addition:** the reminder popup ([55](55-reminder-popup-workflow.md)) speaks the reminder on
> show and takes a voice reply — it reuses this voice system (TTS out) + EP-3 STT. The speech
> pipeline is a single-session singleton, so the popup owns the mic while open and TTS is serialized
> (one popup at a time; `55` §2.7).
>
> **Scope:** the internals of the "Voice" experience — the catalog of voices (OpenAI +
> Windows), the friendly-name→provider-voice mapping, the **Preview** button, the rate
> control, and how the selected voice becomes Yogi's default speaking voice. The broader
> Settings shell that hosts the Voice section is `34`; the `TextToSpeechProvider` interface
> and the **`audio:playBytes`** path are `33` §3; cloud gating/consent/cost is `32`.
>
> **Two audit findings this doc closes (`30` §3.2):**
> 1. `src/audio-host.ts` `speak()` **accepts `voiceId` but ignores it** (destructures only
>    `{text, rate}`), and `trigger-sink.ts` sends `{text}` only — so voice/rate are **dead
>    plumbing** on both ends today.
> 2. `tts_voice_id`, `tts_rate`, `tts_degraded` are **orphaned settings** — defined in
>    `SETTING_DEFAULTS`, read by nobody. This doc finally wires them.

---

## 1. The unified "Voice" model

`MVP DECISION` — A Voice is a **friendly category** the user chooses, which *resolves* to a
concrete provider voice depending on the active TTS provider (`33` §3):

```ts
// core/tts/voice-catalog.ts
export interface FriendlyVoice {
  key: string;            // stable id we persist, e.g. 'warm_female'
  label: string;          // shown to the user, e.g. "Warm Female"
  hint: string;           // one line, e.g. "Soft, welcoming"
  openaiVoice: OpenAiVoiceId;          // resolves here when tts_provider === 'openai'
  windowsMatch: (v: SpeechSynthesisVoice) => boolean;  // picks the closest OS voice offline
}
```

We persist **two** things (the brief's requirement to store the provider voice internally
while showing a friendly name):

- `tts_voice` — the friendly `key` (survives a provider switch).
- `tts_voice_id` — the **resolved provider voice id** for the *current* provider (e.g.
  `alloy` for OpenAI, or a Windows `voiceURI`). Recomputed when the provider or friendly
  voice changes. This is the value `trigger-sink.ts`/`speak()` actually consume.

So "Warm Female" means `nova` on OpenAI and (say) "Microsoft Zira" offline — the user picks a
personality once; the app resolves it per provider. Switching STT/TTS provider never loses
the choice.

---

## 2. OpenAI voices (the cloud catalog)

`VERIFIED FACT (baseline set)` — The long-standing OpenAI TTS voices, available on `tts-1` /
`tts-1-hd` and `gpt-4o-mini-tts`: **`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`**.

`ASSUMPTION (newer set — verify against the live API at build time)` — `gpt-4o-mini-tts`
added expressive voices commonly cited as **`ash`, `ballad`, `coral`, `sage`, `verse`** (and
`coral`/`sage` appear in OpenAI demos). Because the exact roster and gender/character
branding shift, the catalog is **data-driven and validated at runtime**: on first use of the
OpenAI provider, the app may call a tiny Preview to confirm a voice id is accepted, and an
unknown id falls back to `alloy`. **Do not hard-fail on an unrecognised voice id** — OpenAI
adds/renames voices without an app release, so treat the list as a default that a settings
value can override (`09` §4 model-in-settings principle, applied to voices).

`RISK (low)` — OpenAI does not formally label voices by gender; the friendly mapping below is
by *perceived* character from OpenAI's own samples and may need tuning. It is presentation
only; the stored id is the source of truth.

### 2.1 Friendly-name → OpenAI voice mapping (default)

| Friendly label (`key`) | OpenAI voice | Character (why) |
| --- | --- | --- |
| Soft Female (`soft_female`) | `shimmer` | gentle, breathy |
| Warm Female (`warm_female`) | `nova` | bright, welcoming |
| Calm (`calm`) | `alloy` | neutral, even — the safe default |
| Friendly (`friendly`) | `coral`* | upbeat, personable |
| Professional Male (`pro_male`) | `onyx` | deep, authoritative |
| Storyteller (`storyteller`) | `fable` | expressive, narrative |
| Energetic (`energetic`) | `verse`* | lively |
| Clear Male (`clear_male`) | `echo` | crisp, measured |

`*` = from the "newer set" — validated at runtime; falls back to `alloy` if the id is
rejected. **`alloy` (Calm) is the default Yogi voice** — the most neutral, lowest-surprise
choice.

---

## 3. Windows voices (the offline catalog)

`33` §3: `WebSpeechTtsProvider` is the offline default and the fallback. Its voices are the OS
voices, enumerated **at runtime** via the `voiceschanged` pattern from `07` §2.3 (never read
synchronously — `getVoices()` frequently returns `[]` on the first call):

```ts
// in the hidden audio window (audio-host.ts) — already present as voicesReady()
async function listWindowsVoices(): Promise<SpeechSynthesisVoice[]> {
  const v = speechSynthesis.getVoices();
  if (v.length) return v;
  return new Promise(res => speechSynthesis.addEventListener(
    'voiceschanged', () => res(speechSynthesis.getVoices()), { once: true }));
}
```

- Main asks the audio window for the OS voice list (a new `tts:listVoices` round-trip) and
  presents them under friendly labels where a known Windows voice matches
  (`windowsMatch`), else by their raw OS name (e.g. "Microsoft Zira — English (US)").
- `MVP DECISION` — When the provider is **Windows**, the friendly categories still show, but
  each resolves to the closest installed OS voice via `windowsMatch`; if no match, we fall to
  the first `en-*` voice, then `voices[0]` (the `07` §2.3 chain — this is the one place the
  audit found `speak()` already does the right thing for the *default*, just never for a
  *chosen* id).

---

## 4. Preview / "Play Sample"

`MVP DECISION` — Preview speaks a fixed line — **"This is Yogi. Nice to meet you."** — through
the **currently-selected provider + voice + rate**, so the user hears exactly what reminders
will sound like.

### 4.1 Flow (end to end)

```text
Settings Voice section: user picks a voice / drags rate → presses Preview
   │  ipc.tts.preview()                       (renderer → main, invoke)
   ▼
MAIN: resolve active TextToSpeechProvider (33 §5) + voiceId + rate
   ├─ provider.kind === 'in-window' (Windows):
   │     send('tts:speak', { text: SAMPLE, voiceId, rate })   → audio-host speaks (existing path,
   │                                                             now HONOURING voiceId — the fix)
   └─ provider.kind === 'audio-bytes' (OpenAI):
         bytes = await OpenAiTtsProvider.speak(SAMPLE, {voiceId, rate})   ← network in MAIN, key stays
         send('audio:playBytes', { mime:'audio/mpeg', bytes })  → audio-host: Blob → objectURL → <audio>
   ▼
audio-host plays; on failure sends audio:playbackError → main degrades + surfaces a notice
```

- `MVP DECISION` — Preview for OpenAI **costs a small API call**; the button shows a subtle
  "uses your OpenAI key" hint and is **debounced** (one in-flight preview at a time) so a
  user cannot rack up cost by mashing it.
- The **same `audio:playBytes` path** that Preview exercises is what real reminders use for
  OpenAI TTS — so Preview is a genuine end-to-end test of the speaking path, not a mock.

---

## 5. Making the selection Yogi's default voice (fixing the dead plumbing)

Today `trigger-sink.ts` sends `{ text: r.title }` and `audio-host.ts speak()` ignores
`voiceId`. v2 threads the resolved values through:

```ts
// trigger-sink.ts (TTS best-effort branch) — was: send('tts:speak', { text: r.title })
aw.webContents.send('tts:speak', {
  text: r.title,
  voiceId: settings.get('tts_voice_id') || undefined,   // ← orphan setting, now read
  rate:    Number(settings.get('tts_rate')) || 1.0,     // ← orphan setting, now read
});
```

```ts
// audio-host.ts speak() — was: ({ text, rate }) ⇒ ...   (dropped voiceId)
onSpeak(({ text, voiceId, rate }) => speak(text, { voiceId, rate }));
// and inside speak(): pick voices.find(v => v.voiceURI === voiceId) ?? <en fallback chain>
```

For the OpenAI provider, `tts_voice_id` holds the OpenAI voice id (e.g. `nova`) and the
provider passes it straight to `/audio/speech`. **One setting, two resolutions, one honoured
value.**

---

## 6. Rate / speed control

- `tts_rate` (orphan → now read), a number stored as string; default `'1.0'`.
- Windows: `SpeechSynthesisUtterance.rate` (clamped to the platform's sane range, ~0.5–2.0).
- OpenAI: passed as the `speed` parameter to `/audio/speech` (clamped to OpenAI's accepted
  range). The friendly UI is a single slider **Slow ─●─ Fast**; the same slider drives both
  providers, each clamping to its own limits.

---

## 7. Degradation — never a dead end (`33` §3.2)

| Situation | Behaviour |
| --- | --- |
| OpenAI TTS selected, no key / not consented | Silently use Windows voice; Preview shows "Add an OpenAI key in Settings to use online voices." |
| OpenAI TTS call fails at speak time | `withFallback` → Windows voice; set `tts_degraded=true`; one non-modal notice "Using your Windows voice"; **notification still fired first** (`30` §2.4) |
| Zero OS voices installed (Windows path) | Disable Preview + the voice picker with a link to *Windows Settings → Time & language → Speech*; the "Speak reminders aloud" toggle is disabled; reminders still **notify** silently (`07` §9) |
| Audio window dead | Recreated with a cap, else notify-only (`30` §2, `windows.ts` self-heal) |

`MVP DECISION` — TTS failure is **never** fatal. A silent reminder is still a working
reminder; the notification and history always fire first (`07` §5, `30` §13.4).

---

## 8. Database / settings changes

| Setting | Change |
| --- | --- |
| `tts_voice` | **new** — the friendly `key` (e.g. `warm_female`); default `calm` |
| `tts_voice_id` | orphan → **now read/written**; resolved provider voice id |
| `tts_rate` | orphan → **now read/written** |
| `tts_degraded` | orphan → **now set** on fallback |
| `tts_provider` | **new** (`33` §7) — `'web-speech' \| 'openai'` |

No table change; all live in `settings`. Add typed accessors so callers stop hand-parsing
(`30` §3.2; `34` §7).

## 9. IPC changes

| Channel | Kind | Purpose |
| --- | --- | --- |
| `tts:preview` | invoke | speak the sample via the active provider+voice+rate |
| `tts:listVoices` | invoke | main ← audio-window OS voice list (for the Windows picker) |
| `audio:playBytes` | send (main→audio) | play an audio buffer `{mime, bytes}` — **new** (`33` §3.1); size-capped; blob:, never a path |
| `audio:playbackError` | send (audio→main) | wire the previously-dead `audio:error` (`30` D8) |
| `tts:speak` | send (main→audio) | now carries `{text, voiceId, rate}` (was `{text}`) |

All renderer-facing channels through `guard()` (`16` §5); the audio-window bridge stays
receive-mostly (`16` §7).

## 10. Main / Renderer / Security changes

- **Main:** resolve the active `TextToSpeechProvider` + voiceId + rate for Preview and for
  every reminder fire; OpenAI network call in main (key never leaves); send bytes to the audio
  window.
- **Renderer (Settings Voice section):** friendly voice dropdown (grouped Online/Offline by
  active provider), rate slider, Preview button with the cost hint and disabled/explained
  states; the audio window gains `audio:playBytes` → Blob → objectURL → `<audio>` and the
  playback-error report.
- **Security:** bytes not paths; `blob:` (already allowed by CSP `media-src`/`worker-src
  blob:`), never a remote URL; buffer size-capped (≤ ~2 MB/utterance); key in main only;
  Preview debounced to bound cost; cloud-TTS consent ("text Yogi speaks is sent to OpenAI")
  is the `32` §2 gate.

## 11. Testing plan

- Unit: `voice-catalog` friendly↔id round-trip; unknown OpenAI id → `alloy` fallback;
  `windowsMatch` selection; rate clamping per provider.
- Integration: `trigger-sink` now includes `voiceId`+`rate`; `audio:playBytes` size cap +
  blob path (no fs writes); fallback OpenAI→Windows→silent sets `tts_degraded`.
- Manual (below).

## 12. Manual testing
1. Settings → Voice: with OpenAI TTS on, pick "Warm Female" → Preview. → Expected: hear "This
   is Yogi. Nice to meet you." in the `nova` voice; a subtle "uses your OpenAI key" hint.
2. Drag rate to Fast → Preview. → Expected: same voice, faster.
3. Create a 1-minute reminder. → Expected: at fire, Yogi speaks the title in the chosen voice
   and rate (not the old default).
4. Switch TTS → Windows; Preview + a reminder. → Expected: an offline OS voice; no network.
5. Remove the OpenAI key; keep TTS = OpenAI. → Expected: Preview explains it needs a key;
   reminders speak in the Windows voice; a one-time "using Windows voice" notice.
6. On a VM with no OS voices, TTS = Windows. → Expected: Voice picker + Preview disabled with a
   link to Windows speech settings; reminders still notify (silent).
7. Mash Preview 5× fast. → Expected: debounced — at most one plays; no cost spike.

## 13. Edge cases
Unknown/renamed OpenAI voice id (→ `alloy`); OS voice uninstalled after selection (→ fallback
chain); oversized audio buffer (reject → fallback); rate out of range (clamped); audio window
recreated mid-preview (Preview reports error, offers retry); provider switched while a preview
is in flight (in-flight preview cancelled).

## 14. Risks
- **Voice character/branding drift** on OpenAI's side. Mitigation: data-driven catalog,
  runtime validation, `alloy` fallback, ids overridable via settings.
- **Cost from Preview / verbose reminders on OpenAI TTS.** Mitigation: debounce, per-Preview
  cost hint, monthly estimate (`32` §6), Windows remains the zero-cost default.
- **Audio-window throttling** (`07` SPIKE-3) is unchanged and mitigated by notify-first.

## 15. Rollback plan
`tts_provider` → `web-speech` reverts to offline voices; the `audio:playBytes` path is only
reached for the audio-bytes kind, so reverting is a single setting. If the voice picker itself
regresses, hide the Voice section and fall back to the default voice — reminders still speak.

## 16. Definition of Done
- Friendly voices map to OpenAI ids and Windows voices; the selection persists as `tts_voice`
  + resolved `tts_voice_id` and survives a provider switch.
- Preview works for **both** providers via the real speaking path; disabled states are
  explained.
- Reminders speak in the chosen voice + rate (the dead `voiceId`/`rate` plumbing is fixed).
- Fallback OpenAI→Windows→silent works; `tts_degraded` is set; a reminder always at least
  notifies.
- Bytes-not-paths / key-in-main / debounced-Preview verified; all §11–§13 tests pass.
