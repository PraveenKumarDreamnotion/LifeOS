# 44 — Phase EP-3: OpenAI Speech-to-Text (batch)

> **Execution phase EP-3** of the eleven-phase plan (`41` §5). **Ships in v0.4** alongside
> EP-4 (`45`) as the "cloud voice" release (`41` §7). **Cloud, opt-in, off by default.**
>
> **One line:** add an OpenAI **batch** STT provider behind the `SpeechProvider` seam (`33`
> §2), with **sherpa always present as the fallback** via `withFallback` (`33` §5). With the
> flag off — or no key, or no consent — STT is exactly today's offline sherpa pipeline.
>
> **Authority:** `41` is the build-sequence authority; `33` owns the provider seam; `32` owns
> the OpenAI network/consent gating; `30` is the code audit this grounds in. Where this doc
> and an architecture doc disagree on *order*, `41` wins; on *architecture*, the cited doc wins.

---

## Objective

Introduce `OpenAiSpeechProvider` — a `transport:'batch'`, `supportsPartials:false`
implementation of `SpeechProvider` (`33` §2) — that buffers PCM16 frames **in main**, POSTs the
whole utterance once at `stop()` to `POST /v1/audio/transcriptions` (`gpt-4o-mini-transcribe`,
`32` §1), and returns the final transcript. It sits behind the EP-1 factory + `withFallback`
decorator (`33` §5) with **sherpa as the always-present backup**. The renderer's live-transcript
region (`useSpeech`) reads `supportsPartials` and adapts: for the batch provider it shows
"Transcribing…" then the final text lands (`33` §2.1). Guarded by a new `stt_provider='openai'`
flag **plus a new STT consent** ("your voice recording is sent to OpenAI", `32` §2). Off ⇒ sherpa.

The user-visible win: **dictate a reminder with much better accuracy** (`41` §9). The
interaction model is unchanged — this is the reminder app with a better ear, not a new paradigm.

## Why this phase exists

`41` §1 sequences voice I/O *before* the LLM because STT is self-contained, LLM-independent, and
lower-risk — it augments the working reminder app and exercises the EP-1 key mechanism with the
simplest possible OpenAI call. `30` §11.1 named the streaming-vs-batch contract mismatch as one
of the three hard frictions of the OpenAI migration: the whole pipeline is frame-by-frame
streaming with live `onPartial`, but OpenAI `/audio/transcriptions` is **batch** (buffer whole
utterance → one POST → final text, no partials). `33` §2 resolves it by making partials
*optional* on the interface and having the UI read `supportsPartials`. EP-3 is where that
resolution becomes running code — the smallest honest cloud increment, and the one that first
opens the network surface for *speech* (not just chat), which is why it also carries the new,
explicit STT consent that reverses `09`'s "Audio, ever" rule (`32` §2, `30` §11.3).

`MVP DECISION` — EP-3 ships **batch only**. OpenAI **Realtime** (WebSocket, live network
partials) is a `FUTURE OPTION` (`33` §2.1, `32` §3.2) — it needs `connect-src wss://api.openai.com`
and a persistent socket; batch ships first because it reuses the existing frame→buffer plumbing
with no new transport.

## Current code that will be reused

Reused as-is or lightly adapted (the `30` §13 "do not lose these" set):

| Code | Path | Role in EP-3 |
| --- | --- | --- |
| `SherpaSpeechService` | `electron/speech/sherpa-speech-service.ts` | Becomes the concrete `SherpaSpeechProvider` (adapter) **and the mandatory fallback**; its `start/pushAudio/stop` surface is the de-facto interface EP-1 extracted (`33` §2, `30` §5) |
| Renderer capture pipe | `src/hooks/useSpeech.ts` | getUserMedia → AudioWorklet (48k→16k PCM16) → `pushAudio`; the 2 s silence auto-stop + 30 s hard cap (`SILENCE_STOP_MS`, `HARD_CAP_MS`) still bound how much audio can be captured/sent (`33` §2.2) |
| PCM16 downsampler worklet | `src/worklets/pcm16-downsampler.js` | Unchanged; still emits the same Int16 frames both providers consume |
| Speech IPC (post-EP-1) | `electron/main/ipc/speech.ts` | `SPEECH_START/STOP/AUDIO`, the 3-guard `SPEECH_AUDIO` handler, `MAX_FRAME_BYTES`; provider is swapped behind these channels, contract unchanged |
| `MicButton` + `useSpeech` states | `src/features/chat/MicButton.tsx` | `idle/listening/processing` states drive the UI; `processing` is where "Transcribing…" shows for batch |
| EP-1 provider factory + `withFallback` | `electron/providers/registry.ts` | `makeSpeechProvider(settings)` (`33` §5) — EP-3 fills its cloud branch |
| EP-1 key mechanism | `safeStorage` + `settings:setApiKey/clearApiKey/validateApiKey` (`32` §3.3) | Read the key in main at call time; never crosses IPC |
| Network gating seam | `electron/main/session.ts` (`isAllowedOrigin`, `buildCsp`, live `cloudEnabled()` predicate) | EP-1 fixed D1; EP-3 makes `stt_provider==='openai'` one of the predicates that opens `api.openai.com` (`32` §3.1) |

## Code that must be refactored

`MVP DECISION` — Most of the refactor is **EP-1's** job (`41` §4.2); EP-3 consumes clean seams
and adds the cloud provider. The EP-3-specific refactors:

1. **`SherpaSpeechService` → `SherpaSpeechProvider`.** Wrap (do not rewrite) the existing class
   behind `SpeechProvider` with `id:'sherpa-onnx'`, `transport:'streaming'`, `supportsPartials:true`,
   `isOffline:true`. `stop()` already returns the final text (`sherpa-speech-service.ts:142`) —
   that becomes `SpeechFinalResult`. **Drop the dead `onFinal`** (`30` §3.2 D8, `33` §2): final
   text always came from `stop()`'s return; the broadcast `SPEECH_FINAL`/`onFinal` was never the
   real path (`speech.ts:54`, `useSpeech.ts:31` confirm). Strip the `[STT-DIAG]` counters in the
   hot path (`30` D9) — `dbgFrames/dbgSamples/dbgPeak` and the two `console.log`s.
2. **`speech.ts` provider indirection.** `registerSpeechHandlers` currently does
   `service = new SherpaSpeechService(...)` directly (`speech.ts:28`). Route it through
   `makeSpeechProvider(settings)` so `SPEECH_START` resolves the *active* provider (sherpa or
   OpenAI-batch behind fallback). Consolidate onto `guard()` (EP-1, `30` D4) so the two inline
   origin checks (`speech.ts:35,50`) and `String(e)` leak (`30` S4/D4) are gone.
3. **`useSpeech` reads `supportsPartials`.** Today it always renders the live `partial` strip
   (`useSpeech.ts:28,30`). Expose the active provider's `supportsPartials` to the renderer (a
   field on the `SPEECH_START` result) so the strip shows a spinner + "Transcribing…" for batch
   and live ticks for sherpa (`33` §2.1). No caller branches on a concrete class.

## Files expected to change

| File | Change |
| --- | --- |
| `electron/providers/openai-speech-provider.ts` | **NEW** — `OpenAiSpeechProvider` (batch): in-memory PCM buffer, POST at `stop()` |
| `electron/providers/sherpa-speech-provider.ts` | **NEW** — thin adapter wrapping `SherpaSpeechService` as `SpeechProvider` |
| `electron/providers/registry.ts` | `makeSpeechProvider` cloud branch: `stt_provider==='openai' && hasApiKey() && sttConsented()` → OpenAI, else sherpa; always `withFallback(primary, ()=>sherpa)` |
| `electron/speech/sherpa-speech-service.ts` | Strip `[STT-DIAG]` (D9); drop `onFinal` from `SpeechCallbacks` (D8) |
| `electron/main/ipc/speech.ts` | Route through the factory; onto `guard()`; drop `SPEECH_FINAL` broadcast |
| `src/hooks/useSpeech.ts` | Read `supportsPartials`; show "Transcribing…" when false; keep silence/cap timers |
| `src/features/chat/MicButton.tsx` | `processing` state copy: "Transcribing…" vs live partial |
| `core/types/channels.ts` | Remove dead `SPEECH_FINAL` (D8); no new channel needed |
| `electron/main/session.ts` | `cloudEnabled()` already includes `stt_provider==='openai'` (EP-1 wired `32` §3.1); verify |
| `src/features/settings/*` | Minimal STT provider toggle + consent modal trigger (full UX deferred to EP-8 / `49`) |
| `tests/providers/openai-speech-provider.test.ts` | **NEW** — buffer/POST/timeout/fallback unit tests |

## New folders

- `electron/providers/` — created in EP-1; EP-3 adds `openai-speech-provider.ts` and
  `sherpa-speech-provider.ts`. No other new folder.

## New services

- **`OpenAiSpeechProvider`** (`electron/providers/openai-speech-provider.ts`) — a
  `SpeechProvider` with `id:'openai'`, `transport:'batch'`, `supportsPartials:false`,
  `isOffline:false`. `pushAudio` **appends the frame to an in-memory buffer, emits nothing**
  (`33` §2.1). `stop()` concatenates the buffer to a single PCM16→WAV blob, POSTs it to
  `/v1/audio/transcriptions` with the key read in main, returns the final text, and **drops the
  buffer immediately** (`33` §2.2). 15 s timeout (`32` §5). No new long-lived service object —
  it is constructed per-session by the factory.
- **`SherpaSpeechProvider`** — the adapter over the existing `SherpaSpeechService`; not a new
  runtime capability, just the interface skin.

## IPC changes

`MVP DECISION` — **No new renderer-facing IPC channel.** The batch provider hides entirely
behind the existing `SPEECH_START/STOP/AUDIO` contract — the buffer-and-POST happens in main at
`stop()`, and `stop()` already returns the final text over `invoke`, which is exactly the batch
model's single result point.

| Channel | Kind | EP-3 change |
| --- | --- | --- |
| `speech:start` | invoke | Now resolves the *active* provider; return payload gains `supportsPartials: boolean` so the UI adapts |
| `speech:stop` | invoke | Unchanged shape `→ { text }`; for batch this is where the POST resolves |
| `speech:audio` | send | Unchanged; batch buffers, sherpa decodes; 3 guards + `MAX_FRAME_BYTES` intact |
| `speech:partial` | broadcast | Fires only when `supportsPartials` (sherpa); **never for batch** (`33` §2.1) |
| `speech:final` | broadcast | **Deleted** (D8) — final always via `stop()` return |

All speech handlers move onto `guard()` (EP-1, `30` D4). Key IPC (`settings:setApiKey/…`) is
EP-1's; EP-3 only *reads* the stored key, in main.

## Database changes

No table/migration change. Settings keys (`33` §7), all in the existing `settings` table:

| Setting | Status | EP-3 role |
| --- | --- | --- |
| `stt_provider` | exists (orphan → now read) | `'sherpa-onnx' \| 'openai'`; the factory reads it |
| `stt_consented_at` | **new** (`32` §3) | ISO timestamp; presence = STT consent accepted; absence ⇒ sherpa |
| `ai_key_ciphertext` | exists (EP-1 writes it) | read in main only; never crosses IPC |
| `stt_model` | exists (`32` §1) | `gpt-4o-mini-transcribe`, overridable without a release |
| `ai_last_used_at` (STT-scoped counter) | exists | "Last used" + local cost estimate (`32` §6) |

Add typed accessors (EP-1, `30` D6) so callers stop hand-parsing strings.

## UI changes

- **Transcript strip adapts to `supportsPartials`** (`33` §2.1): sherpa ticks live; OpenAI shows
  a spinner + "Transcribing…" during the `processing` state, then the final text lands in the
  composer. Same `MicButton`, same states.
- **STT consent modal** (first enable): the strong disclosure — *"Your voice recording is sent
  to OpenAI to transcribe."* (`32` §2, the sentence that reverses "Audio, ever"). The user must
  actively accept; declining leaves `stt_provider='sherpa-onnx'`.
- **A minimal Settings toggle** to pick OpenAI STT (functional only; the consolidated provider/
  privacy UX is EP-8 / `49`, `41` §5).
- **Reminder-first copy that asserts "audio never leaves the device"** (`30` §3.1, `App.tsx` rail
  chip / Speech section) is corrected to be conditional on the provider — a content audit, not
  just a form addition.

## Main process changes

- `makeSpeechProvider(settings)` returns `withFallback(primary, ()=>new SherpaSpeechProvider())`
  where `primary` is OpenAI **iff** `stt_provider==='openai' && hasApiKey() && sttConsented()`,
  else sherpa (`33` §5). Re-run on `settings:changed` (live rebind, same mechanism that fixed D1)
  so switching providers needs no restart.
- The **OpenAI POST happens in main** (`openai-speech-provider.ts`): reads the key at call time,
  sets `Authorization`, drops it; 15 s timeout; the buffer is bounded by the existing 30 s cap /
  2 s silence and **dropped post-request** (`33` §2.2).
- `session.ts` `cloudEnabled()` includes `stt_provider==='openai'` so `api.openai.com` is
  allowlisted only when STT-cloud is genuinely active (`32` §3.1); off ⇒ empty allowlist.

## Renderer changes

- `useSpeech` surfaces `supportsPartials` from the `speech:start` result and renders the
  "Transcribing…" affordance for batch. The silence/cap timers (`SILENCE_STOP_MS=2000`,
  `HARD_CAP_MS=30000`) are unchanged — they still bound the utterance for both providers.
- On a batch **mid-utterance failure**, the audio is gone and cannot be retroactively
  re-transcribed offline (`32` §5) — the composer stays unblocked and the user is asked to repeat
  or type. `useSpeech` never blocks the composer (`06`, `useSpeech.ts` teardown).

## Provider changes

- **`SpeechProvider` gains its second real implementation.** `SherpaSpeechProvider` (streaming,
  partials, offline) and `OpenAiSpeechProvider` (batch, no partials, cloud) both satisfy `33`
  §2's interface; nothing above the seam knows which is active (`33` §8).
- The **offline provider is always the backup** (`33` §5): cloud is *preferred when enabled +
  keyed + consented*, never the only path — the concrete encoding of offline-first (`30` §11.3,
  `32` §2).
- `FUTURE OPTION` — `OpenAiRealtimeSpeechProvider` (`transport:'streaming'`, `supportsPartials:true`,
  `wss://`) drops in behind the same interface later (`33` §2.1) with a CSP `connect-src wss://`
  entry; deferred past this cut.

## Security considerations

- **Key in main only / never crosses IPC.** The key lives in `safeStorage` (DPAPI); the POST is
  built in main, reads the key at call time into the `Authorization` header, and drops it — never
  logged, never in an error, never in `app_logs` (the `sk-` redaction in `logger.ts` stays as
  defence in depth) (`32` §3.3, `41` §8.4).
- **Bytes-not-paths.** STT sends *audio bytes* to OpenAI from main; nothing accepts a path/URL.
  (The bytes-not-paths playback rule is EP-4's concern; EP-3's audio never touches the audio
  window.)
- **Wireshark off→zero, on→openai-only.** With `stt_provider!=='openai'` (or no key/consent), the
  allowlist is empty and the 30-minute Wireshark test shows **zero outbound packets** (`11` §14
  SEC-10, `41` §8.2). With STT-cloud on + keyed + consented, traffic goes to **`api.openai.com`
  only** — no CDN, no telemetry (`32` §3.2).
- **No audio on disk.** The PCM buffer lives in **main memory only**, is POSTed once, and dropped
  immediately after `stop()` (`33` §2.2, `32` §7). No temp file, no cache, on any path. The 30 s
  cap / 2 s silence bound how much audio can ever exist in that buffer.
- **Consent is per-feature and explicit.** Enabling STT sends microphone audio; it does *not*
  enable chat or TTS (`32` §2, "consent is not transitive"). The disclosure names audio
  explicitly.

## Performance considerations

- **Batch adds network latency, not CPU.** `pushAudio` for batch is a cheap buffer append (no
  per-frame ONNX decode), so main-thread jank during capture is *lower* than sherpa (`30` §6).
  The cost moves to a single ≤30 s upload + transcription at `stop()`; the UI shows "Transcribing…"
  for that window (typically 1–3 s for a short utterance).
- **Buffer bound.** Max utterance = 30 s @ 16 kHz mono PCM16 ≈ 960 KB — trivial in main memory,
  freed on `stop()`. Frame size still capped by `MAX_FRAME_BYTES=64KB` (`speech.ts:10`).
- **Sherpa path unchanged** — same ~0.07 RTF, same 5-min idle dispose (`30` §6,
  `sherpa-speech-service.ts:24`). When STT-cloud is on, sherpa is *not* constructed until a
  fallback fires, so the ~250 MB model isn't loaded needlessly.
- 15 s STT timeout (`32` §5) bounds the worst case; exceed → abort → sherpa fallback.

## Risks

- `RISK` — **Batch loses the live transcript strip.** A user used to sherpa's live ticks sees only
  "Transcribing…". *Mitigation:* the strip is an honest spinner + final; `supportsPartials` drives
  it so no code lies; the accuracy win is the trade the demo frames (`41` §9).
- `RISK` — **Mid-utterance batch failure is unrecoverable** (audio already discarded, cannot
  retro-transcribe offline). *Mitigation:* the failure table (`32` §5) degrades to "repeat or
  type"; the composer never blocks; sherpa remains selectable as the zero-risk default.
- `RISK (low)` — **Cost from long dictations.** *Mitigation:* the 30 s cap bounds per-utterance
  cost; `gpt-4o-mini-transcribe` ≈ $0.003/min (`32` §1); local monthly estimate surfaces spend
  (`32` §6).
- `RISK (low)` — **Sample-rate/format mismatch to OpenAI.** The worklet emits 16 kHz PCM16; the
  provider wraps it in a valid WAV header before POST. *Mitigation:* unit test the WAV framing;
  reject empty buffers.
- `RISK` — **Copy/consent drift** — the app still asserts "audio never leaves the device" in ≥3
  places (`30` §3.1). *Mitigation:* content audit in this phase; consent modal states the reversal.

## Rollback strategy

`MVP DECISION` — **Rollback is a flag flip, not a code revert** (`41` §2, §10). Set
`stt_provider='sherpa-onnx'` (or clear the key / withdraw consent) and STT is byte-identical to
today's offline pipeline — the factory returns sherpa, the allowlist empties, Wireshark shows
zero. `withFallback` means even a *runtime* OpenAI failure auto-degrades to sherpa without user
action (`33` §5). If the whole cloud STT surface regresses, the v0.4 release can ship with
`stt_provider` defaulted to sherpa and the OpenAI option hidden — no revert of merged code.

## Definition of Done

Re-asserts the `41` §8 cross-cutting invariants, plus EP-3 specifics:

1. **Full reminder loop works offline, no key** (create → confirm → schedule → notify + speak) —
   sherpa STT, Windows TTS (`41` §8.1).
2. **Zero outbound packets with STT-cloud off** (Wireshark 30 min, SEC-10) (`41` §8.2).
3. **The confirmation gate holds** — a dictated reminder still requires an explicit Confirm; STT
   only fills the composer, it does not persist (`41` §8.3, `30` §13.1).
4. **The API key never crosses IPC**; the POST happens in main (`41` §8.4).
5. **Notification + history fire first**; STT is best-effort input, not on the fire path
   (`41` §8.6).
6. **No `child_process`/`eval`/dynamic import** added; the OpenAI provider uses `fetch` only
   (`41` §8.7).
7. `OpenAiSpeechProvider` satisfies `SpeechProvider`; `supportsPartials:false` is honoured
   end-to-end (UI shows "Transcribing…"); sherpa is the mandatory `withFallback` backup.
8. On + keyed + consented ⇒ traffic to `api.openai.com` **only** (`32` §8.4).
9. STT consent ("your voice is sent to OpenAI") shown before first cloud transcription and
   revocable in Settings (`32` §8.6).
10. No audio persisted to disk on any path; buffer dropped post-request.
11. **96 tests green** (`30` §10) + new `openai-speech-provider` unit tests; the `53` regression
    suite green (`41` §11).

## Feature Checklist

### Already completed (pre-EP-3, reused)
- Sherpa streaming STT in main (`sherpa-speech-service.ts`); lazy load + 5-min idle dispose.
- Renderer capture pipe: getUserMedia → AudioWorklet → `pushAudio` (`useSpeech.ts`).
- 2 s silence auto-stop + 30 s hard cap (`SILENCE_STOP_MS`, `HARD_CAP_MS`).
- 3-guard `SPEECH_AUDIO` handler + `MAX_FRAME_BYTES` (`speech.ts`).
- EP-1: provider factory + `withFallback`, key mechanism (`safeStorage` + key IPC), D1 fix
  (live `cloudEnabled()` predicate), speech onto `guard()`, dead-plumbing removal.

### New work (EP-3)
- `OpenAiSpeechProvider` (batch): buffer in main → POST `/v1/audio/transcriptions` at `stop()`.
- `SherpaSpeechProvider` adapter; factory cloud branch + always-sherpa fallback.
- `supportsPartials`-driven UI ("Transcribing…" for batch).
- `stt_consented_at` + STT consent modal (strong "voice is sent" disclosure).
- Minimal Settings STT toggle; conditional "audio leaves device" copy.
- WAV framing of the PCM buffer; 15 s timeout; buffer dropped post-request.

### Deferred work (later EPs)
- Full Settings/consent/privacy UX consolidation → **EP-8** (`49`).
- Voice-confirm of a dictated reminder → **EP-7** (`48`) (needs the dispatcher, `41` §6).
- STT feeding a *conversation* (not just a reminder) → after **EP-5** (`46`).

### Future work (post-1.0)
- `FUTURE OPTION` OpenAI **Realtime** STT (WebSocket, live network partials, `wss://` CSP).
- Deepgram / `transformers-js` providers behind the same `SpeechProvider` seam (`33` §2).

## Manual Testing

| # | Step / Action | Expected Result |
| --- | --- | --- |
| 1 | Fresh install, no key. Tap mic, dictate "remind me to call mom at 6pm". | Sherpa transcribes live (ticking strip); reminder card appears; Confirm schedules it. No network. |
| 2 | Settings → enable OpenAI STT with **no key**. | Toggle refuses / explains a key is needed; provider stays sherpa. |
| 3 | Add a valid key (EP-1 flow), enable OpenAI STT. | STT consent modal appears with "Your voice recording is sent to OpenAI to transcribe." Must accept. |
| 4 | Accept consent, dictate the same reminder. | Strip shows spinner + "Transcribing…" (no live ticks); final text lands in composer; card appears; Confirm schedules. |
| 5 | Compare accuracy on a hard phrase (proper noun) sherpa vs OpenAI. | OpenAI transcript is materially more accurate (the demo claim). |
| 6 | Wireshark running, STT-cloud **off**, use app 30 min. | Zero outbound packets. |
| 7 | Wireshark running, STT-cloud **on**, dictate. | Traffic to `api.openai.com` only; nothing else. |
| 8 | Dictate, then check disk/temp for any audio artifact. | None — buffer was in memory, dropped at `stop()`. |
| 9 | Switch provider back to sherpa mid-session. | Next dictation uses sherpa immediately (live rebind, no restart). |
| 10 | Revoke STT consent in Settings. | Provider reverts to sherpa; allowlist empties. |

## Edge Cases

- **Empty utterance** (mic tapped, immediate stop): buffer empty → skip POST → empty transcript,
  composer unchanged; no wasted API call.
- **30 s hard cap hit** during dictation: `stop()` fires; buffer (≤960 KB) POSTed once.
- **Consent accepted but key cleared** afterwards: factory falls to sherpa (gate fails on
  `hasApiKey()`); Settings notes cloud STT needs a key.
- **Provider switched while a batch POST is in flight**: the in-flight `stop()` resolves against
  the provider it started with; the *next* session uses the new provider.
- **Non-English dictation**: `gpt-4o-mini-transcribe` handles it; sherpa (en model) would not —
  a genuine cloud advantage, not an error.
- **Sample rate not 48 kHz** (odd device): worklet already normalises to 16 kHz PCM16; provider
  frames it as 16 kHz WAV regardless.
- **Very short (<1 s) buffer**: still POSTed; OpenAI returns text or empty; no crash.

## Failure Cases

Per `32` §5 failure table — each degrades to **sherpa**, one non-modal notice, never fatal:

- **No network / offline**: skip POST; toast "Yogi's online features need a connection."; this
  utterance is lost (audio gone) → user repeats with sherpa (auto-selected via fallback).
- **401 invalid key**: sherpa for this session; Settings banner "Your API key was rejected.";
  cloud STT disabled this session.
- **429 / 5xx**: one retry with backoff, then sherpa fallback.
- **Timeout (>15 s)**: abort POST, sherpa unavailable retroactively (audio discarded) → ask to
  repeat/type; composer unblocked.
- **Malformed/empty API response**: treat as failure → degrade; log a reason code + a **hash** of
  the input, never the audio (`32` §5, `11` §12).
- **`safeStorage` unavailable** (`isEncryptionAvailable()` false): key never persisted → cloud STT
  simply unavailable → sherpa (`32` §3.3).

## Recovery Tests

1. Kill network mid-dictation with STT-cloud on → toast + degrade; restore network → next
   dictation succeeds via OpenAI; no stuck "Transcribing…".
2. Enter a bad key → 401 banner, session disabled; enter a good key → cloud STT works again
   without restart (live rebind).
3. Force a timeout (throttle) → abort + repeat prompt; retry succeeds; no memory growth (buffer
   freed).
4. Toggle STT provider off→on→off rapidly → factory rebinds each time; final state's provider is
   the one used; allowlist matches final state.
5. `safeStorage` disabled → app offers session-only key or refuses; STT stays sherpa; no plaintext
   key on disk.

## Regression Tests

Per `41` §11 / `53`, these MUST stay green in EP-3:

- **Sherpa STT still works with cloud off** — live partials, final via `stop()`, offline, no
  network (`useSpeech.ts` path unchanged).
- **Windows voice still works** — TTS unaffected by EP-3 (EP-4 touches TTS).
- **Full offline reminder loop intact** — create → confirm → schedule → notify + speak, no key
  (`41` §8.1).
- **Confirmation gate holds** — a dictated reminder still needs an explicit Confirm; STT never
  persists (`30` §13.1).
- **96 tests green** — the existing parser/scheduler/DB suites unbroken (`30` §10); dropping
  `SPEECH_FINAL` and `[STT-DIAG]` breaks no test.
- **Wireshark off→zero** re-verified (SEC-10) with the new provider present but disabled.

## Performance Tests

1. **Capture CPU**: dictate 30 s with OpenAI STT; main-thread jank ≤ sherpa (no per-frame ONNX).
2. **Buffer memory**: max-length utterance holds ≤ ~1 MB in main; freed within one tick of
   `stop()` (heap snapshot before/after).
3. **Transcription latency**: short (~3 s) utterance → final text within ~1–3 s over a normal
   connection; "Transcribing…" never hangs beyond the 15 s timeout.
4. **Sherpa idle dispose** still fires at 5 min; the ~250 MB model is not loaded while OpenAI STT
   is the active provider (until a fallback).
5. **No leak across sessions**: 20 dictations in a row → stable main-process heap.

## Expected App Behaviour

```text
Current (v0.3, offline):
  tap mic → sherpa streams live partials → stop() returns final → composer → card → Confirm → schedule

EP-3 (v0.4, STT-cloud opt-in):
  STT-cloud OFF  → identical to Current (sherpa, live partials, zero network)
  STT-cloud ON   → tap mic → frames buffer in MAIN (no partials) → stop() POSTs to OpenAI
                 → "Transcribing…" → final (more accurate) → composer → card → Confirm → schedule
  any OpenAI failure → withFallback → sherpa (or "repeat/type") → loop still completes
  interaction model UNCHANGED — reminder app, better ear (41 §9)
```

## Conversation Testing

EP-3 predates the LLM (EP-5, `46`), so non-reminder input shows the **honest placeholder**
(`41` §9). STT only improves transcription *into* the existing flow:

- **User (dictated):** "remind me to take medicine at 9pm"
  **Expected:** accurate transcript → reminder card → Confirm → scheduled + spoken. (Cloud STT
  just made the transcription better.)
- **User (dictated):** "what's the weather tomorrow?"
  **Expected:** transcribed accurately, but shows the placeholder "Connect OpenAI in Settings to
  chat and answer questions" — EP-3 does **not** converse (`41` §9). No reminder created.
- **User (dictated, STT-cloud off):** "remind me to call the bank Monday morning"
  **Expected:** sherpa transcribes (possibly less accurately); same reminder flow; zero network.
- **User (dictated, ambiguous):** "remind me later"
  **Expected:** the existing clarification card ("later — when exactly?") — the parser's ambiguity
  policy is unchanged; STT provider does not alter it.

## Voice Testing

Per the `41` §11 / `53` voice suite, exercised for EP-3's STT surface:

- **Mic unavailable / permission denied** (`NotAllowedError`/`NotFoundError`): `useSpeech`
  degrades to "You can still type." — no provider is even reached (`useSpeech.ts:98`).
- **Internet disconnected, STT-cloud on**: POST skipped; toast "needs a connection"; this
  utterance lost (audio gone) → repeat via sherpa fallback; composer unblocked.
- **OpenAI unavailable (5xx/429)**: one retry → sherpa fallback; one non-modal notice.
- **Slow response** (near 15 s): "Transcribing…" persists to the timeout; then abort + repeat
  prompt; no hang.
- **Large pause mid-dictation**: the 2 s silence timer auto-stops (`SILENCE_STOP_MS`); whatever
  was buffered is transcribed — behaviour identical to sherpa's endpoint handling from the user's
  view.
- **Interrupt** (tap mic again while listening): `toggle` stops the session; batch POSTs what it
  had; sherpa flushes its tail (`useSpeech.ts:123`).
- **"stop" / "cancel" / "repeat" spoken**: EP-3 has no voice-command layer (that is EP-7 voice
  confirm, `48`) — these are transcribed as literal text into the composer; the reminder flow
  ignores non-reminder text with the placeholder. No accidental action (gate holds).
- **Provider switching** (sherpa↔OpenAI mid-use): live rebind; the next dictation uses the newly
  selected provider; an in-flight POST completes on its original provider; allowlist tracks the
  final state.
