# 37 — Phase Development Roadmap (v2)

> **⚠️ Superseded for BUILD ORDER by `41`.** The execution roadmap `41` (and phase docs
> `42`–`52`) is the authority for the order features are built and released, using
> re-sequenced **execution phases EP-1…EP-11**. This doc's "Phase 1…7" are *architecture*
> phases and remain valid as the per-capability architecture reference, but where the two
> disagree on **order or phase numbering**, `41` wins. (E.g. this doc's Phase 2 = OpenAI LLM
> maps to `41`'s EP-5; voice is built *before* the LLM in `41`.) Release tags: see `54`.

> **Read `30`–`33` and `36` first.** This roadmap sequences the conversation-first pivot into
> **independently releasable** phases. Each phase ships something a user can feel, leaves the
> app in a shippable state, and preserves the two invariants the audit told us to protect:
> the **confirmation gate** and **zero-network-by-default** (`30` §13).

## Why this order (it differs from the brief)

The brief suggested: Conversation Engine → OpenAI Speech → OpenAI TTS → Reminder Conversation
→ Voice Confirmation → Memory → Research. I reordered for four reasons:

1. **Front-load an offline conversation shell (Phase 1).** The single biggest structural gap
   is the renderer's missing message model (`30` §3.1). Building the conversation *shell* and
   the provider *plumbing* first — with the local parser behind the dispatcher and **no cloud
   at all** — ships a real UX improvement while staying 100% offline and Wireshark-clean. It
   also lands the enabling refactors (provider interfaces, the dead-seam fix `30` D1,
   safeStorage plumbing) before any feature depends on them.
2. **Isolate each risky cloud capability into its own phase (2, 3, 4).** LLM, STT, and TTS
   each reopen the network surface differently (chat text, microphone audio, spoken text) and
   each has its own consent (`32` §2). Separate phases mean separate, testable Wireshark/consent
   verifications instead of one big cloud bang.
3. **Combine TTS + Voice (Phase 4).** They share the *new* `audio:playBytes` path (`33` §3.1)
   — the single hardest piece of the migration. Splitting them would build that path twice.
4. **Voice confirmation after the dispatcher is generalized (Phase 5).** Voice "yes/no" is a
   confirmation *method* on the Action Dispatcher; it needs the dispatcher's pending-proposal
   invariant (`36` §4.3) to exist first.

Phases 6–7 (Memory, Research) stay last and deliver `24`'s Memory and Research **feature
tiers** (which `24` estimated at its own v0.3/v0.5 — those are feature-tier visions, not v2
release numbers).

> **Version authority:** these **phase numbers (P1–P7) own the sequencing**; the **release
> version** each phase ships in is defined solely by `39`'s release map (P1→v0.2 … P7→v0.7,
> Ollama v0.8, v1.0 earned). The "`24` tier" column below cites doc `24`'s original
> feature-tier estimates for provenance, **not** the v2 release version.

| Phase | Ships | Network posture | `24` feature tier |
| --- | --- | --- | --- |
| 1 | Offline conversation shell + reminder UX + provider seams | **zero** | new (conversation shell) |
| 2 | OpenAI conversation (chat/question/LLM reminders) | chat text, consented | `24`'s v0.1 AI Assist, generalized |
| 3 | OpenAI STT (batch) | mic audio, consented | future STT tier |
| 4 | OpenAI TTS + voice picker | spoken text, consented | future TTS tier |
| 5 | Voice confirmation + full dispatcher | no new egress | — |
| 6 | Memory (save/recall, FTS5) | none (sensitive never sent) | `24`'s memory tier |
| 7 | Research foundation (weather) | per-provider consent | `24`'s research tier |

---

# Phase 1 — Conversation Shell (offline)

## Goal
Turn the single-shot `ChatScreen` into a real conversation surface (message list, history,
streaming-ready), route reminder creation through a new **Action Dispatcher** backed by the
**local parser**, and land the provider/interface/keys plumbing — all with **no cloud calls**.

## Why this phase exists
The renderer has no conversation model (`30` §3.1) and there is no dispatcher (`36` §1). Every
later phase plugs into these two. Building them offline first de-risks the architecture without
touching the network promise, and delivers a genuinely nicer reminder experience immediately.

## Files affected
- New: `core/conversation/{intent,turn-schema,action-schemas}.ts`, `core/actions/action.ts`,
  `core/speech/speech-provider.ts`, `core/tts/tts-provider.ts`, `core/llm/llm-provider.ts`.
- New: `electron/conversation/engine.ts`, `electron/actions/{dispatcher,execute,pending-store}.ts`,
  `electron/providers/registry.ts`.
- New: `src/features/chat/{conversation-types.ts, MessageList.tsx, MessageBubble.tsx, ProposalCard.tsx}`,
  `src/hooks/useConversation.ts`.
- Changed: `electron/main/index.ts` (fix D1; wire engine/dispatcher), `electron/main/ipc/index.ts`
  (+`chat:*`, `action:*`, `settings:setApiKey/clearApiKey/validateApiKey`), `electron/main/ipc/speech.ts`
  (consolidate onto `guard()`, `30` D4), `electron/preload/index.ts` (+new channels),
  `src/types/window.d.ts`, `src/lib/ipc.ts`, `src/features/chat/ChatScreen.tsx` (rewrite around the list),
  `core/parsing/types.ts` (`Intent`→`ReminderIntent`), `electron/database/settings-repository.ts` (+`tts_provider`, consent keys).

## Architecture changes
Introduce the pipeline of `31` (engine → validated turn → dispatcher) and `36` (dispatcher →
confirmation → execution), but with exactly one turn producer wired: a **local turn adapter**
that classifies intent with the existing regex parser and, for `reminder_*`, produces an action;
for anything else returns a `chat` turn whose `reply` is a placeholder ("Connect OpenAI in
Settings to chat and answer questions."). Extract the three provider interfaces + factory (`33`)
with **only the offline implementations** registered (sherpa, web-speech, local-parser).

## Database changes
Adopt the existing `conversations` table (one row per turn, `31` §4.2) — **no migration** (columns
already exist). Add settings keys `tts_provider='web-speech'`, `stt_consented_at=''`,
`tts_consented_at=''` via the idempotent `INSERT OR IGNORE` seeder (no schema change).

## UI changes
`ChatScreen` becomes a scrolling `MessageList` of user/assistant bubbles with the composer + mic
docked at the bottom (reuse `useSpeech`, `MicButton`). The reminder confirmation card becomes a
`ProposalCard` rendered *inside* an assistant bubble (`31` §4.1). Example chips remain.

## IPC changes
Add `chat:send`→`chat:delta`/`chat:done`, `chat:cancel`, `action:confirm`, `action:cancel`,
`settings:setApiKey`, `settings:clearApiKey`, `settings:validateApiKey` (all `guard()`-wrapped,
`32` §4). Move `speech:start/stop` onto `guard()` and delete dead `onFinal`/`voiceId`/`rate`/
`audio:ready`/`audio:error` plumbing (`30` D4, D8).

## Main Process changes
Replace `aiAssistEnabled: () => false` with a live, re-installable predicate (`30` D1, `32` §3.1).
Build `ConversationEngine`, `ActionDispatcher`, `pending-store`, provider `registry`. Implement
`safeStorage` key storage (write-only from renderer; `settings:get` still returns `hasApiKey`).

## Renderer changes
New `useConversation` hook owning `ChatMessage[]` + streaming lifecycle. `ChatScreen` rewrite.
`ProposalCard` calls `action:confirm({turnId})` instead of `ipc.createReminder` directly.

## Security changes
Fix D1 (the network-gating seam). safeStorage plumbing exists but **no provider uses the key yet**
(so the allowlist stays empty and the app stays offline). Confirm the pending-proposal invariant
(`36` §4.3) is enforced in main. Keep `settings:get` key-leak test green.

## Testing plan
- Unit: `AssistantTurnSchema`/action-schema parse+reject; local turn adapter (reminder vs chat);
  dispatcher gates; pending-store single-use/expiry.
- Integration: `chat:send` with a reminder text → proposal → `action:confirm` → row created +
  `reminders:changed`; `settings:setApiKey` then `settings:get` never leaks the key.
- **New renderer tests** (add a jsdom vitest project, `38`): MessageList append, ProposalCard
  Confirm/Cancel wiring.

## Manual testing
1. Launch LifeOS. **Expected:** opens on Chat with an empty conversation and a composer.
2. Type "remind me in 2 minutes to drink water", press Ask Yogi. **Expected:** an assistant
   bubble appears with a ProposalCard showing "Drink water · in 2 minutes · one-time" and
   Confirm/Cancel; nothing saved yet.
3. Press Confirm. **Expected:** card marks Confirmed; the reminder appears under Active Schedules;
   a "Done — I'll remind you…" assistant line follows.
4. Wait 2 minutes (window open or in tray). **Expected:** Windows notification fires + Yogi speaks
   (offline voice). Trigger modal offers Dismiss/Done/Snooze.
5. Type "Explain Docker". **Expected:** an assistant bubble says "Connect OpenAI in Settings to
   chat and answer questions." **No reminder created.**
6. Type "remind me at 6". **Expected:** a clarification bubble (AM/PM chips), **no Confirm button**.
7. Open a network monitor for a 5-minute session incl. a fired reminder. **Expected:** zero
   outbound packets.

## Edge cases
Empty input ignored; a proposal left unconfirmed for 90 s auto-cancels (`36` §4.1); mic failure
still lets you type; DB write failure surfaces a sanitised assistant error, no half-state;
`safeStorage` unavailable → key save refused with an explanation (session-only offered).

## Expected behaviour
Reminders work end-to-end through the new pipeline; chat/question are visibly "not yet enabled";
the app is 100% offline and passes the Wireshark check.

## Risks
- `RISK (med)` — rewriting `ChatScreen` regresses the working reminder flow. *Mitigation:* keep
  the local parser + `CreateReminderInput` + business rules unchanged; only the front-end and the
  call path change; cover with the new renderer tests.
- `RISK (low)` — dispatcher/pending-store bugs. *Mitigation:* unit tests on the invariant.

## Rollback plan
The phase is additive behind a feature flag `conversation_ui_enabled` (default on in the release,
off reverts to the old `ChatScreen`). If a blocker appears post-release, flip the flag; the
reminder repository/scheduler are untouched so no data risk.

## Definition of Done
Reminders create/confirm/fire through engine→dispatcher→execute; chat/question placeholder shows;
Wireshark-clean; key IPC exists and leaks nothing; D1 fixed; new renderer test project runs in CI;
typecheck/lint/tests green.

---

# Phase 2 — OpenAI Conversation (LLM)

## Goal
Make Yogi actually converse: `OpenAiLlmProvider` produces validated `AssistantTurn`s for chat,
questions, and reminder proposals, gated by key + per-feature consent + network allowlist.

## Why this phase exists
This is the product's headline: conversation as the primary experience (`31`). It is the first
phase that opens the network, so it carries the full consent/gating apparatus (`32`).

## Files affected
New: `electron/providers/openai/{llm-provider.ts, client.ts}`. Changed: `electron/main/session.ts`
(allowlist/CSP already parameterised — just exercised now), `electron/conversation/engine.ts`
(register the LLM provider + streaming), `src/features/settings/SettingsScreen.tsx` (OpenAI section,
`34`), `src/features/onboarding/OnboardingFlow.tsx` + copy (`34` privacy reconciliation).

## Architecture changes
`registry.makeLlmProvider` returns `OpenAiLlmProvider` when `ai_assist_enabled` + `hasApiKey` +
consent, else a null provider that yields the Phase-1 placeholder. Streaming via `chat:delta`
(`32` §5); full object re-validated with the four gates on completion (`31` §5).

## Database changes
None (keys exist: `ai_assist_enabled`, `ai_provider`, `ai_model`, `ai_consent_accepted_at`,
`ai_last_used_at`, `ai_key_ciphertext`). Write `conversations.assistant_response`/`intent` per turn.

## UI changes
Settings OpenAI section (enable, key field, Validate, consent modal). Streaming assistant bubbles.
Reminder proposals now can come from the LLM (e.g. "around sunset" → 7 PM with clarification, `09`).

## IPC changes
None new beyond Phase 1; `chat:*` now backed by a real provider. `settings:validateApiKey` performs
a live minimal call.

## Main Process changes
The OpenAI client (fetch in main, key at call time, dropped). Timeouts/failure degradation (`32` §5).
Consent enforced in main before any call (`32` §2).

## Renderer changes
Consume streamed deltas; render the consent modal; show "Last used" + provider status.

## Security changes
First real use of the allowlist branch (`api.openai.com` only, `32` §3.2). Verify: key never crosses
IPC; sensitive context (none yet) excluded; reminder summary sent is titles-only (`31` §4.3); the
`sk-` log redaction active. Re-run Wireshark: **off → zero; on → openai only**.

## Testing plan
Unit: turn validation gates incl. malicious/extra-key/past-date/unsafe-content (`09` §11);
payload-snapshot test that the request body contains no ids/DB content (`09` §11). Integration:
consent-absent → no fetch (`ConsentRequiredError`); 401 → degrade + banner. Manual below.

## Manual testing
1. Settings → OpenAI → enable, paste key, press Validate. **Expected:** "Key valid ✓".
2. Accept the consent modal (reads "your command text is sent to OpenAI"). **Expected:** chat enabled.
3. Type "Explain Docker". **Expected:** a natural streamed answer; **no reminder**.
4. Type "what's a good way to remember to call my mother every Sunday?" then "ok set that for 10am".
   **Expected:** a ProposalCard "Call mother · every Sunday 10:00 AM · weekly"; Confirm creates it.
5. Turn OpenAI off. Type "Explain Docker". **Expected:** the offline placeholder returns; Wireshark
   shows zero packets.
6. Enter an invalid key, ask a question. **Expected:** "Your API key was rejected" banner; reminder
   creation via local parser still works.

## Edge cases
Offline while enabled → local fallback + toast; timeout → fallback; model returns `unknown` intent →
graceful "I'm not sure I can help with that yet"; model proposes an unsupported RRULE → rejected by
Gate 2, local clarification.

## Expected behaviour
Conversation is fluid; reminders still gated by Confirm; every failure degrades to the offline app.

## Risks
- `RISK (high)` — a prompt-injected/hostile turn. *Mitigation:* the four gates + no-execution
  invariant (`31` §6, `36` §7); safety scan on all strings.
- `RISK (med)` — cost surprise if "always use OpenAI". *Mitigation:* default `ai_only_when_uncertain`
  guidance + the local spend estimate (`32` §6).

## Rollback plan
Master toggle `ai_assist_enabled=false` returns the app to Phase 1 behaviour instantly with no data
change. Provider registration is the only new coupling; a null provider is the fallback.

## Definition of Done
Chat/question answered by OpenAI when enabled+consented; all four gates enforced in main; Wireshark
off→zero/on→openai-only; consent + key-leak + payload-snapshot tests green.

---

# Phase 3 — OpenAI STT (batch)

## Goal
Add `OpenAiSpeechProvider` (batch transcription) behind `SpeechProvider`, with sherpa as the always-
present fallback, and adapt the live-transcript UI to `supportsPartials`.

## Why this phase exists
The brief wants more accurate speech than the small offline model. Cloud STT is the accuracy win —
but it sends microphone audio, so it is a distinct, separately-consented capability (`32` §2).

## Files affected
New: `electron/providers/openai/speech-provider.ts`. Changed: `electron/main/ipc/speech.ts` (route
through the provider seam + fallback decorator), `electron/providers/registry.ts`,
`src/hooks/useSpeech.ts` + `MicButton`/transcript strip (adapt to `supportsPartials`),
`src/features/settings/SettingsScreen.tsx` (STT provider select + consent, `34`).

## Architecture changes
`registry.makeSpeechProvider` (`33` §5) returns `withFallback(OpenAiSpeechProvider, () => Sherpa…)`
when `stt_provider==='openai'` + key + consent. Batch provider buffers frames in main, POSTs at
`stop()`, returns final text (`33` §2.1).

## Database changes
None (`stt_provider` exists; `stt_consented_at` from Phase 1).

## UI changes
When the active provider has `supportsPartials===false`, the live-transcript strip shows
"Transcribing…" then the final text, instead of ticking partials.

## IPC changes
None new; `speech:partial` simply won't fire on the OpenAI path. `speech:start` returns
`supportsPartials` so the renderer adapts (this field already exists on the contract).

## Main Process changes
Buffer audio in main (never disk), size/time-capped by the existing 30 s cap + 2 s silence stop;
drop the buffer immediately after the POST; fallback to sherpa on any error.

## Renderer changes
Read `supportsPartials` from `speech:start`; swap the strip behaviour.

## Security changes
The **cloud-STT consent** ("your voice recording is sent to OpenAI") shown before first use — the one
that reverses `09`'s "Audio, ever". Audio bounded, never persisted, dropped post-request (`33` §2.2).
Wireshark: with STT off, no audio egress even when chat is on.

## Testing plan
Unit: batch buffering + single POST shape; fallback decorator swaps on error. Integration:
consent-absent → sherpa used; oversized/silent input handled. Manual below.

## Manual testing
1. Settings → enable OpenAI STT, accept the "your voice is sent" consent. **Expected:** STT provider = OpenAI.
2. Press mic, say "remind me tomorrow at 9 to call Rahul", stop. **Expected:** strip shows
   "Transcribing…" then the accurate transcript fills the composer; a proposal follows.
3. Disable OpenAI STT. Repeat. **Expected:** live partials tick again (sherpa); still works.
4. Enable STT, go offline, use the mic. **Expected:** graceful fallback to sherpa or "couldn't reach
   the transcriber — try again or type"; composer never blocked.

## Edge cases
Network drop mid-utterance (audio already captured) → ask to repeat/type; empty transcription →
prompt to retry; very long utterance capped at 30 s.

## Expected behaviour
Higher accuracy when enabled; identical downstream flow; offline fallback intact.

## Risks
- `RISK (med)` — losing live partials feels laggy. *Mitigation:* clear "Transcribing…" affordance;
  keep sherpa the default so partials are the out-of-box experience.

## Rollback plan
`stt_provider='sherpa-onnx'` reverts instantly; the fallback decorator means even a broken OpenAI
provider degrades rather than breaks.

## Definition of Done
OpenAI STT works + falls back to sherpa on any failure; consent enforced; no audio persisted; UI
adapts to `supportsPartials`; Wireshark shows no audio egress with STT off.

---

# Phase 4 — OpenAI TTS + Voice System

## Goal
Add cloud voices via `OpenAiTtsProvider`, build the **new `audio:playBytes` path** (`33` §3.1), and
ship the voice picker + Preview (`35`), finally threading `voiceId`/`rate` through the dead plumbing.

## Why this phase exists
Better, more natural voices are a headline of the brief, and TTS + voice selection share the audio-
bytes path — the single hardest migration piece. Doing them together builds that path once.

## Files affected
New: `electron/providers/openai/tts-provider.ts`, `core/tts/voice-catalog.ts` (friendly↔provider map,
`35`). Changed: `src/audio-host.ts` (+`onPlayBytes`/blob playback; stop ignoring `voiceId`/`rate`),
`electron/preload/audio.ts` (+`audio:playBytes`, +`audio:playbackError`), `electron/scheduler/trigger-sink.ts`
(send `voiceId`/`rate`; route audio-bytes providers), `electron/providers/registry.ts`,
`src/features/settings/*` (Voice section + Preview, `35`).

## Architecture changes
`TextToSpeechProvider.speak` returns `in-window` (web-speech) or `audio-bytes` (OpenAI). For audio-
bytes, main fetches the audio (key stays in main), then `send('audio:playBytes', {mime, bytes})`;
the audio window plays it from a `blob:` URL (`33` §3.1). Fallback OpenAI→Windows→silent (`33` §3.2).

## Database changes
None (`tts_provider`, `tts_voice_id`, `tts_rate`, `tts_degraded` all exist; now read). Store the
selected friendly voice key + resolved provider id (`35`).

## UI changes
Voice section: provider-aware voice dropdown with friendly labels, rate slider, **Preview / Play
Sample** button ("This is Yogi. Nice to meet you."). Degrade Preview when no voices/key/offline.

## IPC changes
New main→audio `audio:playBytes`; audio→main `audio:playbackError` (wires the previously-dead
surface, `30` D8). New `tts:preview` invoke to play a sample through the active provider (`35`).

## Main Process changes
OpenAI TTS fetch in main; byte-size cap (≤ ~2 MB/utterance); route through the fan-out's `safely()`
(never fatal, `30` §2.4); set `tts_degraded` on fallback and surface once.

## Renderer changes
Voice picker consuming `voice-catalog`; Preview flow (renderer → `tts:preview` → main → provider →
`audio:playBytes`/in-window).

## Security changes
Audio window still refuses paths/URLs — it accepts **bytes** and plays a same-origin `blob:` only
(`16` §7 preserved). Key in main. **TTS consent** ("the text Yogi speaks is sent to OpenAI") before
first cloud-voice use.

## Testing plan
Unit: friendly↔provider voice mapping; `speak()` returns the right `kind`; byte cap. Integration:
audio-bytes path plays without a filesystem read; fallback on provider error. Manual below.

## Manual testing
1. Settings → Voice → provider OpenAI, pick "Warm Female (nova)", press Preview. **Expected:** hear
   "This is Yogi. Nice to meet you." in that voice; a tiny disclosed API cost.
2. Create a reminder 1 min out, close to tray. **Expected:** at fire time Yogi speaks the title in the
   selected OpenAI voice; notification still fires first.
3. Switch to a Windows voice, Preview. **Expected:** offline voice plays; no network.
4. Enable OpenAI TTS, go offline, fire a reminder. **Expected:** notification fires; Yogi falls back to
   the Windows voice (or silent); a one-time "using Windows voice" notice; reminder never blocked.

## Edge cases
Zero Windows voices AND no key → Preview disabled with a link to Windows speech settings; oversized
synthesis truncated; audio window dead → notification-only (self-heal cap, `30` §2).

## Expected behaviour
Natural cloud voice when enabled; instant offline voice otherwise; speech never blocks a reminder.

## Risks
- `RISK (med)` — the new audio-bytes path is the riskiest change; a bug could break spoken reminders.
  *Mitigation:* it is best-effort inside `safely()`; notification+history are unconditional and first
  (`30` §13.4); extensive fallback tests.
- `RISK (low)` — TTS latency on the fire path. *Mitigation:* synthesize the reminder title (short);
  fall back fast on timeout.

## Rollback plan
`tts_provider='web-speech'` reverts to the current behaviour; the `audio:playBytes` path is simply
unused. No data change.

## Definition of Done
OpenAI + Windows voices selectable with friendly labels; Preview works on both; reminders speak in the
chosen voice; `voiceId`/`rate` threaded (dead plumbing removed); fallback never blocks a reminder;
bytes-not-paths preserved.

---

# Phase 5 — Voice Confirmation + Dispatcher Generalization

## Goal
Let the user confirm proposals by voice ("yes"/"no"), and generalize the Action Dispatcher to all
data-modifying intents (settings changes now; memory later) with the pending-proposal invariant.

## Why this phase exists
Voice confirmation is a natural completion of the conversational reminder flow, and generalizing the
dispatcher (`36`) is what lets later phases (memory) add intents without touching the gate.

## Files affected
New: `core/actions/confirm-phrases.ts` (closed yes/no set), `electron/actions/voice-confirm.ts`.
Changed: `electron/actions/dispatcher.ts` (settings actions), `electron/conversation/engine.ts` (route
a pending-proposal transcript to the matcher), `src/features/chat/ProposalCard.tsx` (voice hint +
countdown), `SettingsScreen.tsx` (the `settings` LLM action surface).

## Architecture changes
While a proposal is pending, a finalized STT transcript is first checked against the local yes/no
matcher (`36` §4.1) **before** going to the LLM — a match confirms/cancels the stored proposal; a
non-match is treated as a new turn. Timeout = cancel (`36` §4.1).

## Database changes
None.

## UI changes
ProposalCard shows "Say 'yes' to confirm" + a countdown; settings changes render an inline "Done ✓ ·
Undo".

## IPC changes
None new (reuses `action:confirm`/`action:cancel`; the matcher runs in main off the existing
`speech:stop` final text).

## Main Process changes
`voice-confirm` matcher (never sent to the LLM, `36` §4.1). Dispatcher handles `SettingsAction`
against the closed safe-settings union (`31` §3, `36` §5).

## Renderer changes
Countdown + voice hint on ProposalCard; optimistic settings apply with Undo.

## Security changes
The matcher is a fixed local phrase list — a prompt-injected model cannot turn "no thanks" into a
confirm (`36` §4.1). Settings action limited to the closed user-safe subset; never keys/consent
(`36` §5). Pending-proposal single-use invariant covers voice confirms too.

## Testing plan
Unit: yes/no/ambiguous matching; settings action validation rejects non-safe keys. Integration:
voice-confirm executes the stored proposal, not a renderer payload; timeout cancels. Manual below.

## Manual testing
1. Say "remind me tomorrow at 9 to call Rahul". **Expected:** ProposalCard + "Say 'yes' to confirm".
2. Say "yes". **Expected:** reminder created; appears in Active Schedules.
3. Repeat; say "no". **Expected:** proposal cancelled; nothing saved.
4. Repeat; say nothing for 90 s. **Expected:** proposal auto-cancels (safe).
5. Say "switch to dark mode". **Expected:** theme flips with an inline "Done ✓ · Undo"; press Undo →
   reverts.
6. Say "delete my API key". **Expected:** refused — the LLM cannot touch key/consent settings.

## Edge cases
Ambiguous "maybe later" → neither; multiple pending proposals → only the newest is voice-addressable;
overlapping speech + button confirm → single-use store prevents double execution.

## Expected behaviour
Hands-free confirmation works; safe settings changeable by voice; dangerous settings unreachable.

## Risks
- `RISK (med)` — false-positive voice confirm. *Mitigation:* strict closed phrase set; require a clear
  affirmative; timeout is cancel, not confirm.

## Rollback plan
Disable voice confirmation via `voice_confirm_enabled=false` (buttons still work). Settings-action
routing can be feature-flagged off, reverting settings to UI-only.

## Definition of Done
Voice yes/no confirms/cancels the stored proposal; timeout cancels; safe settings actions work; unsafe
ones refused; matcher never consults the LLM; single-use invariant holds under voice+button races.

---

# Phase 6 — Memory Foundation (release v0.6 per `39`; `24`'s memory tier)

## Goal
Adopt the existing `memories` table for save/recall with the confirmation gate, FTS5 retrieval, and a
"What do you remember about me?" screen that ships **before** any save path.

## Why this phase exists
The brief's memory examples ("my grandfather has diabetes" → offer to save → later recall). `24`
sequences this as v0.3; the schema already exists (`10`, `30` §3.2).

## Files affected
New: `electron/database/memory-repository.ts`, migration `003_memory_fts.sql` (FTS5 virtual table),
`src/features/memory/MemoryScreen.tsx`. Changed: `core/conversation/action-schemas.ts` (already has
memory actions), `electron/actions/{dispatcher,execute}.ts` (memory branches),
`electron/conversation/engine.ts` (include non-sensitive memories in context, `31` §4.3),
`src/app/App.tsx` (nav entry).

## Architecture changes
`memory_save` is data-modifying → Confirmation Layer (`36` §4.2); `memory_query` is read-only →
execute + reply. FTS5 for retrieval (`24`: FTS5 first, embeddings only on a demonstrated failure).
`source='user_confirmed'` is the only value ever written (`10`).

## Database changes
Migration 003: an FTS5 virtual table mirroring `memories(subject, fact)` with triggers to keep it in
sync. (The base `memories` table already exists from migration 002.) Forward-only.

## UI changes
A "Memory" screen listing stored facts with per-row delete and the **verbatim source utterance** +
date (`24`). Memory-save proposals appear as ProposalCards ("Remember: your grandfather has diabetes?").

## IPC changes
`memory:list`, `memory:delete` (guard()-wrapped); saves/queries flow through the existing
`action:confirm`/engine.

## Main Process changes
`MemoryRepository` (parameterized, FTS5 query for recall). `is_sensitive` derived
(`category ∈ {health,family} ⇒ 1`), and sensitive memories are **redacted from logs and never placed
in the LLM context window** (`31` §4.3, `10`).

## Renderer changes
Memory screen; memory ProposalCard variant.

## Security changes
Sensitive facts never leave the device (not even to OpenAI). The "What do you remember?" screen exists
before any save. Per-row delete always visible. Same confirmation gate as reminders.

## Testing plan
Unit: FTS5 recall ("grandfather"+"health"); is_sensitive derivation; sensitive-excluded-from-context
snapshot test. Integration: save proposal → confirm → row + FTS row; query → recall with source.
Manual below.

## Manual testing
1. Open Memory screen. **Expected:** empty state with an explanation of how memory works.
2. Say "my grandfather has diabetes". **Expected:** ProposalCard "Remember: grandfather — has diabetes
   (health)?"; nothing stored yet.
3. Say/press "yes". **Expected:** stored; appears on the Memory screen with the source utterance + date,
   flagged sensitive.
4. Later, ask "what health condition does my grandfather have?". **Expected:** Yogi recalls "diabetes"
   and shows the source; the fact was **not** sent to OpenAI (verify via the context snapshot/log).
5. Delete the memory from the Memory screen. **Expected:** gone; recall no longer returns it.

## Edge cases
Duplicate facts → update not duplicate; recall miss → "I don't have anything about that"; a health fact
must never appear in an outbound payload (asserted).

## Expected behaviour
Opt-in, confirmed, inspectable memory; sensitive data stays local.

## Risks
- `RISK (high)` — leaking a sensitive memory to the cloud. *Mitigation:* context-window builder excludes
  `is_sensitive=1`; a payload-snapshot test fails the build if a sensitive fact appears.

## Rollback plan
Feature-flag `memory_enabled=false` hides the screen and refuses memory intents in the dispatcher
(availability decided by the app, `31` §2). Migration 003 is additive and inert if unused.

## Definition of Done
Save (confirmed) + recall (FTS5) work; Memory screen with source + delete; sensitive-never-sent proven
by test; availability gated in main.

---

# Phase 7 — Research Foundation (release v0.7 per `39`; `24`'s research tier)

## Goal
Introduce the `ResearchProvider` interface and ship **Weather via Open-Meteo** as the first provider;
scaffold (architecture only) the rest with strong medical/legal disclaimers.

## Why this phase exists
The brief's research examples (weather, documents, comparisons). `24` sequences this as v0.5 and defines
the `ResearchProvider` interface; weather (Open-Meteo, no key) is the safe first step.

## Files affected
New: `core/research/research-provider.ts` (from `24`), `electron/providers/research/open-meteo.ts`,
`electron/actions/execute.ts` (research branch). Changed: `session.ts` (allowlist +
`api.open-meteo.com` when the weather provider is enabled), `SettingsScreen.tsx` (Research section +
per-provider consent).

## Architecture changes
`research` is read-only → execute + reply (no confirmation gate, but a network provider needs its own
consent + allowlist entry — "consent is not transitive", `24`). Weather resolves a location + returns a
summary the engine turns into a reply.

## Database changes
None (optionally cache last weather locally; no schema change needed for MVP).

## UI changes
Research section in Settings (enable Weather, disclosure). Research answers render as normal assistant
bubbles, with a source line.

## IPC changes
None new (research flows through the engine/dispatcher); Settings toggles via `settings:update`.

## Main Process changes
`OpenMeteoResearchProvider.answer(query)`; allowlist gains `api.open-meteo.com` **only** when the
weather provider is enabled; per-provider consent enforced in main.

## Renderer changes
Research settings + disclosure; source attribution in replies.

## Security changes
Each network research provider is individually consented, disclosed, and added to the allowlist/CSP
**only when enabled** (`24`). Medical/legal providers (scaffold only) carry the `24` disclaimer rules —
never present as professional advice, always cite, always recommend a professional.

## Testing plan
Unit: Open-Meteo query building + response→summary; allowlist gated by the weather toggle. Integration:
weather off → request blocked; on → api.open-meteo.com only. Manual below.

## Manual testing
1. Ask "what's today's weather?" with Weather disabled. **Expected:** "Enable Weather in Settings to let
   me check that"; no network.
2. Enable Weather (accept disclosure), ask again. **Expected:** a current forecast reply with an
   Open-Meteo source line; Wireshark shows traffic to `api.open-meteo.com` only.
3. Ask "do I have dengue?" (medical). **Expected:** a refusal-with-disclaimer, recommending a
   professional — never a diagnosis (`24`).

## Edge cases
Unresolvable location → ask for a city; provider down → "couldn't reach the weather service"; medical/
legal queries always hit the disclaimer path.

## Expected behaviour
Weather works when enabled+consented; other research is clearly "not yet"; medical/legal safe by design.

## Risks
- `RISK (med)` — scope creep into unbounded web research/advice. *Mitigation:* ship only Weather;
  everything else is interface-only; disclaimers enforced.

## Rollback plan
Disable the Research section; each provider is independently toggleable; the interface is inert when no
provider is enabled.

## Definition of Done
`ResearchProvider` interface exists; Weather (Open-Meteo) works behind its own consent + allowlist entry;
medical/legal disclaimer path enforced; other providers scaffolded only; Wireshark shows only the enabled
provider's origin.

---

## Cross-phase notes

- **Every phase re-runs the Wireshark check** appropriate to its network posture; "off → zero" must
  hold at every release (`11` §14 SEC-10).
- **Every phase adds tests to the layer it touches** (`38`), including the renderer/IPC/speech layers
  that are untested today (`30` §10) — closing that gap is part of each phase's DoD, not deferred.
- **The confirmation gate and "LLM proposes / app executes" are invariant across all phases** (`30`
  §13, `31` §6, `36` §7). No phase weakens them.
- **Release versions are owned by `39`** (not this doc): P1→v0.2, P2→v0.3, P3+P4→v0.4, P5→v0.5,
  P6→v0.6, P7→v0.7, then Ollama v0.8 and v1.0 earned. These phases continue the current 0.x
  line (the app is v0.1 today); "v2" in this doc's title is the *product generation* label
  (conversational Yogi), not a release number.
