# 33 — Provider Abstraction

> **Goal:** three provider seams — **speech-to-text**, **text-to-speech**, and **LLM** — so
> that the rest of the application never knows which engine is active. OpenAI, sherpa,
> Windows TTS, and (later) Ollama/Deepgram/ElevenLabs all sit behind these interfaces.
>
> **Key finding this doc responds to (`30` §5, §11):** the interfaces were *designed* in
> `06` (`SpeechService`) and `07` (`TTSService`) and *anticipated* in the settings schema
> (`stt_provider`, `tts_voice_id`, …), but **none were built** — STT is a direct
> `new SherpaSpeechService`, TTS a direct `speechSynthesis.speak`. This doc turns the
> designed interfaces into the real seam and confronts the two hard mismatches: **streaming
> vs batch STT**, and **there is no IPC path to play cloud-returned audio bytes.**

---

## 1. Where the code is hard-wired today (the starting point)

| Seam | Hard-wired at | Consequence |
| --- | --- | --- |
| STT | `speech.ts` → `new SherpaSpeechService(...)`; `sherpa-speech-service.ts` → `require('sherpa-onnx-node')` | No factory, no interface; the public surface (`start`/`pushAudio`/`stop`/partials) is a de-facto interface never named |
| TTS | `audio-host.ts` → `speechSynthesis.speak(u)`; `trigger-sink.ts` → `send('tts:speak', {text})` | One command shape, one consumer; `voiceId`/`rate` accepted but dropped |
| LLM | *nothing* — no LLM code exists; the network seam is dead (`aiAssistEnabled: () => false`) | Greenfield; build the interface first |

The abstraction is therefore: **extract two interfaces from existing code, build one new
interface, and add a factory + fallback decorator keyed on settings that already exist.**

---

## 2. `SpeechProvider` (STT) — adopting and correcting `06`'s interface

`06` already specified `SpeechService`. v2 adopts it with **two clarifications** the audit
forces: partials are optional, and the transport differs per provider.

```ts
// core/speech/speech-provider.ts  (renamed from 06's SpeechService; same shape)
export type SpeechProviderId = 'sherpa-onnx' | 'openai' | 'deepgram' | 'transformers-js';

export interface SpeechProvider {
  readonly id: SpeechProviderId;
  readonly supportsPartials: boolean;   // sherpa/deepgram/openai-realtime: true; openai-batch: false
  readonly isOffline: boolean;          // sherpa/transformers-js: true; openai/deepgram: false
  readonly transport: 'streaming' | 'batch';   // ← NEW, the mismatch made explicit

  init(): Promise<void>;
  start(session: SpeechSessionId, sampleRate: number): Promise<void>;
  pushAudio(session: SpeechSessionId, pcm16: ArrayBuffer): void;  // batch: buffers internally
  stop(session: SpeechSessionId): Promise<SpeechFinalResult>;     // both: final comes from here
  dispose(): Promise<void>;

  on(e: 'partial', cb: (r: SpeechPartialResult) => void): void;  // batch: never fires
  on(e: 'error',   cb: (e: SpeechError) => void): void;
}
```

`SpeechPartialResult` / `SpeechFinalResult` / `SpeechError` are exactly as in `06`. Note we
**drop the dead `on('final')` event** (`30` §3.2 D8): the audit confirmed final text always
comes from `stop()`'s return value and the broadcast `onFinal` was never fired. One less lie.

### 2.1 The streaming-vs-batch mismatch — resolved (`30` §11.1)

| | `SherpaSpeechProvider` (streaming) | `OpenAiSpeechProvider` (batch) |
| --- | --- | --- |
| `transport` | `'streaming'` | `'batch'` |
| `supportsPartials` | `true` | `false` |
| `pushAudio` | decodes each ~100 ms frame; emits `partial` | **appends the frame to an in-memory buffer**; emits nothing |
| `stop` | flushes tail padding, returns final text | POSTs the whole buffer to `/audio/transcriptions`, returns final text |
| UI effect | live transcript strip ticks | strip shows "Transcribing…" then the final text lands |

**The interface makes partials optional; the UI reads `supportsPartials` and adapts.** The
renderer's live-transcript region (`useSpeech`) keeps working for sherpa and simply shows a
spinner+final for OpenAI-batch. No caller branches on the concrete class.

`FUTURE OPTION` — OpenAI **Realtime** (WebSocket) would be `transport:'streaming'`,
`supportsPartials:true`, restoring live partials over the network — at the cost of a
`connect-src wss://api.openai.com` CSP entry and a persistent socket. Deferred; the batch
provider ships first because it reuses the existing frame→buffer plumbing with no new
transport (`37`).

### 2.2 Where audio is bounded (privacy)

`MVP DECISION` — For any **cloud** STT provider, audio is buffered in **main** (never a
renderer, never disk), POSTed once at `stop()`, and the buffer is dropped immediately after.
The 30 s hard cap and 2 s silence auto-stop (`06`) still bound how much audio can ever be
sent. The consent + network-allowlist gating is in `32` §3.

---

## 3. `TextToSpeechProvider` (TTS) — adopting `07`, plus a new audio-bytes path

`07` specified `TTSService`. v2 adopts it, but the audit found the blocker: **the hidden
audio window can only play a bundled filename-key; there is no channel to hand it audio
bytes** (`30` §11.2). So the interface must distinguish "the provider speaks in-window" from
"the provider returns bytes the app must play."

```ts
// core/tts/tts-provider.ts  (from 07's TTSService)
export type TtsProviderId = 'web-speech' | 'windows-sapi' | 'openai' | 'elevenlabs';

export interface TextToSpeechProvider {
  readonly id: TtsProviderId;
  readonly isOffline: boolean;          // web-speech/sapi: true; openai/elevenlabs: false
  readonly kind: 'in-window' | 'audio-bytes';   // ← NEW, decides the playback path

  init(): Promise<void>;
  listVoices(): Promise<TtsVoice[]>;    // web-speech: OS voices; openai: the fixed named set (35)
  speak(text: string, opts: TtsOptions): Promise<TtsSpeakResult>;
  cancel(): void;
  dispose(): Promise<void>;
}

export interface TtsOptions { voiceId?: string; rate?: number; }
export type TtsSpeakResult =
  | { kind: 'in-window' }                              // already spoken via speechSynthesis
  | { kind: 'audio-bytes'; mime: string; bytes: ArrayBuffer };  // caller must play it
```

### 3.1 The new audio-bytes playback path (the missing piece)

`MVP DECISION` — Add exactly one new capability to the hidden audio window: **play an audio
buffer handed to it over IPC**, without ever accepting a path or URL (preserving the `16` §7
no-path rule).

- New main→audio channel `audio:playBytes` carrying `{ mime, bytes: ArrayBuffer }` (a
  transferable buffer, size-capped, e.g. ≤ 2 MB per utterance). The audio window turns it
  into a `Blob` → object URL → `<audio>`; the object URL is same-origin `blob:` (already
  allowed by CSP `media-src`/`worker-src blob:`). **No filesystem, no remote URL.**
- The **OpenAI TTS network call happens in main** (`OpenAiTtsProvider.speak` → returns
  `audio-bytes`), so the API key never touches a renderer. Main then sends the bytes to the
  audio window via `audio:playBytes`.
- `WebSpeechTtsProvider.speak` returns `{ kind: 'in-window' }` and drives the existing
  `tts:speak` path unchanged.
- A new audio→main channel `audio:playbackError` (finally wiring the dead `audio:error`
  surface, `30` §3.2 D8) reports playback failure so the coordinator can degrade.

```text
Scheduler/engine wants speech
   │
   ├─ provider.kind === 'in-window'  → send('tts:speak', {text, voiceId, rate})  (existing)
   └─ provider.kind === 'audio-bytes'→ await provider.speak() in MAIN (network, key stays)
                                       → send('audio:playBytes', {mime, bytes})  (NEW)
```

`MVP DECISION` — This new path is the **only** structural change the audio window needs. It
is small, security-preserving (bytes not paths, blob: not remote, key in main), and it
unblocks every cloud TTS provider at once.

### 3.2 Fallback is mandatory, never fatal (`07` §5)

A `TextToSpeechProvider` failure is never fatal (the `07` rule, preserved). Speech is wrapped
in the trigger fan-out's `safely()` (`30` §2.4) and the coordinator falls back:
`OpenAI → Windows (web-speech/SAPI) → silent (notification still fires)`. The orphaned
`tts_degraded` setting (`30` §3.2) is finally used to surface "Yogi couldn't use the online
voice; using the Windows voice" once, non-modally.

---

## 4. `LlmProvider` — the new interface (greenfield)

No LLM code exists, so this is built clean, generalising `09`'s `AiAssistProvider` from
"reminder slot-filler" to "conversation turn producer."

```ts
// core/llm/llm-provider.ts  — no electron, no fetch import at the type layer
export type LlmProviderId = 'openai' | 'ollama' | 'anthropic' | 'gemini';

export interface LlmProvider {
  readonly id: LlmProviderId;
  readonly isLocal: boolean;            // ollama: true; rest: false
  readonly supportsStreaming: boolean;  // optional, like STT partials

  // Returns the raw model output as `unknown` — DELIBERATELY unvalidated (09 §9).
  // The engine runs AssistantTurnSchema.parse() on the result; a provider that returned
  // a typed AssistantTurn would be claiming it validated something it didn't.
  complete(input: LlmTurnInput, signal: AbortSignal): Promise<unknown>;

  // Optional streaming: token deltas for the assistant reply text only (32 §5).
  stream?(input: LlmTurnInput, onDelta: (t: string) => void, signal: AbortSignal): Promise<unknown>;
}

export interface LlmTurnInput {
  system: string;
  nowIso: string;
  timezone: string;
  reminders: ReminderSummary[];    // titles + relative time ONLY (31 §4.3) — no ids
  messages: { role: 'user' | 'assistant'; text: string }[];  // sliding window
  memories: MemoryFact[];          // v0.3; non-sensitive only
  responseSchema: object;          // the AssistantTurn json_schema (31 §3)
}
```

`MVP DECISION` — `complete()` returns `unknown` for the same reason `09` §9 gave: the type
system must force the caller through Zod. The **structured-output** request (OpenAI
`response_format: json_schema, strict:true`) constrains decoding, but the app still runs the
four gates (`09` §5, `31` §5) — a schema-valid object can still name a past date or an
unsupported action.

```text
LlmProvider
├── OpenAiLlmProvider     ← v2 primary cloud (32)
├── OllamaLlmProvider     ← local llama3.2, collapses the consent apparatus (24's v0.4 vision; release v0.8 per 39)
├── AnthropicLlmProvider  ← future stub
└── GeminiLlmProvider     ← future stub
```

---

## 5. The factory + fallback decorator

`MVP DECISION` — One factory per seam, keyed on the settings that **already exist**
(`stt_provider`, a new `tts_provider`, `ai_provider`). The rest of the app asks the factory
for "the speech provider" and never sees a concrete class.

```ts
// electron/providers/registry.ts (main only — this is where electron/network live)
export function makeSpeechProvider(s: SettingsRepository): SpeechProvider {
  const wantsCloud = s.get('stt_provider') === 'openai' && s.hasApiKey() && sttConsented(s);
  const primary = wantsCloud ? new OpenAiSpeechProvider(readKey(s)) : new SherpaSpeechProvider();
  return withFallback(primary, () => new SherpaSpeechProvider());   // cloud fails → offline
}
```

- **`withFallback(primary, makeBackup)`** is a decorator satisfying the same interface: it
  tries `primary`, and on `init`/`start`/`stop` error transparently swaps to the backup,
  sets `tts_degraded`/an equivalent flag, and logs the reason (never the payload). The app
  above the seam is oblivious.
- **The offline provider is always the backup**, for every seam. Cloud is *preferred when
  enabled + keyed + consented*; it is never the only option. This is the concrete encoding of
  the offline-first reconciliation (`30` §11.3, `32` §2).
- The factory is re-run when the relevant setting changes (the same live-rebind that fixes
  the dead `aiAssistEnabled` probe, `30` D1) so switching providers needs no restart.

---

## 6. What the deterministic parser becomes

The existing `core/parsing` pipeline is **not** an LLM provider — it is the **reminder
executor + validator** the dispatcher calls when `intent === reminder_*` and either (a) the
LLM is unavailable, or (b) to re-validate the LLM's proposed reminder fields before
persistence (`30` §9.2, `31` §7). Its scheduling math, ambiguity policy, and clarification
catalog are reused as guardrails on LLM output. So there is a fourth, always-present,
zero-network "provider" of reminders — the local parser — sitting behind the dispatcher, not
behind `LlmProvider`. This is what guarantees the reminder workflow still works with no key
and no network.

---

## 7. Settings that drive the seams

Reusing the existing keys (`10`/`15`), adding two, and finally *reading* the orphans:

| Setting | Role | Status |
| --- | --- | --- |
| `stt_provider` | `'sherpa-onnx' \| 'openai'` | exists (orphan → now read) |
| `tts_provider` | `'web-speech' \| 'openai'` | **new** |
| `tts_voice_id` | provider voice id (e.g. `alloy`) | exists (orphan → now read, `35`) |
| `tts_rate` | number as string | exists (orphan → now read) |
| `tts_degraded` | fallback-happened flag | exists (orphan → now read) |
| `ai_provider` | `'openai' \| 'ollama' \| …` | exists |
| `ai_assist_enabled` / consent flags | master cloud gates | exists (`32` §3) |
| `stt_consented_at` / `tts_consented_at` | per-feature cloud consent | **new** (`32` §3) |

Full Settings UX for these is `34`; voice specifics are `35`; the network/consent gating is
`32`.

---

## 8. Summary

- Three interfaces — `SpeechProvider`, `TextToSpeechProvider`, `LlmProvider` — each with an
  **offline default** and cloud implementations behind a factory + fallback decorator.
- The two audit-identified blockers are solved explicitly: STT partials become **optional**
  (`transport` field), and TTS gains a **new `audio:playBytes` path** so cloud audio bytes
  can play in the hidden window without weakening the no-path rule.
- The API key lives only in **main**; all cloud calls happen in main; the offline provider is
  always the safety net. Nothing above the seam knows which engine is running — the brief's
  core requirement.
