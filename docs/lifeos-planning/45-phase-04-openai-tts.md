# 45 — Phase EP-4: OpenAI Text-to-Speech + Voice System

> **Execution phase EP-4** of the eleven-phase plan (`41` §5). **Ships in v0.4** alongside
> EP-3 (`44`) as the "cloud voice" release (`41` §7). **Cloud, opt-in, off by default.**
>
> **One line:** add `OpenAiTtsProvider` behind the `TextToSpeechProvider` seam (`33` §3) and
> **build the missing `audio:playBytes` path** (`33` §3.1) so cloud audio bytes can play in the
> hidden audio window — bytes not paths, blob: not remote, key in main. Plus the **voice
> catalog** (friendly labels → provider voice ids, `35` §2.1), **Preview / "Play Sample"**, and
> **rate control**, with the dead `voiceId`/`rate` plumbing finally threaded through
> `trigger-sink.ts → speak()` (`30` §3.2). Off ⇒ Windows voices.
>
> `NOTE` — The **full Voice-picker Settings UX is consolidated in EP-8** (`49`). EP-4 adds the
> *functional* voice section + Preview + the playback path — enough to hear a chosen voice
> end-to-end, not the final polished screen.
>
> **Authority:** `41` (build order), `33` §3 (the seam + `audio:playBytes`), `35` (voice
> internals), `32` (network/consent), `30` (audit). Order conflicts → `41` wins; architecture
> conflicts → the cited doc wins.

---

## Objective

Give Yogi a natural, user-chosen speaking voice. Concretely: (1) build the **new
`audio:playBytes` path** — the single missing structural piece the audit named (`30` §11.2, §3.2
D8): main fetches audio bytes with the key, sends `{mime, bytes}` to the hidden audio window,
which turns them into a `blob:` object URL and plays via `<audio>` — **never a path or remote
URL**, size-capped ≤ 2 MB (`33` §3.1). (2) Add `OpenAiTtsProvider` (`kind:'audio-bytes'`) behind
the `TextToSpeechProvider` seam, with Windows (`WebSpeechTtsProvider`, `kind:'in-window'`) as the
always-present fallback. (3) Ship the **voice catalog** (friendly labels → provider voice ids,
`35` §2.1), **Preview** speaking "This is Yogi. Nice to meet you." through the active
provider+voice+rate, and a **rate slider**. (4) Thread the resolved `voiceId`/`rate` through
`trigger-sink.ts → tts:speak → speak()` (fix the dead plumbing, `30` §3.2, `35` §5). Fallback
chain **OpenAI → Windows → silent**, with the notification always first. Guarded by
`tts_provider='openai'` + a new TTS consent ("the text Yogi speaks is sent to OpenAI"). Off ⇒
Windows.

User-visible win: **reminders spoken in a natural voice you chose** (`41` §9).

## Why this phase exists

`33` §3 / `30` §11.2 identified the hardest single friction of the OpenAI migration: the hidden
audio window plays audio by a **filename key** resolved against a hardcoded map and *deliberately
refuses paths/URLs* (`audio-host.ts:73`), while OpenAI TTS returns **audio bytes** — and **there
is no IPC channel to hand a buffer to the audio window**. EP-4 builds exactly that one new,
carefully-scoped capability (`33` §3.1) — small, security-preserving, and it unblocks *every*
cloud TTS provider at once. Alongside it, `35` closes two more audit findings: `speak()` accepts
`voiceId` but ignores it (destructures `{text, rate}` only, `audio-host.ts:89`), and
`trigger-sink.ts` sends `{text}` only — so voice/rate are **dead plumbing on both ends today**;
and `tts_voice_id`/`tts_rate`/`tts_degraded` are **orphaned settings read by nobody** (`30`
§3.2). EP-4 wires all of it. It depends on EP-3 only for the audio-bytes groundwork and the EP-1
key mechanism (`41` §6) — no forward dependency.

## Current code that will be reused

| Code | Path | Role in EP-4 |
| --- | --- | --- |
| Hidden audio window | `src/audio-host.ts` | Gains `audio:playBytes` → Blob → objectURL → `<audio>`; `speak()` starts honouring `voiceId`; the `[SPIKE-3]` diagnostics get stripped (`30` D9) |
| `voicesReady()` | `src/audio-host.ts:30` | The `voiceschanged` pattern (`07` §2.3) — reused to enumerate OS voices for the Windows catalog (`35` §3) |
| `tts:speak` path | `trigger-sink.ts` → `window.lifeosAudio.onSpeak` | Kept; now carries `{text, voiceId, rate}` instead of `{text}` (`35` §5, §9) |
| Trigger fan-out `safely()` | `electron/scheduler/trigger-sink.ts` | Notification + history unconditional-and-first; TTS is best-effort and individually wrapped (`30` §2.4, §13.4) — unchanged, TTS still cannot break a fire |
| Audio-window self-heal | `electron/main/windows.ts` | Recreate-with-cap then degrade to notify-only (`30` §2) — unchanged |
| EP-1 provider factory + `withFallback` | `electron/providers/registry.ts` | `makeTtsProvider(settings)` (`33` §5); EP-4 fills its cloud branch |
| EP-1 key mechanism + `cloudEnabled()` | `safeStorage`, `session.ts` | Key read in main for the OpenAI POST; `tts_provider==='openai'` is one predicate that opens `api.openai.com` (`32` §3.1) |
| CSP `buildCsp` | `electron/main/session.ts` | **CORRECTION (found in EP-4 testing):** the object URL is same-origin but `media-src` did NOT allow `blob:` (dev had no `media-src`, packaged was `media-src 'self'`). A one-line `media-src 'self' blob:` was added to both branches — the `<audio src="blob:…">` was CSP-blocked otherwise. `worker-src 'self' blob:` (AudioWorklet) was already present. |

## Code that must be refactored

1. **`audio-host.ts speak()` must honour `voiceId`** (`35` §5, `30` §3.2). Today
   `onSpeak(({ text, rate }) => void speak(text, rate))` drops `voiceId` (`audio-host.ts:89`) and
   `speak()` picks `voices.find(v => v.lang.startsWith('en')) ?? voices[0]` (line 58). Change to
   `onSpeak(({ text, voiceId, rate }) => speak(text, {voiceId, rate}))` and inside `speak()`:
   `voices.find(v => v.voiceURI === voiceId) ?? <en fallback chain>`.
2. **`trigger-sink.ts` must send the resolved voice/rate** (`35` §5). Was
   `send('tts:speak', { text: r.title })`; becomes
   `send('tts:speak', { text: r.title, voiceId: settings.get('tts_voice_id') || undefined,
   rate: Number(settings.get('tts_rate')) || 1.0 })` — the orphan settings, now read.
3. **Route TTS through `makeTtsProvider`** so the scheduler/engine asks the factory for "the TTS
   provider" and branches on `provider.kind` (`33` §3 diagram): `in-window` → existing
   `tts:speak`; `audio-bytes` → `await provider.speak()` in **main** → `audio:playBytes`.
4. **Wire the previously-dead `audio:error`** as `audio:playbackError` (`30` §3.2 D8, `33` §3.1):
   `audio-host` sends it on playback failure; **add the missing `ipcMain.on` handler** (today the
   report is silently lost) so the coordinator can degrade + set `tts_degraded`.
5. **Strip SPIKE-3 diagnostics** from `audio-host.ts` (the `[SPIKE-3]` `console.log`s / emoji,
   `30` D9) now that the window ships as product.

## Files expected to change

| File | Change |
| --- | --- |
| `core/tts/voice-catalog.ts` | **NEW** — `FriendlyVoice[]` friendly→OpenAI id + `windowsMatch` (`35` §1, §2.1) |
| `electron/providers/openai-tts-provider.ts` | **NEW** — `OpenAiTtsProvider` (`kind:'audio-bytes'`): POST `/v1/audio/speech`, return `{mime, bytes}` |
| `electron/providers/web-speech-tts-provider.ts` | **Extend (created in EP-1)** — `WebSpeechTtsProvider` (`kind:'in-window'`), now honouring `voiceId`/`rate` on the `tts:speak` path |
| `electron/providers/registry.ts` | `makeTtsProvider` cloud branch + always-Windows fallback (`withFallback`) |
| `src/audio-host.ts` | Add `audio:playBytes` handler (Blob→objectURL→`<audio>`); honour `voiceId`; send `audio:playbackError`; strip SPIKE logs |
| `electron/scheduler/trigger-sink.ts` | Send `{text, voiceId, rate}`; branch on `provider.kind` (audio-bytes → main POST → playBytes) |
| `electron/main/ipc/audio.ts` (or windows bridge) | **NEW/edit** — `audio:playBytes` send channel; `audio:playbackError` `ipcMain.on` handler; `tts:preview`, `tts:listVoices` |
| `electron/preload/audio-preload.ts` | Expose `onPlayBytes`; keep receive-mostly (`16` §7) |
| `core/types/channels.ts` | Add `AUDIO_PLAY_BYTES`, `AUDIO_PLAYBACK_ERROR`, `TTS_PREVIEW`, `TTS_LIST_VOICES`; `tts:speak` payload gains `voiceId/rate` |
| `src/features/settings/VoiceSection.tsx` | **NEW (functional)** — friendly voice dropdown, rate slider, Preview button; full UX polish deferred to EP-8 |
| `electron/database/settings-repository.ts` | Typed accessors; `tts_voice`, `tts_provider` seeded; orphans now read/written |
| `tests/tts/*` | **NEW** — voice-catalog round-trip, unknown-id→`alloy`, size-cap, fallback |

## New folders

- `core/tts/` — for `voice-catalog.ts` (interface + defaults; framework-free, ESLint-walled).
- `electron/providers/` (from EP-1) gains the two TTS provider files.

No other new folders.

## New services

- **`OpenAiTtsProvider`** (`electron/providers/openai-tts-provider.ts`) — `TextToSpeechProvider`,
  `id:'openai'`, `isOffline:false`, `kind:'audio-bytes'`. `listVoices()` returns the fixed named
  set (`35` §2); `speak(text, {voiceId, rate})` POSTs to `/v1/audio/speech` (`gpt-4o-mini-tts`)
  **in main** with the key, returns `{ kind:'audio-bytes', mime:'audio/mpeg', bytes }`
  (`33` §3). 10 s timeout (`32` §5). Unknown/rejected voice id → `alloy`, never hard-fail
  (`35` §2).
- **`WebSpeechTtsProvider`** (`electron/providers/web-speech-tts-provider.ts`) — **created in
  EP-1; extended here**, not new. `id:'web-speech'`, `isOffline:true`, `kind:'in-window'`.
  `speak()` returns `{ kind:'in-window' }` and drives the `tts:speak` path (now carrying
  `voiceId`/`rate`, `33` §3.1); `listVoices()` round-trips `tts:listVoices` to the audio window
  (`35` §3).
- **Playback coordinator** (small, in main, part of `trigger-sink`/audio bridge) — branches on
  `provider.kind`, handles `audio:playbackError` → `withFallback` → set `tts_degraded` → one
  non-modal notice (`33` §3.2).

## IPC changes

Per `35` §9 / `33` §3.1 — renderer-facing channels through `guard()`; the audio-window bridge
stays receive-mostly (`16` §7):

| Channel | Kind | Payload | Purpose |
| --- | --- | --- | --- |
| `audio:playBytes` | send (main → audio) | `{ mime, bytes: ArrayBuffer }` | **NEW** — play a size-capped (≤ 2 MB) transferable buffer as `blob:`; **never a path** (`33` §3.1) |
| `audio:playbackError` | send (audio → main) | `{ code, detail? }` | **NEW handler** — wire the dead `audio:error` (`30` D8); coordinator degrades |
| `tts:speak` | send (main → audio) | `{ text, voiceId, rate }` | Now carries `voiceId`/`rate` (was `{text}`) (`35` §9) |
| `tts:preview` | invoke | `{}` → `void` | Speak the sample via active provider+voice+rate; debounced (`35` §4) |
| `tts:listVoices` | invoke | `{}` → `TtsVoice[]` | Main ← audio-window OS voice list for the Windows picker (`35` §3) |

`MVP DECISION` — `audio:playBytes` is the **only** structural change the audio window needs
(`33` §3.1). The bytes are a transferable `ArrayBuffer`, size-capped in main *before* send; the
window rejects anything over the cap and reports `audio:playbackError`.

## Database changes

No table/migration change; all in `settings` (`35` §8):

| Setting | Change | EP-4 role |
| --- | --- | --- |
| `tts_provider` | **new** (`33` §7) | `'web-speech' \| 'openai'`; factory reads it |
| `tts_voice` | **new** | friendly `key` (e.g. `warm_female`); default `calm`; survives provider switch (`35` §1) |
| `tts_voice_id` | orphan → **now read/written** | resolved provider voice id (`nova` for OpenAI, a Windows `voiceURI` offline) — the value `trigger-sink`/`speak()` consume |
| `tts_rate` | orphan → **now read/written** | number as string; default `'1.0'`; clamped per provider (`35` §6) |
| `tts_degraded` | orphan → **now set** on fallback | drives the one-time "using your Windows voice" notice (`33` §3.2) |
| `tts_consented_at` | **new** (`32` §3) | presence = TTS consent accepted; absence ⇒ Windows |

`MVP DECISION` — persist **two** things (`35` §1): `tts_voice` (friendly key, survives a switch)
and `tts_voice_id` (resolved id for the *current* provider, recomputed on provider/voice change).
"Warm Female" = `nova` on OpenAI and (say) "Microsoft Zira" offline — one personality, resolved
per provider.

## UI changes

- **Functional Voice section** (`35` §10; full polish → EP-8 / `49`): friendly voice dropdown
  (grouped Online/Offline by active provider), **rate slider** (single "Slow ─●─ Fast", drives
  both providers, each clamps to its own range, `35` §6), **Preview / "Play Sample"** button.
- **Preview** speaks the fixed line "This is Yogi. Nice to meet you." through the
  currently-selected provider+voice+rate (`35` §4), so the user hears exactly what reminders will
  sound like. For OpenAI it shows a subtle **"uses your OpenAI key"** hint and is **debounced**
  (one in-flight at a time) so mashing it cannot rack up cost (`35` §4).
- **Disabled/explained states** (`35` §7): OpenAI selected but no key/consent → Preview says "Add
  an OpenAI key in Settings to use online voices."; zero OS voices installed (Windows path) →
  Preview + picker disabled with a link to Windows Speech settings; reminders still notify.
- **TTS consent modal** (first enable): "The text Yogi speaks is sent to OpenAI to generate the
  voice." (`32` §2). Declining leaves `tts_provider='web-speech'`.

## Main process changes

- `makeTtsProvider(settings)` returns `withFallback(primary, ()=>new WebSpeechTtsProvider())`;
  `primary` is OpenAI **iff** `tts_provider==='openai' && hasApiKey() && ttsConsented()`, else
  Windows (`33` §5). Re-run on `settings:changed` (live rebind).
- **Speech-emitting sites branch on `provider.kind`** (`33` §3 diagram): `in-window` →
  `send('tts:speak', {text, voiceId, rate})`; `audio-bytes` → `bytes = await provider.speak(...)`
  in main (network, key stays) → `send('audio:playBytes', {mime, bytes})`. This is true for both
  **reminder fire** (`trigger-sink`) and **Preview** (`tts:preview`) — Preview is a genuine
  end-to-end test of the real speaking path, not a mock (`35` §4).
- **The OpenAI POST happens in main**; key read at call time, dropped; 10 s timeout; response
  bytes size-checked ≤ 2 MB before `audio:playBytes` (`32` §3.3, `33` §3.1).
- `audio:playbackError` handler degrades: `withFallback` → Windows → set `tts_degraded=true` →
  one non-modal notice; **notification already fired first** (`33` §3.2, `30` §13.4).

## Renderer changes

- **Audio window** (`audio-host.ts`): add `onPlayBytes(({mime, bytes}) => …)` →
  `new Blob([bytes], {type:mime})` → `URL.createObjectURL` → `<audio>.play()`; revoke the object
  URL on `ended`/`error`; on failure `window.lifeosAudio.report({code:'playback_error', …})` →
  `audio:playbackError`. `speak()` now honours `voiceId`. Strip `[SPIKE-3]` logs.
- **Settings renderer**: the functional Voice section (dropdown + slider + Preview) with the
  disabled/explained states and the cost hint; consent modal wiring.
- No conversation UI change (that is EP-2/EP-5); EP-4 is a Settings + speaking-path phase.

## Provider changes

- **`TextToSpeechProvider` gains both real implementations** (`33` §3): `WebSpeechTtsProvider`
  (offline, in-window, the mandatory fallback) and `OpenAiTtsProvider` (cloud, audio-bytes). The
  `kind` field decides the playback path; nothing above the seam knows which engine speaks
  (`33` §8).
- **Fallback is mandatory, never fatal** (`33` §3.2, `07` §5): `OpenAI → Windows → silent`; a
  silent reminder is still a working reminder because notification + history fired first
  (`30` §13.4, `35` §7).
- **Voice catalog** is data-driven and runtime-validated (`35` §2): unknown/renamed OpenAI id →
  `alloy`, never hard-fail — OpenAI adds/renames voices without an app release.
- `FUTURE OPTION` — ElevenLabs / other `audio-bytes` providers drop in behind the same interface
  and reuse `audio:playBytes` unchanged (`33` §3).

## Security considerations

- **Key in main only / never crosses IPC.** The OpenAI `/audio/speech` POST is built and sent in
  main; the key is read at call time, set on `Authorization`, dropped — never logged, never in an
  error, never in `app_logs` (`sk-` redaction stays) (`32` §3.3, `41` §8.4). A renderer never sees
  the key or makes the call.
- **Bytes-not-paths.** `audio:playBytes` carries `{mime, bytes}` only; the audio window turns
  bytes into a **same-origin `blob:` object URL**, never accepts a path or remote URL — preserving
  the `16` §7 / `audio-host.ts:73` no-path rule that made the filename-key design safe (`33` §3.1).
  The `<audio>` src is a same-origin `blob:` object URL. **CORRECTION (EP-4 testing):** `media-src`
  needed `blob:` added (it was `'self'` only / absent in dev) — a one-line, same-origin-only change,
  not a broad loosening; no remote origin is permitted.
- **Size cap.** Every buffer is capped ≤ 2 MB per utterance in main *before* send (`33` §3.1);
  the window rejects oversize and reports `audio:playbackError`. Bounds a memory-exhaustion vector
  on the one channel that allocates.
- **Wireshark off→zero, on→openai-only.** With `tts_provider!=='openai'` (or no key/consent) the
  allowlist is empty → **zero outbound packets** (SEC-10, `41` §8.2). With TTS-cloud on + keyed +
  consented → traffic to **`api.openai.com` only** (`32` §3.2).
- **No audio on disk.** Cloud TTS bytes live in main memory → transferred → played as `blob:` →
  object URL revoked. No temp file, no cache, on any path (`32` §7).
- **Consent per-feature.** Enabling TTS sends only the *text Yogi speaks* (a reminder title or
  reply), not the mic and not chat history (`32` §2). Preview is debounced to bound cost.

## Performance considerations

- **`audio:playBytes` is a transfer, not a copy path.** The `ArrayBuffer` is transferable; the
  window wraps it in a Blob (zero-copy) → object URL. Playback latency ≈ network fetch (main) +
  decode, typically <1 s for a short title.
- **Preview debounced** (one in-flight) so rapid clicks issue at most one API call (`35` §4, §13)
  — bounds both cost and audio-window load.
- **Windows path unchanged** — `speechSynthesis.speak` in the hidden window; `voicesReady()`
  warmed at startup so the first reminder doesn't discover an empty `getVoices()`
  (`audio-host.ts:96`). Audio-window throttling (`07` SPIKE-3) mitigated by notify-first
  (`35` §14).
- **Object URL lifecycle**: revoke on `ended`/`error` so blobs don't accumulate; 20 previews in a
  row hold stable renderer memory.
- 10 s TTS timeout (`32` §5) bounds the worst case; exceed → abort → Windows fallback.

## Risks

- `RISK` — **Voice character/branding drift** on OpenAI's side; the newer voices (`ash`, `ballad`,
  `coral`, `sage`, `verse`) may be renamed/re-charactered (`35` §2, ASSUMPTION). *Mitigation:*
  data-driven catalog, runtime validation, `alloy` fallback, ids overridable via settings, no
  hard-fail on an unrecognised id.
- `RISK` — **Cost from Preview / verbose reminders on OpenAI TTS** (pricier than chat, `32` §1).
  *Mitigation:* debounce, per-Preview "uses your key" hint, local monthly estimate (`32` §6),
  Windows remains the zero-cost default.
- `RISK` — **Audio-window death mid-playback.** *Mitigation:* `windows.ts` self-heal (recreate
  with cap → notify-only); `audio:playbackError` degrades to Windows; notification already fired
  (`30` §2, `35` §7).
- `RISK (low)` — **`blob:` playback blocked / oversize buffer.** *Mitigation:* size cap rejects
  before send; autoplay switch is appended before any window exists (`audio-host.ts:83`); failure
  → `audio:playbackError` → Windows fallback.
- `RISK` — **Reminder-first "nothing uploaded" copy** in ≥3 UI places (`30` §3.1). *Mitigation:*
  content audit; TTS consent states the text is sent.

## Rollback strategy

`MVP DECISION` — **A single setting reverts everything** (`35` §15, `41` §10). Set
`tts_provider='web-speech'` (or clear key / withdraw consent) → reminders speak in the offline OS
voice, the `audio:playBytes` path is simply never reached (it's only for `kind:'audio-bytes'`),
the allowlist empties, Wireshark shows zero. `withFallback` auto-degrades a *runtime* OpenAI
failure to Windows without user action (`33` §3.2). If the voice picker itself regresses, hide the
Voice section and fall back to the default voice — reminders still speak (`35` §15). No code
revert needed to ship v0.4 with cloud TTS disabled.

## Definition of Done

Re-asserts the `41` §8 invariants, plus EP-4 specifics (mirrors `35` §16):

1. **Full reminder loop works offline, no key** — create → confirm → schedule → notify + **speak
   (Windows voice)** (`41` §8.1).
2. **Zero outbound packets with TTS-cloud off** (Wireshark, SEC-10) (`41` §8.2).
3. **The confirmation gate holds** — TTS is output only; nothing about speaking persists a
   consequential change (`41` §8.3). The safe-settings carve-out (voice/rate) may apply
   optimistically with Undo (`30` §13.1) — it can never reach keys/consent/provider.
4. **The API key never crosses IPC**; the `/audio/speech` POST happens in main (`41` §8.4).
5. **Notification + history fire unconditionally and first**; speech is best-effort (`41` §8.6,
   `33` §3.2).
6. **No `child_process`/`eval`/dynamic import** added; the OpenAI provider uses `fetch` only
   (`41` §8.7). The one allowlisted TTS file (`sapi-tts-service.ts`) is untouched.
7. Friendly voices map to OpenAI ids and Windows voices; the selection persists as `tts_voice` +
   resolved `tts_voice_id` and **survives a provider switch** (`35` §16).
8. **Preview works for both providers via the real speaking path**; disabled states explained
   (`35` §16).
9. **Reminders speak in the chosen voice + rate** — the dead `voiceId`/`rate` plumbing is fixed
   (`30` §3.2, `35` §5).
10. **`audio:playBytes` is bytes-not-paths, blob: not remote, size-capped**; `audio:playbackError`
    is wired (D8 closed) (`33` §3.1).
11. **Fallback OpenAI → Windows → silent** works; `tts_degraded` is set; a reminder always at
    least notifies (`35` §16, §7).
12. On + keyed + consented ⇒ traffic to `api.openai.com` **only**; TTS consent shown before first
    use and revocable (`32` §8).
13. **96 tests green** (`30` §10) + new voice-catalog/size-cap/fallback unit tests; the `53`
    regression suite green (`41` §11).

## Feature Checklist

### Already completed (pre-EP-4, reused)
- Hidden audio window with `speechSynthesis` + `<audio>`; `voicesReady()` `voiceschanged` pattern.
- `tts:speak` path + trigger fan-out `safely()` (notification/history first, TTS best-effort).
- Audio-window self-heal (recreate-with-cap → notify-only).
- EP-1: provider factory + `withFallback`, key mechanism, `cloudEnabled()` predicate (D1 fix).
- EP-3: the audio-bytes groundwork + established cloud key/consent pattern (`41` §6).

### New work (EP-4)
- `audio:playBytes` path (Blob → objectURL → `<audio>`; size-capped; blob: not path).
- `audio:playbackError` handler (D8 wired); degrade + `tts_degraded`.
- `OpenAiTtsProvider` (`/audio/speech`, audio-bytes) + `WebSpeechTtsProvider` (in-window).
- Voice catalog (friendly→OpenAI id + `windowsMatch`); unknown id → `alloy`.
- Preview ("This is Yogi. Nice to meet you.") for both providers; debounced; cost hint.
- Rate slider (clamped per provider); thread `voiceId`/`rate` through `trigger-sink → speak()`.
- `tts_provider`, `tts_voice`, `tts_consented_at`; orphans `tts_voice_id`/`tts_rate`/`tts_degraded`
  now read/written/set.
- TTS consent modal; conditional "nothing uploaded" copy.

### Deferred work (later EPs)
- **Full Voice-picker Settings UX** (polished layout, grouping, privacy copy) → **EP-8** (`49`)
  — this phase adds only the functional section + Preview + playback path (per the brief NOTE).
- Consent-management + cost-dashboard consolidation → **EP-8** (`49`).
- Spoken *LLM replies* (not just reminder titles) → after **EP-5** (`46`).

### Future work (post-1.0)
- `FUTURE OPTION` ElevenLabs / other `audio-bytes` TTS providers behind the same seam.
- SAPI (`electron/tts/sapi-tts-service.ts`) as an alternate offline path if web-speech regresses.

## Manual Testing

(Mirrors `35` §12, grounded in EP-4's paths.)

| # | Step / Action | Expected Result |
| --- | --- | --- |
| 1 | Fresh install, no key. Create a 1-min reminder; wait for fire. | Notification first; then spoken in the **Windows** voice. No network. |
| 2 | Add key, enable OpenAI TTS. | TTS consent modal: "The text Yogi speaks is sent to OpenAI…" Must accept. |
| 3 | Settings → Voice: pick "Warm Female" → Preview. | Hear "This is Yogi. Nice to meet you." in the `nova` voice; subtle "uses your OpenAI key" hint. |
| 4 | Drag rate to Fast → Preview. | Same voice, faster. |
| 5 | Create a 1-min reminder (OpenAI TTS on). | At fire: notification first, then the title spoken in the chosen voice + rate via `audio:playBytes` (not the old default). |
| 6 | Switch TTS → Windows; Preview + a reminder. | An offline OS voice; **no network**. |
| 7 | Remove the key, keep TTS = OpenAI. | Preview explains it needs a key; reminders speak Windows voice; one-time "using Windows voice" notice; `tts_degraded` set. |
| 8 | VM with **zero** OS voices, TTS = Windows. | Voice picker + Preview disabled with a link to Windows speech settings; reminders still **notify** (silent). |
| 9 | Mash Preview 5× fast (OpenAI). | Debounced — at most one plays; no cost spike. |
| 10 | Wireshark: TTS-cloud off 30 min. | Zero outbound packets. TTS-cloud on → `api.openai.com` only. |
| 11 | After an OpenAI reminder, check disk/temp. | No audio artifact — bytes were in memory, played as blob:, revoked. |

## Edge Cases

(`35` §13.) Unknown/renamed OpenAI voice id → `alloy`; OS voice uninstalled after selection →
`windowsMatch` fallback chain (en-* → `voices[0]`); **oversized audio buffer** (>2 MB) → main
rejects before send → `audio:playbackError` → Windows fallback; rate out of range → clamped per
provider; audio window recreated mid-preview → Preview reports error, offers retry; provider
switched while a preview/utterance is in flight → in-flight cancelled/completes on its original
provider; friendly key persists across a provider switch (`tts_voice` stable, `tts_voice_id`
recomputed); reminder title empty/very long → title still spoken (or notify-only if empty).

## Failure Cases

Per `32` §5 / `33` §3.2 — each degrades, never fatal, notification always first:

- **No network / offline**: OpenAI skipped; Windows voice; toast "needs a connection".
- **401 invalid key**: Windows voice; Settings banner "key was rejected"; cloud TTS disabled this
  session.
- **429 / 5xx**: one retry w/ backoff → Windows fallback; `tts_degraded` set; one notice.
- **Timeout (>10 s)**: abort → Windows voice.
- **`audio:playBytes` playback fails** (blob/decode/autoplay): `audio:playbackError` → Windows
  fallback → notice; the notification already fired.
- **Oversize response** (>2 MB): rejected in main → Windows fallback.
- **Audio window dead**: recreate-with-cap → else notify-only (`30` §2).
- **`safeStorage` unavailable**: key never persisted → cloud TTS unavailable → Windows.

## Recovery Tests

1. Kill network with OpenAI TTS on → reminder speaks in Windows voice + one notice; restore
   network → next reminder speaks in the OpenAI voice again (live rebind); `tts_degraded` clears
   on next success.
2. Bad key → 401 banner + Windows fallback; good key → OpenAI TTS resumes without restart.
3. Force a playback error (kill audio window during play) → `audio:playbackError` → Windows
   fallback → recreate; next reminder speaks normally.
4. Toggle TTS provider off→on→off rapidly → factory rebinds; final state's provider speaks the
   next reminder; allowlist matches final state.
5. Select an OpenAI voice, switch to Windows, switch back → `tts_voice` preserved, `tts_voice_id`
   re-resolved to the OpenAI id; correct voice both times.
6. Oversize buffer once → rejected + fallback; a normal-size next utterance plays fine (no stuck
   state, object URLs revoked).

## Regression Tests

Per `41` §11 / `53`, MUST stay green in EP-4:

- **Windows voice still works** — offline `speechSynthesis` path, `voicesReady()`, notify-first,
  with cloud off (`audio-host.ts` path intact + now honouring `voiceId`).
- **Sherpa STT still works with cloud off** — EP-3's STT unaffected by EP-4 (different seam).
- **Full offline reminder loop intact** — create → confirm → schedule → notify + speak, no key
  (`41` §8.1).
- **Confirmation gate holds** — TTS is output only; the safe-settings carve-out (voice/rate +
  Undo) never reaches keys/consent/provider (`30` §13.1).
- **96 tests green** — parser/scheduler/DB suites unbroken; threading `voiceId`/`rate` and adding
  `audio:playBytes` breaks no existing test (`30` §10).
- **Wireshark off→zero** re-verified (SEC-10) with the OpenAI TTS provider present but disabled.
- **Trigger fan-out order** — notification + history still unconditional-and-first; TTS
  best-effort and individually `safely()`-wrapped (`30` §2.4, §13.4).

## Performance Tests

1. **Playback latency**: OpenAI reminder → spoken within ~1 s of fire over a normal connection;
   never blocks the notification (which is first).
2. **Object-URL lifecycle**: 20 previews / reminders → renderer memory stable; blobs revoked on
   `ended`/`error` (heap snapshot).
3. **`audio:playBytes` transfer**: a 2 MB buffer transfers + plays without main-thread stall
   (transferable, zero-copy Blob).
4. **Preview debounce**: 10 rapid clicks issue ≤1 network call.
5. **Windows path**: `voicesReady()` warmed at startup; first reminder speaks without an empty
   `getVoices()` stall; audio-window throttling mitigated by notify-first.
6. **Fallback cost**: an OpenAI failure falls to Windows within the 10 s timeout, no runaway
   retries.

## Expected App Behaviour

```text
Current (v0.3, offline):
  reminder fires → notification (first) → tts:speak {text} → hidden window → speechSynthesis
                   (default en voice; voiceId/rate DROPPED — dead plumbing, 30 §3.2)

EP-4 (v0.4, TTS-cloud opt-in):
  TTS-cloud OFF → notification first → tts:speak {text, voiceId, rate} → Windows voice
                  (now HONOURING the chosen voice + rate) → zero network
  TTS-cloud ON  → notification first → provider.speak() in MAIN (key stays) → audio:playBytes
                  {mime, bytes} → hidden window → Blob → blob: objectURL → <audio> → natural voice
  any OpenAI/playback failure → withFallback → Windows → (else silent); notification ALWAYS first
  Preview exercises the SAME path end-to-end — hear the exact reminder voice before it fires (35 §4)
```

## Conversation Testing

EP-4 predates the LLM (EP-5, `46`); non-reminder input shows the honest placeholder (`41` §9).
EP-4 changes only *how reminders sound*, not what Yogi can discuss:

- **User:** "remind me to call mom at 6pm" → confirm.
  **Expected:** reminder scheduled; at fire, notification first, then "Call mom" spoken in the
  chosen voice + rate (OpenAI if enabled, else Windows).
- **User:** "read that back to me" / "what can you do?"
  **Expected:** placeholder "Connect OpenAI in Settings to chat and answer questions" — EP-4 does
  **not** converse; no TTS of a non-existent reply (`41` §9).
- **User (Settings → Voice):** picks "Storyteller", Preview.
  **Expected:** hears "This is Yogi. Nice to meet you." in `fable`; the same voice will speak
  reminders.
- **User (TTS-cloud off):** same reminder.
  **Expected:** spoken in the chosen Windows voice; zero network; identical interaction.

## Voice Testing

Per `41` §11 / `53` voice suite, exercised for EP-4's TTS surface:

- **Mic unavailable**: irrelevant to TTS output — reminders still speak; STT (EP-3) degrades
  independently to typing. (TTS does not depend on the mic.)
- **Internet disconnected, TTS-cloud on**: OpenAI skipped → Windows voice → toast "needs a
  connection"; notification first regardless.
- **OpenAI unavailable (5xx/429)**: one retry → Windows fallback → `tts_degraded` + one notice.
- **Slow response** (near 10 s): Preview/reminder waits to the timeout, then Windows fallback; the
  notification already fired so the reminder is never late because of TTS.
- **Large pause / long title**: a long reminder title is still spoken (bounded by the 2 MB cap; if
  synthesis would exceed it, reject → Windows fallback which has no such cap).
- **Interrupt**: a new reminder mid-speech → `speechSynthesis.cancel()` (in-window) or pause the
  `<audio>` and play the new blob (audio-bytes) — latest reminder wins; no overlap.
- **"stop" / "cancel" / "repeat" spoken**: EP-4 has no voice-command layer (that is EP-7,
  `48`) — these are not TTS triggers here. "repeat"-style replay is a Preview/EP-7 concern; EP-4
  only guarantees each reminder speaks once at fire. No accidental action (gate holds).
- **Provider switching** (Windows↔OpenAI mid-use): live rebind; the next reminder/Preview uses the
  newly selected provider via the correct `kind` path; `tts_voice` preserved, `tts_voice_id`
  re-resolved; an in-flight utterance completes on its original provider; allowlist tracks the
  final state.
