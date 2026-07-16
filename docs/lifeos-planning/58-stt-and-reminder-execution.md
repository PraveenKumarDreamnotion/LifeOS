# 58 — STT Quality Overhaul & Reminder Execution Architecture

Completion report for the two-track effort: (A) better speech-to-text across online/offline
providers, and (B) reminders that **execute** their intent instead of replaying a title.

Status: implemented + unit/integration tested + full build green. Live-audio / cloud-key / native
validation is called out per item in §7.

---

## 1. Research summary (2025-2026 best practices)

**STT**
- **VAD-gating is the #1 quality/anti-hallucination lever.** A lightweight client VAD (Silero ONNX)
  that only forwards *voiced* audio kills Whisper's "thanks for watching" hallucinations on silence.
  `no_speech_prob` alone is unreliable.
- **Endpointing**: ~500-700ms trailing silence; min-utterance ~120-300ms (drop shorter as noise);
  hard max to bound latency.
- **OpenAI**: `gpt-4o-transcribe` (full) beats `gpt-4o-mini-transcribe`/`whisper-1`; a realtime
  WebSocket transcription API now exists. `language` + `prompt` steer accuracy.
- **Offline**: whisper.cpp / faster-whisper beat a small streaming Zipformer on WER; Parakeet is the
  best *streaming* offline upgrade. Our Zipformer was on its lowest-accuracy settings
  (`greedy_search`, 1 thread).
- **Wispr Flow**'s quality = VAD + cloud STT + a **cheap LLM cleanup pass** (punctuation, fillers,
  context) — not a magic recognizer.

**Scheduled AI tasks**
- Store **structured task intent** (`type`, `params`, `tools`, `output_format`), not the raw
  utterance replayed to an LLM at trigger time (ambiguous, context-gone, nondeterministic).
- Execute as a bounded agent loop at trigger, then inject the result as a **proactive assistant
  message**, not a synthetic user turn (ChatGPT Tasks / Claude Scheduled Tasks pattern).

## 2. Root-cause analysis (primary evidence)

**Issue 1 — STT quality**
| Cause | Evidence |
|---|---|
| Batch (OpenAI) never auto-stopped on silence — `bumpSilence()` was only called from the partial handler, which batch never emits → ran to the 30s hard cap | `src/hooks/useSpeech.ts` (old) |
| OpenAI under-configured: `-mini` model, no `language`, no `prompt`, native-rate WAV upload | `electron/providers/openai-speech-provider.ts` (old) |
| Sherpa on lowest-accuracy settings: `greedy_search`, `numThreads:1`, no punctuation | `electron/speech/sherpa-speech-service.ts` (old) |
| No independent VAD — only acoustic endpointing; noise reached the recognizer | — |

**Issue 2 — reminders ask "what would you like to know?"**
- A reminder stored only a **title string** (no execution intent) — `core/types/reminder.ts`.
- At fire time `deliverToChat` recorded a **display-only** turn `⏰ Reminder — <title>`; the **LLM was
  never invoked**, nothing executed — `electron/main/index.ts`.
- When the user then spoke, the engine saw the reminder as passive context with no instruction to
  *do* it → conversational reply — `electron/conversation/conversation-engine.ts`.
- The fix's building blocks already existed: a `research` intent + pluggable `SearchProvider`.

## 3. Architecture changes

### Track A — STT
- **One clean interface, extended, not rewritten.** `SpeechProvider` gains an optional typed
  `SpeechStartOptions` (`language`, `keywords`) so providers stop smuggling config through
  constructors. `makeSpeechProvider` is now a **registry map** + `registerSpeechProvider()` — adding
  an engine is one entry, no call-site changes.
- **Core fixes** (unconditional): batch silence auto-stop via an **energy-gated endpointer** in the
  renderer (transport-agnostic); OpenAI → `gpt-4o-transcribe` + `language`/`prompt` + **16kHz
  box-filter resample**; Sherpa → `modified_beam_search` + multi-thread (capped).
- **VAD core** (`core/speech/vad.ts`): a pure, tested `VadGate` state machine (hysteresis,
  min-speech, silence hangover) that a Silero ONNX scorer *or* the energy meter feeds. The energy
  gate ships now; Silero ONNX is the drop-in scorer.
- **LLM cleanup pass** (`core/speech/transcript-cleanup.ts` + OpenAI backend): a hardened,
  injection-resistant format-only pass on **dictation** (not the yes/no confirm path). Online, gated
  (`stt_cleanup_enabled`), best-effort (always falls back to raw).
- **New providers behind the seam**: `DeepgramSpeechProvider` (streaming WS, injectable socket) and
  `WhisperCppSpeechProvider` (offline batch, N-API, injectable transcriber) — both wrapped in the
  existing `withFallback(sherpa)`.

### Track B — Reminder execution
- **Structured spec** (`core/types/reminder-execution.ts`): `ReminderExecutionSpec` =
  `{version,type,instruction,capabilities,outputFormat,delivery}`, zod-validated. Persisted in a new
  **nullable** `execution_json` column (migration **M005**). `null` = classic notify/sing — every
  existing reminder is byte-identical.
- **Local classifier** (`core/parsing/classify-execution.ts`): conservatively detects info-retrieval
  reminders ("tell me / find / what is / contact details") and builds an `ai_task` spec with
  `web_search`. Deterministic, offline-capable; the confirmation gate backstops misclassification.
- **Intent-stating confirmation**: the summary now reads *"I'll look up X and tell you · <time> ·
  one-time"* — confirming it is informed consent to run the task.
- **`ReminderExecutor`** (`electron/reminders/reminder-executor.ts`): at fire time (best-effort,
  **after** the unconditional notify+history), runs the read-only task via the `SearchProvider`,
  then speaks + delivers the **answer**. Bounded by a deadline; degrades honestly offline.
- **Confirmation-gate policy preserved**: read-only capabilities auto-execute; any **write**
  capability returns `needs_confirmation` (no silent actuation). The trigger-sink suppresses the
  default title-speak/title-delivery for `ai_task` so the answer, not the title, is what's heard.

## 4. Files modified / added

**Track A** — `core/speech/speech-provider.ts` (StartOptions), `core/speech/vad.ts` (new),
`core/speech/transcript-cleanup.ts` (new), `src/hooks/useSpeech.ts` (energy endpointer),
`electron/providers/openai-speech-provider.ts` (model/lang/prompt/resample),
`electron/speech/sherpa-speech-service.ts` (beam/threads), `electron/providers/registry.ts` (map +
cleaner + deepgram/whisper factories), `electron/providers/openai-transcript-cleaner.ts` (new),
`electron/providers/deepgram-speech-provider.ts` (new),
`electron/providers/whisper-cpp-speech-provider.ts` (new), `electron/main/ipc/speech.ts` (cleanup
hook), `electron/database/settings-repository.ts` (models + `stt_cleanup_enabled`),
`electron/providers/sherpa-speech-provider.ts` (StartOptions signature).

**Track B** — `core/types/reminder-execution.ts` (new), `core/types/reminder.ts` (`execution` field),
`core/types/ipc.ts` (`CreateReminderInput.execution`), `core/parsing/classify-execution.ts` (new),
`electron/database/migrations.ts` (M005), `electron/database/rows.ts`,
`electron/database/reminder-repository.ts`, `electron/reminders/reminder-executor.ts` (new),
`electron/scheduler/trigger-sink.ts` (ai_task branch), `electron/conversation/conversation-engine.ts`
(spec capture + summary), `electron/main/index.ts` (executor wiring).

## 5. Why this is better than the alternatives
- **Extends the proven seam** instead of rewriting — the docs confirm the provider abstraction was
  built for exactly this. Six providers = one interface + N small classes, not six integrations.
- **Additive & backward-compatible** — `execution_json` nullable, `execution` key omitted for plain
  reminders (byte-identical gate still passes), settings default to today's behaviour.
- **Honors every locked-in invariant** — confirmation gate (read-only auto-exec / writes confirm),
  offline-first + `withFallback`, reliability-first fan-out (notify/history stay unconditional and
  first), key-never-crosses-IPC, no zod in the sandboxed preload.
- **Structured intent > prompt replay** — deterministic, offline-classifiable, and the fired
  reminder executes rather than re-parsing an ambiguous utterance.

## 6. Test results
- **Typecheck**: 0 errors. **Lint**: 0 errors. **Full build**: all bundles compile.
- **Tests**: **334 passing** (was 269) across 37 files. New/extended coverage:
  `resampleTo16kMono`, registry map + `registerSpeechProvider`, `reminder-execution` spec
  round-trip, **M005** migration on a populated DB, repo spec persistence, `ReminderExecutor`
  routing (read-only/write/degrade/timeout), trigger-sink ai_task branch, `classify-execution`
  (positive/negative/envelope), the **mis-tag guard** (research-tagged reminder → proposes, doesn't
  search now), an **end-to-end fired-ai_task chain** (real trigger-sink + real executor → answer
  delivered + spoken, title suppressed, offline degrade), transcript cleanup helpers + OpenAI
  backend, Deepgram streaming (URL/parse/lifecycle/partials/finals/error), whisper.cpp batch
  lifecycle, `VadGate` state machine.

## 7. Remaining limitations / validation status
- **Audio-quality items are not unit-testable** (noisy/rapid/interrupted/silence/long dictation).
  The *logic* (endpointing state machine, resampler, provider lifecycles) is unit-tested; the
  end-to-end audio behaviour needs a **real mic on a real machine**.
- **Silero VAD**: the decision core + energy-based feed ship and are tested; wiring the Silero ONNX
  scorer (model + onnxruntime in a worker) into `useSpeech` is the remaining step — the seam is
  ready (`VadGate.push(prob)`).
- **whisper.cpp**: provider + lifecycle tested with an injected transcriber; live decode needs the
  `smart-whisper` native module + a GGML model installed, and a model-fetch script (like
  `fetch-stt-model.mjs`). Registered via `deps.whisperCpp` — absent → falls back to Sherpa.
- **Deepgram**: provider + WS lifecycle fully tested with a fake socket; live use needs a **Deepgram
  API key store** (a second secret via safeStorage + consent) and a `ws`/WebSocket adapter for
  `deps.deepgram`. Absent → falls back to Sherpa.
- **OpenAI model ids** (`gpt-4o-transcribe`) are overridable via settings and should be re-verified
  as the current best at deploy time.
- **Reminder executor** currently implements the **web_search** capability; weather/news/email/
  calendar are reserved in the taxonomy and degrade gracefully until wired.
- **Write-action reminders**: the policy (`needs_confirmation`) and its honest fire-time message
  exist, but the *confirm-and-execute-a-write-at-fire-time* loop is **not wired**, and the local
  classifier does not yet emit write capabilities — so this path is defensive future-proofing, not a
  live feature. Read-only auto-execution (the reported case) is fully wired.
- The **non-dispatcher (rollback) reminder path** and **UI-created reminders** don't classify AI
  tasks (they're plain reminders) — acceptable, documented.

## 8. Future recommendations
1. Wire Silero ONNX into `useSpeech` (worker + model) feeding `VadGate`.
2. Add a whisper.cpp model-fetch script + package the native module; expose an offline-engine picker.
3. Add a Deepgram key store + consent + `ws` adapter to light up streaming cloud.
4. Move Sherpa/whisper decode to a `utilityProcess` (flagged tech debt) so STT can't jank the main
   thread.
5. Extend the executor with dedicated weather/news/calendar-brief capabilities and a popup that shows
   the researched answer inline (not just chat + voice).
6. Consider OpenAI realtime STT as a streaming online provider behind the same seam.
