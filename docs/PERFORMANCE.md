# Performance, Privacy & Reliability

> **Home:** [docs/README.md](./README.md) · **Related:** [ARCHITECTURE](./ARCHITECTURE.md) · [VOICE_PIPELINE](./VOICE_PIPELINE.md)

This page covers the non-functional properties: latency, memory, offline behavior, privacy guarantees, and the reliability model. These are the "results & impact" of the architecture.

## 1. Latency & responsiveness

| Path | Behavior |
| --- | --- |
| **Offline STT (sherpa)** | Streaming with live partials; RTF ~0.07 (decodes far faster than real time). Runs on the main thread. |
| **Cloud STT (OpenAI batch)** | +~0.5–1.5 s per dictation (network round-trip); no partials ("Transcribing…"). Falls back to sherpa on failure. |
| **LLM chat** | `gpt-4o-mini`, non-streaming; bounded by a **20 s** turn deadline (`CHAT_TIMEOUT_MS`) + one 429/5xx retry. |
| **Web search** | Bounded by a **35 s** deadline (`SEARCH_DEADLINE_MS`); the provider adds its own 30 s timeout. |
| **TTS (cloud)** | **Streamed** via Media Source Extensions so playback starts on the first bytes — not after the whole clip. Blob fallback if MSE can't take the mime. |
| **TTS (offline)** | OS `speechSynthesis`, immediate. |
| **Reminder firing** | Wall-clock reconcile every **30 s**; a create nudges an immediate reconcile so a near-due reminder isn't up to a tick late. |
| **Local commands** | Time/date/greeting/settings answered with **no LLM** — instant. |

## 2. Memory & footprint

- **Idle RAM** ~200 MB in the tray (Electron baseline — accepted per ADR-001; NFR budget was 250 MB).
- **Installer** ~150 MB (Electron + the ~68 MB STT model). GitHub Releases caps assets at 2 GiB — no distribution problem.
- **Context is bounded**: the LLM sees a sliding window of 12 turns and at most 20 reminder summaries, so cost/latency stay flat regardless of total history.
- **Gmail storage** is capped by `gmail_max_stored` (1000/5000/unlimited) with a prune step.

## 3. Offline capability (what works with zero network)

With **no API key**, a default-deny network filter blocks every outbound request. Fully functional offline:

- Natural-language **reminders** (create, confirm by click or voice, schedule, fire, recurrence, snooze, lifecycle).
- **Notifications + spoken reminders** (Windows voices).
- **Local commands**: time, date, greeting, help, "open settings", "show schedules".
- **Speech-to-text** (sherpa) and **text-to-speech** (Windows).
- Schedules, History, Settings, tray, theme, reset.

Only genuine reasoning / live-fact lookups need the cloud, and they degrade to an **honest notice** rather than failing silently.

## 4. Privacy properties (enforced in code)

| Guarantee | Mechanism |
| --- | --- |
| **Zero outbound with cloud off** | `session.ts` `onBeforeRequest` cancels any request not on the allowlist; allowlist is empty except `api.openai.com` (and only when a cloud feature is enabled + keyed + consented) |
| **Secrets never leave main** | OpenAI key + Gmail tokens/secret are `safeStorage`/DPAPI ciphertext in `settings`, decrypted only in main, excluded from `getAllSafe`; only `hasApiKey`/presence booleans cross IPC |
| **Model can't exfiltrate data it wasn't shown** | The reminder summary sent to the LLM is **titles + relative time only** (no ids, no epochs) |
| **Consent can't be faked** | AI/STT/TTS consent timestamps are written in main, not by the renderer |
| **No remote code / navigation** | CSP `script-src 'self'` (no `unsafe-inline`/`unsafe-eval` in prod); navigation locks; `window.open` denied except two exact URLs; no `<webview>` |
| **Sensitive memory flag** | `memories.is_sensitive` is designed to keep health/family facts out of any cloud prompt (memory itself is not built yet) |
| **Reset revokes cloud grants** | Reset best-effort revokes the Google OAuth grant server-side before wiping |

## 5. Reliability model

**The core invariant** (`electron/scheduler/trigger-sink.ts`): in the trigger path, **notification + history are unconditional and fire first**, outside any try. TTS, audio, the popup, chat-delivery, and AI-task execution are each best-effort and individually wrapped — a throw in any of them **cannot** prevent the toast. *A silent reminder is still a reminder; a missed reminder is a bug.*

Supporting reliability mechanisms:
- **Wall-clock scheduling** avoids the 24.8-day `setTimeout` trap and survives sleep (`powerMonitor` resume/unlock reconcile).
- **Missed-while-closed policy**: one-time missed → honest `missed` + OverdueModal; recurring → rolled forward (no alarm storm).
- **Verify-on-persist**: `persistReminder` reads the row back and requires a `next_fire_at` before success can be claimed.
- **Reliability guard**: a fabricated "I set a reminder" is rewritten into an honest failure.
- **Single `chat:done` per turn**, even on a throw — the composer never hangs.
- **Transparent provider fallback**: cloud STT → sherpa; cloud TTS → Windows; LLM/search failure → honest message.
- **Startup catch-up** for both reminders and Gmail (suppressed delivery burst so a relaunch after a backlog doesn't spam).

## 6. Scalability & portability

- **Single-user, single-device** by design (no server). Scaling means multi-device sync — explicitly a *future* decision ("the decision that ends 'no server'"), gated on optional E2EE.
- **`core/` is pure TypeScript** with zero Electron/Node imports, so a Tauri port (smaller/lighter) or a mobile target would rewrite only `electron/`. This is the reversibility ADR-001 preserves.
- **Provider seams** mean adding a local LLM (Ollama) or a second search backend is a registry entry, not a rewrite.

## 7. Known performance/robustness caveats

- **STT decode on the main thread** (fast, but a worker would isolate it under load).
- **No streaming LLM** yet — long answers arrive whole (a **Planned** upgrade; `chat:delta` reserved).
- **10-minute idle-in-tray TTS endurance** hasn't been re-measured on the v2 build.
- **Packaged v2** hasn't had a fresh-VM QA pass — the top robustness unknown. See [ROADMAP](./ROADMAP.md).
- **Unsigned installer** → Windows SmartScreen warning (availability, not security).
