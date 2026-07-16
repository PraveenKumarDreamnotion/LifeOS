# Testing

> **Home:** [docs/README.md](./README.md) · **Related:** [DEVELOPMENT_GUIDE](./DEVELOPMENT_GUIDE.md)

LifeOS is tested with **Vitest**: **523 tests across 55 files** (40 unit + 14 integration + 1 renderer). The design that makes this cheap: `core/` is pure (no Electron/Node), and the services take injected dependencies (clock, providers, windows), so state machines and pipelines run without a real Electron harness.

## 1. Running tests

```bash
npm test                # all (vitest run)
npm run test:unit       # tests/unit
npm run test:integration # tests/integration
npm run typecheck       # tsc node + web (no emit)
npm run lint            # eslint
```

Config: `vitest.config.ts` — `environment: 'node'` by default; **jsdom only** for `tests/renderer/**` (via `environmentMatchGlobs`); `@core` alias; `@vitejs/plugin-react` for the renderer test.

## 2. Test-count reconciliation

The headline **523 / 55** reconciles like this (a static count expands parameterized blocks):

| | Files | Static `it`/`test` | Runtime cases |
| --- | --- | --- | --- |
| unit | 40 | 315 | 370 |
| integration | 14 | 112 | 143 |
| renderer | 1 | 10 | 10 |
| **total** | **55** | **437** | **523** |

The +86 runtime cases come from three data-driven blocks: `parse-reminder.test.ts` (`describe.each` over **56** `commands.json` fixtures), `offline-phrases.test.ts` (4 `it.each` phrase arrays = 31 cases), and `reminder-lifecycle.test.ts` (`it.each` = 5 cases).

## 3. What's covered

### Unit (40 files) — pure logic, providers, state machines
- **Parsing:** `parse-reminder` (56 fixtures), `normalize-reminder`, `next-occurrence`, `classify-execution`, `local-intent`.
- **Conversation:** `conversation-engine` (24 cases — routing, offline, mis-tag guard, reminder-claim guard, research-forces-search), `context-builder`, `turn-schema`, `chat-turn-service`.
- **Actions:** `dispatcher`, `confirmation-store`, `voice-confirm-matcher`, `popup-lifecycle-matcher`.
- **Voice:** `desktop-voice-controller` (25 cases — the whole launcher state machine), `reminder-popup` (queue/lifecycle), `vad`, `transcript-cleanup`, `voice-catalog`, `reminder-speech`.
- **Providers:** `registry` (gating), OpenAI llm/tts/speech/search, `deepgram`, `whisper-cpp` providers.
- **Scheduling/trigger:** `trigger-sink`, plus `scheduler` in integration.
- **Platform:** `api-key-store`, `typed-settings`, `reset-guard`, `reset-service`, `session-policy`.
- **Gmail:** `gmail-oauth` (PKCE S256 RFC vector), `gmail-token-store`, `gmail-provider-parse`, `gmail-provider-retry`, `gmail-summary`, `gmail-sync-scheduler` (12 cases).

### Integration (14 files) — real SQLite, real objects
- **Scheduler & lifecycle:** `scheduler`, `reminder-lifecycle` (create→confirm→persist→schedule→**fire**, survives DB reopen), `reminder-execution-flow`.
- **Byte-identical write:** `dispatcher-byte-identical` (the dispatcher path produces the same row as the direct path).
- **Offline:** `offline-routing`, `offline-wiring` (real DB, no key, real provider gate), `offline-phrases` (the user's exact phrase list — incl. STT-corrupted — never hits the AI notice).
- **Persistence:** `reminder-repository`, `chat-repository`, `migrations` (every M006–M008 table + ALTERs).
- **Gmail:** `gmail-repository`, `gmail-connect-flow` (connect→refresh→invalid_grant→disconnect with revoke asserted, mocked Google), `gmail-sync-engine` (initial/incremental/recovery/dedup/delete/label/notify), `gmail-email-delivery` (16 cases — dedup, one notify + one TTS, research pass).

### Renderer (1 file) — jsdom
- `useConversation.test.tsx` (10 cases — the message model, live mirror, placeholder resolution).

## 4. What is NOT covered by automated tests

The standing **HARD GAP**: anything requiring a real Windows GUI, live microphone, audio playback, live Google credentials, or an inbound email cannot be exercised in CI here. Verified **by construction** (unit tests + code trace), not by observation:

- The physical launcher/popup window render, the ✕ click, the on-screen chat switcher.
- Live microphone capture and audible TTS (the "can I hear Yogi from the launcher?" check).
- The real Google OAuth browser round-trip and desktop notifications.
- A real research-worthy email → real paid web search.
- The packaged-app Task Manager name (verified once on disk: `release/win-unpacked/LifeOS.exe`).

These are the manual-verification items in `docs/lifeos-planning/gmail-integration.md §10` and the status-doc "HARD GAP" notes.

## 5. Test philosophy (worth copying)

- **Inject dependencies** (clock, providers, windows) so time-, network-, and window-dependent logic is deterministic — see `scheduler.ts`, `desktop-voice/controller.ts`, `reminder-popup.ts`.
- **Real objects over mocks in integration** — `offline-wiring`/`reminder-lifecycle` build the production object graph on a real SQLite DB to prove the wiring, not just units.
- **Adversarial fixtures** — `offline-phrases` asserts STT-corrupted phrasings ("IT REMAINED ME IN ONE MINUTE") route correctly.
- **Regression on every fix** — the changelog shows tests added lock-step with each bug fix (e.g. the reminder false-success guard, research-forces-search).

## 6. Adding a test

- Pure logic → `tests/unit/<name>.test.ts` (node env).
- A flow across real repos/engine → `tests/integration/` (open a real DB via `openDatabase(':memory:')`-style helpers).
- A renderer hook/component → `tests/renderer/<name>.test.tsx` (jsdom + Testing Library).

Keep `core/` tests DOM-free (they run under the node tsconfig).
