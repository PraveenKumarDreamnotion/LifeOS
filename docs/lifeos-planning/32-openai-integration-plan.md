# 32 — OpenAI Integration Plan

> **Scope:** how OpenAI is used for the three cloud capabilities — **chat/LLM**, **speech-to-
> text**, and **text-to-speech** — and, more importantly, how introducing them is reconciled
> with LifeOS's two load-bearing promises: **"zero network by default"** (enforced in code,
> `session.ts` default-deny, `30` §7) and **"audio never leaves the device"** (`09`: *Never
> sent — Audio, ever*).
>
> **The headline decision (`30` §11.3):** the brief says "default STT/TTS = OpenAI." Taken
> literally that reverses both promises for every user at install. Instead:
>
> > **"Default" means "preferred *once the user has enabled OpenAI, saved a key, and
> > accepted the per-feature consent*." Out of the box, with no key, LifeOS is exactly the
> > offline app it is today.** Cloud is opt-in, per-feature, revocable, and never the only
> > path.
>
> This is not a hedge — it is the only reading consistent with the shipped codebase and with
> `24`'s "consent is not transitive." If the owner genuinely wants cloud-on-at-install, that
> is a one-line default change here, but it must be a conscious product decision, not a
> silent one.

---

## 1. What OpenAI is used for

| Capability | Endpoint | Model (default, in settings) | Transport | Replaces / augments |
| --- | --- | --- | --- | --- |
| **Conversation / intent** | `POST /v1/chat/completions` (Structured Outputs) | `gpt-4o-mini` | request/response, optional stream | new (the Conversation Engine, `31`) |
| **Speech-to-text** | `POST /v1/audio/transcriptions` | `gpt-4o-mini-transcribe` | **batch** | augments sherpa (`33` §2) |
| **Text-to-speech** | `POST /v1/audio/speech` | `gpt-4o-mini-tts` | returns audio bytes | augments Windows voices (`33` §3, `35`) |

`VERIFIED FACT` (from `06`/`07`/`09` research, July 2026): `gpt-4o-mini` ≈ $0.15/$0.60 per 1M
in/out tokens; `gpt-4o-mini-transcribe` ≈ $0.003/min; `gpt-4o-mini-tts` token-based ≈ a few
cents per thousand characters. **LifeOS's own operating cost stays ₹0** — the user brings
their own key and OpenAI bills them directly (`09` §8). LifeOS never proxies, never holds a
shared key, never sees a bill.

All three model names live in `settings` so they can change without a release (`09` §4).

---

## 2. The offline-first reconciliation (the core of this doc)

Three independent gates must **all** be true before any OpenAI request is even attempted, and
they are checked in **main**, never trusted from the renderer (`09` §3, `11` §8):

```text
cloud STT/TTS/chat runs  ⇔   provider_enabled            (per-feature setting)
                         AND  safeStorage has a key       (hasApiKey())
                         AND  per-feature consent accepted (stt_consented_at / tts_consented_at
                                                            / ai_consent_accepted_at present)
```

If any gate is false, the corresponding **offline provider** runs (`33` §5): sherpa for STT,
Windows voices for TTS, the local deterministic parser for reminders, and a plain "assistant
unavailable" notice for open chat/questions. **The app is never worse than the offline MVP.**

`MVP DECISION` — Consent is **per feature**, not global. Enabling cloud *chat* does not send
your *audio*; enabling cloud *voice* (TTS) sends only the assistant's reply text to be
synthesised, not your microphone. Three separate consents, three separate disclosures,
because they leak three different things (`24`: "consent is not transitive").

| Feature | What leaves the device when enabled | Disclosure headline |
| --- | --- | --- |
| Chat/intent | your typed/transcribed **command text** + a titles-only reminder summary | "Your command text is sent to OpenAI." |
| Cloud STT | your **microphone audio** for the current utterance | "Your voice recording is sent to OpenAI to transcribe." ← the strongest one |
| Cloud TTS | the **text Yogi is about to speak** (usually a reminder title or reply) | "The text Yogi speaks is sent to OpenAI to generate the voice." |

The cloud-STT disclosure is called out explicitly in the consent modal because it is the one
that reverses `09`'s "Audio, ever" rule. The user must actively accept that sentence.

---

## 3. Network, CSP, and consent enforcement (extending `11`, fixing `30` D1)

### 3.1 Fix the dead seam first (prerequisite)

`30` D1: `index.ts` installs session security with `aiAssistEnabled: () => false`, so the
OpenAI allowlist branch is unreachable. **Before any OpenAI feature can work**, session
security must be bound to the real settings and **re-installable on change**:

```ts
// main — replace the () => false probe with a live predicate
const cloudEnabled = () =>
  settings.get('ai_assist_enabled') === 'true' ||
  settings.get('stt_provider') === 'openai' ||
  settings.get('tts_provider') === 'openai';
installSessionSecurity(cloudEnabled);
// and re-run buildCsp / re-evaluate on settings:changed so a toggle takes effect
// on the next request without a restart.
```

### 3.2 Extend the allowlist and CSP — deliberately, reversibly

`session.ts` `isAllowedOrigin` and `buildCsp` gain **one** origin, gated on the same
predicate:

```ts
// onBeforeRequest allow-branch:
if (cloudEnabled() && url.origin === 'https://api.openai.com') return callback({});
// buildCsp connect-src (packaged):
connect-src 'self' https://api.openai.com     // only when cloudEnabled()
```

`MVP DECISION` — Still **exactly one** external origin. No CDN, no telemetry host, nothing
else. When every cloud feature is off, the allowlist is empty again and the Wireshark test
(`11` §14 SEC-10) still passes: *zero outbound packets with cloud off.* That test remains the
product's headline proof and is re-run for v2.

`FUTURE OPTION` — OpenAI Realtime STT would add `wss://api.openai.com` to `connect-src`; not
in the first cut (`33` §2.1).

### 3.3 The key never crosses IPC; all calls happen in main

Unchanged from `09` §7 / `11` §10, now applied to all three capabilities:
- Key stored via `safeStorage` (DPAPI), `ai_key_ciphertext`, base64. If
  `safeStorage.isEncryptionAvailable()` is false → refuse to persist, offer session-only
  memory, never write plaintext.
- `settings:get` returns `hasApiKey: boolean`, never the value (`16` §6). **New** IPC
  `settings:setApiKey` / `settings:clearApiKey` / `settings:validateApiKey` are added (they
  do **not** exist today — `30` §12) — write-only from the renderer's view.
- Every OpenAI `fetch` runs in **main**, reads the key at call time, passes it to the
  `Authorization` header, and drops it. Never logged, never in an error, never in `app_logs`
  (the `sk-` redaction in `logger.ts` stays as defence in depth).

---

## 4. IPC surface added for OpenAI/conversation

New channels (all through `guard()` — `16` §5, and consolidating the speech path onto
`guard()` per `30` D4):

| Channel | Kind | Payload → Returns | Validation |
| --- | --- | --- | --- |
| `chat:send` | invoke | `{ text }` → `{ turnId }` (reply streams via broadcast) | `z.string().trim().min(1).max(4000)` |
| `chat:delta` | broadcast | `{ turnId, delta }` | — (main → renderer) |
| `chat:done` | broadcast | `{ turnId, message, proposal? }` | — |
| `chat:cancel` | invoke | `{ turnId }` → `void` | uuid |
| `settings:setApiKey` | invoke | `string` → `void` | `z.string().trim().min(20).max(200)` |
| `settings:clearApiKey` | invoke | — → `void` | none |
| `settings:validateApiKey` | invoke | — → `{ valid: boolean }` | none (uses stored key) |
| `action:confirm` | invoke | `{ turnId }` → `Result<...>` | uuid (`36` §4) |
| `action:cancel` | invoke | `{ turnId }` → `void` | uuid |

`chat:delta`/`chat:done` mirror the proven `speech:partial` streaming pattern the app
already uses for STT (`31` §5) — the assembled `chat:done` object plays the role that STT's
`stop()` return value does, so the dead `speech:final` broadcast (`30` D8) is not a model here. The renderer never receives raw model JSON — only the
validated `reply` text (streamed) and, on `chat:done`, a display-ready `proposal` (`31` §4.1).

---

## 5. Streaming, timeouts, and failure handling

- **Streaming reply:** `OpenAiLlmProvider.stream()` (`33` §4) forwards token deltas to
  `chat:delta`; the full response is still assembled and **re-validated** with
  `AssistantTurnSchema` on completion. Streaming is a UX nicety; validation is on the whole
  object, after the stream ends. If Structured Outputs + streaming interact awkwardly, the
  fallback is non-streamed `complete()` — the interface allows both.
- **Timeouts (`09` §6):** chat 20 s, STT 15 s, TTS 10 s. Exceed → abort, degrade to the
  offline provider, one non-modal notice.
- **Failure table (extends `09` §6):**

| Failure | Behaviour |
| --- | --- |
| No network / offline | Skip; offline provider; toast "Yogi's online features need a connection." |
| 401 invalid key | Offline provider; Settings banner "Your API key was rejected."; disable cloud this session |
| 429 / 5xx | One retry w/ backoff, then offline provider |
| Timeout | Abort, offline provider |
| Any gate/validation fails | Offline provider (reminder) or "couldn't reach the assistant" (chat); log reason code + a **hash** of the input, never the input (`09` §6, `11` §12) |

- **STT batch failure** mid-utterance → fall back is not possible retroactively (the audio is
  gone), so the user is asked to repeat or type; the composer is never blocked (`06`).

---

## 6. Cost transparency (`09` §8, kept)

Settings shows, per the privacy-first stance:
- `Last used: <timestamp>` or `Never` for each cloud feature.
- The consent modal states: *"Requests go to OpenAI under your own API key and are billed to
  your OpenAI account. Typical cost is well under ₹50/month for normal use; voice
  transcription and synthesis cost more than text."* (TTS/STT are pricier than chat, so the
  copy is honest about it — unlike `09`'s text-only ₹1/month figure.)
- A soft, local, optional **monthly spend estimate** (count calls × published per-call cost)
  shown in Settings — no network, just arithmetic on a local counter. Helps a user notice if
  "always use OpenAI" is costing more than they expected.

---

## 7. What is explicitly NOT done here

- **No proxy, no shared key, no LifeOS-hosted anything.** BYO key only.
- **No sending of sensitive memories** to any endpoint (`10`/`24`; `31` §4.3).
- **No audio persisted to disk**, ever, on any path.
- **No always-on / wake-word listening** (`24` "never" list).
- **No non-OpenAI host** added to the allowlist by this doc (Ollama is local and needs no
  allowlist; Anthropic/Gemini are future and would each be a separate, consented origin).

---

## 8. Definition of done for the OpenAI seam

1. The dead `aiAssistEnabled: () => false` probe is replaced by a live, re-installable
   predicate (`30` D1 closed).
2. `safeStorage` key storage + the three key IPC channels exist; `settings:get` still leaks
   nothing (the `16` §6 test passes).
3. With all cloud features **off**, the Wireshark 30-minute test shows **zero** outbound
   packets (SEC-10 re-verified for v2).
4. With a feature **on + keyed + consented**, traffic goes to `api.openai.com` **only**.
5. Each cloud feature degrades to its offline counterpart on every failure in §5, and the
   reminder core works fully with no key and no network.
6. The three consent disclosures (§2) are shown before the respective feature's first use,
   the cloud-STT "your voice is sent" sentence is explicit, and consent is revocable in
   Settings (`34`).
