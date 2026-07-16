# 53 — Complete Testing Guide (aggregator + cross-phase suites)

> **v2 addition:** the reminder-popup test suite (over-another-app / focus-steal, voice, text,
> multi-reminder queue, multi-monitor, reduced-motion, reliability) lives in
> [55-reminder-popup-workflow.md](55-reminder-popup-workflow.md) §8. The reliability test
> (notification+history fire even if the popup fails) is a standing regression gate here.
>
> **What this is:** the testing **aggregator** for the v2 execution plan. Per `41` §11 this doc
> owns the **cross-phase suites** (conversation, voice, settings, security, regression,
> performance) and the **per-phase testing matrix**; it **references** each phase doc's own
> checklist (`42`–`52`) rather than copying it. **One owner per test** — the same
> "one authority per concern" discipline (`41` §7) applied to testing so version-drift cannot
> recur in test form.
>
> **This extends `38` (the architecture-era testing guide), which extends `18`.** `38` remains
> valid for the *pyramid, the vitest project layout, the unit/integration/component/provider
> test inventories, and the coverage goals*; `53` does not restate those tables — it adds the
> cross-phase scenario suites and keys them to the execution phases EP-1…EP-11 (`41` §5).
> Where `38` keyed its per-phase matrix to `37`'s architecture phases (P1–P7), **`53` §8 re-keys
> it to EP-1…EP-11** — use `53` §8 for build-order test planning.
>
> **Format:** every manual/scenario suite below uses **Step / Action / Expected Result**.
> Automated-test inventories (unit/integration/component/provider) stay in `38` §2–§5 and are
> only *referenced* here.

---

## 1. Testing model & authority

`MVP DECISION` — **One owner per test, to avoid drift:**

| Owner | Owns |
| --- | --- |
| **`53` (this doc)** | The cross-phase **suites** — conversation, voice, settings, security, regression, performance — plus the per-phase matrix (§8) and the manual fresh-machine + packaged-build checklist (§9). |
| **Each phase doc `42`–`52`** | Its **phase-specific** manual / edge / failure / recovery checklist. `53` references these by phase; it never copies them. |
| **`38`** | The **automated** pyramid: the vitest project layout, the unit/integration/component/provider inventories, coverage floors. `53` cites `38` rather than restating it. |

Every phase DoD requires three things green (`41` §11): **(a)** that phase's own checklist
(in its `42`–`52` doc), **(b)** the §6 regression suite (the `41` §8 invariants), and
**(c)** from EP-3 onward, the Wireshark **off→zero / on→openai-only** check (§5).

### 1.1 The v2 test pyramid (authority: `38` §1 — summarised, not owned here)

```text
        ╱  E2E / packaged smoke (NEW) ╲          Playwright-electron; 1 launch + reminder round-trip
       ╱   Component (NEW, jsdom)      ╲         ChatScreen, useConversation, Settings, MicButton
      ╱     Integration (real DB/main)  ╲        repos, migrations, IPC-contract, dispatcher
     ╱       Unit (pure core)            ╲       parser, scheduling, AssistantTurn/action schemas,
    ╱_____________________________________╲      provider factory + fallback decorator
```

Four layers, and the two **new** vitest projects the audit named as missing (`30` §10, `38` §1):

- **Unit** (existing `node` project): the frozen 96-test core floor **+** the v2 additions —
  `AssistantTurnSchema` and the per-intent **action schemas** (`31` §3), the **provider factory
  + `withFallback` decorator** (`33` §5), the local voice-confirmation matcher (`36` §4.1).
  `MVP DECISION` (from `38` §2) — the `AssistantTurn`/action-schema suite is **mandatory even
  before OpenAI ships**: if the schema is in the repo, its safety properties are pinned.
- **Integration** (existing `node` project): real DB + real main — migrations, the `conversations`
  and `memories` repos, the **IPC-contract** tests (the audit's biggest gap, `30` §10), and the
  **dispatcher** pending-proposal tests (`36` §4.3).
- **Component** (NEW `dom` / jsdom project): the **single config change the audit named as
  missing** (`30` §10, `38` §1) — `@testing-library/react` against a mocked `window.lifeos`.
  Covers `useConversation`, `ChatScreen`, the confirmation card, Settings, `MicButton`.
- **E2E smoke** (NEW, Playwright-electron, outside vitest): one launch of the **packaged** app +
  a reminder round-trip. A green CI must, by v2, imply "packages **and** launches" (`38` §9, `39` §3).

---

## 2. Conversation testing suite

**Purpose:** prove the router does the right thing on realistic input — chat vs Q&A vs a
reminder *proposal* vs a *created* reminder — and that the confirmation gate holds at the
language level. **Format: User: / Expected:.**

`MVP DECISION` — Each scenario is annotated with **the EP at which it first becomes valid**
(`41` §5, §9). Before EP-5 the app is honest that it cannot converse: non-reminder input shows
the placeholder *"Connect OpenAI in Settings to chat and answer questions"* (`41` §9). Reminder
scenarios are valid **offline from EP-2** (the shell wraps today's parser); conversational
intelligence lands at **EP-5**; recall at **EP-9**.

| # | User: / Expected: | Valid from |
| --- | --- | --- |
| C1 | **User:** "Hello" — **Expected:** a short greeting reply. **No** reminder card, **no** proposal. | EP-5 (EP-2: placeholder) |
| C2 | **User:** "Who are you?" — **Expected:** Yogi introduces itself (assistant + reminders + privacy stance); reply-only, no proposal. | EP-5 |
| C3 | **User:** "Explain Docker" — **Expected:** an explanation; reply-only; **no reminder created, no card.** | EP-5 (EP-2: placeholder) |
| C4 | **User:** "Tell me a joke" — **Expected:** a joke; the conversation continues coherently; no proposal. | EP-5 |
| C5 | **User:** "Remind me tomorrow to call Rahul" — **Expected:** a **proposal card inside an assistant bubble** — "Call Rahul, tomorrow" with resolved absolute + relative time. **Nothing is persisted yet.** | **EP-2** (offline parser) |
| C6 | **User:** "Yes" (with C5 pending) — **Expected:** reminder **created**, confirmation reply, and it appears under **Active Schedules**. | EP-2 (button) / **EP-7** (voice "yes") |
| C7 | **User:** "No" (with C5 pending) — **Expected:** proposal **discarded**; nothing persisted; a brief acknowledgement. | EP-2 / EP-7 |
| C8 | **User:** "Delete tomorrow's reminder" — **Expected:** the target is **resolved** (0→clarify, >1→disambiguate, `36` §3), a **delete confirmation card** shown; on Confirm it is deleted and gone from Active Schedules. | **EP-7** (EP-5 can propose; dispatcher-executed from EP-6/7) |
| C9 | **User:** "What did I ask you to remember?" — **Expected:** a **recall** reply listing confirmed memories (read-only, no confirmation). | **EP-9** |
| C10 | **User:** a long multi-turn conversation (10+ turns mixing chat, a question, a reminder create, an edit) — **Expected:** replies stay **coherent**; earlier turns are referenced correctly; cost/latency stay flat (bounded **sliding window** of `K` turns, `31` §4.3 — persisted turns are read-only history, never replayed). | EP-5 (window); **EP-9** for memory-backed recall across sessions |

**Routing invariant under test throughout:** a *statement/question* never creates a reminder;
a *reminder request* always produces a **proposal**, never a silent create; a *"yes"* only ever
confirms the **currently pending** proposal (never a stale one). This is the language-level
expression of the confirmation gate (`36` §4, `41` §8.3).

**Before EP-5 (EP-2–EP-4 honest-demo framing, `41` §9):** C1–C4, C9 show the placeholder;
C5–C7 work fully **offline** via the local parser. Do not test C1–C4 as "chat works" before EP-5 —
test them as "the placeholder shows and no reminder is created."

---

## 3. Voice testing suite

**Purpose:** every failure and control path of the voice I/O loop degrades safely and never
blocks the composer or the reminder core. **Format: Step / Action / Expected Result.** STT/TTS
provider paths are valid from EP-3/EP-4; voice **confirmation/commands** from EP-7.

| Step | Action | Expected Result |
| --- | --- | --- |
| V1 | Start voice capture with **mic unavailable / permission denied** | Clear "microphone unavailable" state; composer still accepts **typed** input; no crash (`current-status`: degrades to typed input). |
| V2 | **Internet disconnected**, cloud STT selected | Timeout/abort (STT 15 s, `32` §5) → **degrade to sherpa offline**; one non-modal notice; utterance still transcribed offline where possible, else "please repeat or type." |
| V3 | **OpenAI unavailable** (401 / 429 / 5xx) during STT or TTS | Degrade to offline provider (sherpa / Windows voice); Settings banner for 401 ("key rejected", disable cloud this session, `32` §5); one retry+backoff for 429/5xx. |
| V4 | **Slow response** (approaching timeout) | Spinner/processing state; on timeout, abort → offline provider; composer **never blocked** (`32` §5). |
| V5 | **Large pause while speaking** | 2 s silence auto-stop finalises the utterance (`current-status`); no premature cutoff mid-word within the pause window. |
| V6 | **User interrupts the assistant** (speaks while Yogi is talking) | TTS playback stops; capture begins; no overlap; the interrupted reply is not re-queued. |
| V7 | User says **"Stop" / "Cancel"** while a proposal is pending | Matched **locally** (`36` §4.1) → the pending proposal is **cancelled** (never confirmed); card clears. |
| V8 | User says **"Yes" / "No"** while a proposal is pending | Local match → confirm / cancel the **stored** proposal (`36` §4.3); **never** round-tripped to the LLM to interpret (`36` §4.1). |
| V9 | User says **"Repeat"** | Yogi re-speaks the last reply; no new LLM/network call required for a cached reply. |
| V10 | User says **"Speak louder" / "Explain again"** | Handled as conversational commands (EP-5+): louder → adjust playback; "explain again" → re-answer more simply. Before EP-5, unrecognised → placeholder. |
| V11 | **Conversation interruption** (new utterance mid-stream) | The in-flight `chat` stream is cancelled (`chat:cancel`, `32` §4); the new turn starts clean; no interleaved deltas. |
| V12 | **Voice switching** (change TTS voice mid-session) | Next spoken output uses the new voice; `voiceId`/`rate` threaded through `trigger-sink`→`speak` (`38` §7 P4); no restart. |
| V13 | **Provider switching** (Offline↔OpenAI for STT or TTS) | Factory re-runs live (`33` §5, `34` §4); next capture/utterance uses the new provider; **no app restart**; switching to OpenAI requires key+consent or the radio is disabled. |
| V14 | **Zero voices available** (TTS) | Degrade gracefully to notification-only or Windows default; never a dead-end; the reminder toast **still fires first** (`41` §8.6). |

**Cross-cut invariant:** on **every** voice failure, the notification + history still fire
first and unconditionally (`41` §8.6); voice is best-effort. **No audio is ever written to
disk** on any path (`32` §7 — Procmon-verified in §5/§9).

---

## 4. Settings testing suite

**Purpose:** the key lifecycle, provider/consent gating, and voice picker behave exactly as
`34` specifies. **Format: Step / Action / Expected Result.** Full UX lands at **EP-8**; the key
*mechanism* + minimal toggles exist from **EP-1** (`41` §5). Detailed automated assertions live
in `34` §10 and `38` §4 — this suite is the manual/scenario layer.

| Step | Action | Expected Result |
| --- | --- | --- |
| S1 | **Enable OpenAI** (a cloud feature toggle) first time | Consent modal opens; the toggle does **not** flip until consent accepted (`34` §3.3); on accept, `*_consented_at` timestamp stored. |
| S2 | **Disable OpenAI** | Feature reverts to its offline counterpart live (factory re-run); no restart; privacy status line updates to reflect the change (`34` §6). |
| S3 | API key **Save** | `safeStorage.encryptString` → `ai_key_ciphertext`; field shows `••••`; plaintext never echoed (`34` §3.1). |
| S4 | API key **Validate** | Main makes one cheap live call (`GET /v1/models`) with the stored key → `{ valid }`; row shows *Key saved ✓* or *Key rejected*; never the key itself. |
| S5 | API key **Remove** | Ciphertext cleared **and** all three cloud toggles turned off (a key-less cloud feature is meaningless, `34` §3.1). |
| S6 | **STT provider** = OpenAI (with key+consent) | `stt_provider='openai'`; next capture uses OpenAI batch; live-transcript strip absent (batch has no partials, `33` §2.1). Without key/consent the radio is **disabled** with helper text. |
| S7 | **STT provider** = Offline | `stt_provider='sherpa-onnx'`; sherpa streaming with live partials resumes. |
| S8 | **TTS provider** = OpenAI | `tts_provider='openai'`; next spoken output via `audio:playBytes` (bytes fetched in main). |
| S9 | **TTS provider** = Windows | `tts_provider='web-speech'`; `speechSynthesis` offline path resumes. |
| S10 | **Voice selection** | Picker shows **friendly labels** ("Warm Female", "Calm"); the underlying voice **id is stored internally**, never surfaced (`34` §7, `35`). |
| S11 | Voice **Preview / Play Sample** | Plays "This is Yogi. Nice to meet you." in the selected voice (`38` §8 step 11); no persistence required to preview. |
| S12 | Voice **Save** | Selection persisted (`tts_voice` friendly key + `tts_voice_id`); used for the next spoken reminder. |
| S13 | Voice **Cancel** | Reverts to the previously saved voice; no change persisted. |
| S14 | Voice **Reset** | Returns to the default voice (`'calm'`, `34` §7). |
| S15 | `safeStorage` **unavailable** | `setApiKey` refuses to persist; offers "keep for this session only"; **no plaintext written to disk** (`34` §3.2). |

---

## 5. Security testing suite

**Purpose:** the boundary, the key, and the confirmation gate hold against hostile input.
Anchored to `38` §6 and `30` §7 — this suite is the standing security bar; several of these
also appear as the §6 regression invariants. **Format: Step / Action / Expected Result.**

| Step | Action | Expected Result |
| --- | --- | --- |
| SEC1 | Inspect stored API key | Encrypted via `safeStorage` (DPAPI) as `ai_key_ciphertext` base64; `safeStorage.isEncryptionAvailable()` false ⇒ refuse to persist, never plaintext (`32` §3.3). |
| SEC2 | **IPC boundary** — send unknown key / past date / oversized payload to a channel | Rejected by Zod `.strict()`; oversized `speech:audio` dropped without allocating; **no stack trace crosses IPC** (`38` §3, `30` §7). |
| SEC3 | **Renderer isolation** (packaged) | `typeof require === 'undefined'`, `window.lifeos.ipcRenderer === undefined`, `Object.isFrozen(window.lifeos)` (`38` §6, `30` §7 SEC-6). |
| SEC4 | **No key leakage** via `settings:get` | Serialized DTO contains **neither** the key **nor** "ciphertext"; `hasApiKey === true` after set (`16` §6, `34` §10). |
| SEC5 | **No secrets in logs** | After a cloud call, `app_logs` contains no `sk-`; failures log a **reason code + a hash** of the input, never the input (`32` §5, `11` §12). |
| SEC6 | **No secrets in SQLite (plaintext)** | The `settings` row holds only ciphertext; a text scan of the DB finds no `sk-` (`34` §10). |
| SEC7 | **No provider credentials returned to renderer** | No IPC path returns a decrypted key or an `Authorization` header; the key is read at call time in main and dropped (`32` §3.3). |
| SEC8 | **Wireshark, all cloud OFF**, 30-min session incl. a fired reminder | **ZERO** outbound packets (`11` §14 SEC-10 — the headline proof, re-verified for v2). |
| SEC9 | **Wireshark, a cloud feature ON** | Traffic to **`api.openai.com` only** — no CDN, no telemetry, no other host (`32` §3.2). |
| SEC10 | **Pending-proposal invariant** | The renderer **cannot execute an unshown action**: `action:confirm(turnId)` runs the *stored, validated* proposal; a renderer-supplied action payload at confirm time is **ignored**; unknown/expired `turnId` rejected; single-use (`36` §4.3). |
| SEC11 | **Voice "yes" not model-spoofable** | Confirmation phrases matched **locally** against a closed set; the transcript is **never** sent to the LLM to decide "did they mean yes?" (`36` §4.1). A prompt-injected model cannot turn "no thanks" into a confirm. |
| SEC12 | **LLM validator** rejects hostile turns | `intent:'delete_all'`, extra keys (`.strict()`), past dates, shell command / URL in `reply`/`title` → rejected (`09` §11, `31` §5, `36` §2). |
| SEC13 | **No `child_process`/`eval`/`new Function`/dynamic import** | `grep -rE "child_process\|exec\(\|spawn\(\|eval\(\|new Function"` returns **only** the allowlisted file(s) (`11` §14 SEC-4, ESLint-enforced). |
| SEC14 | **CSP (packaged)** | No `'unsafe-eval'`, no `ws:`; `connect-src` includes OpenAI **only when a cloud feature is enabled** (`32` §3.2). |
| SEC15 | **No audio on disk** (Procmon) | No audio file written on any STT/TTS path (`32` §7). |

---

## 6. Regression suite — the `41` §8 invariants (run EVERY release)

`MVP DECISION` — This is the **standing regression suite** referenced by `41` §11. It is the
`41` §8 cross-cutting invariants, re-asserted at every release regardless of which EP shipped.
A failure here is **ship-blocking**. **Format: Step / Action / Expected Result.**

| Step | Invariant (`41` §8) | Action | Expected Result |
| --- | --- | --- | --- |
| R1 | **Full offline reminder loop** | With **no** OpenAI key: create → confirm → schedule → notify + speak | Works end-to-end, offline (`41` §8.1). |
| R2 | **Zero-network-off** | Wireshark, all cloud features off, incl. a fired reminder | Zero outbound packets (`41` §8.2 = SEC8). |
| R3 | **Confirmation gate** | Attempt any data-modifying action without a Confirm | Nothing consequential persists; the only carve-out is the reversible safe-settings subset with instant Undo (`41` §8.3, `36` §4.2). |
| R4 | **Key-never-crosses-IPC** | Inspect every IPC return path | The key never crosses IPC; all OpenAI calls in main (`41` §8.4 = SEC4/SEC7). |
| R5 | **LLM-never-actuates** | Feed a valid `AssistantTurn` with an action | The LLM returns JSON only; the app validates + executes via the dispatcher (`41` §8.5, `36` §7). |
| R6 | **Notification-first** | Fire a reminder with TTS/LLM/network all down | Toast + history fire **unconditionally and first**; speech/LLM/network best-effort (`41` §8.6). |
| R7 | **No `child_process`/`eval`** | Run the grep of SEC13 | Only the allowlisted file(s) (`41` §8.7 = SEC13). |

`MVP DECISION` — R1, R2, R3, R6 are runnable **from v0.1** (they predate cloud); R4, R5 become
live at EP-1/EP-5 but their *tests* exist earlier (schemas pinned, `38` §2). The suite only
grows; nothing is ever removed.

---

## 7. Performance suite

**Purpose:** hold the ceilings the audit flagged (`30` §6, `39` §4.1) before they bite.
**Format: Step / Action / Expected Result.** Fully exercised at **EP-11** (polish), but the
ceilings are watched from EP-5 onward as per-turn work grows.

| Step | Action | Expected Result |
| --- | --- | --- |
| P1 | **Main-thread SQLite** under a large `reminder_history` / `app_logs` | Hot queries stay responsive; `listAll` bounded (add LIMIT); no IPC/UI stall (`30` §6). Escape hatch: async DB facade (`39` §4.1). |
| P2 | **Main-thread STT decode** during a busy scheduler tick | No jank to tray / IPC / scheduler; RTF stays low (~0.07). Escape hatch: `utilityProcess` for STT (`30` §6, `39` §4.1). |
| P3 | **Streaming latency** (chat) | First `chat:delta` arrives promptly; deltas render incrementally; the assembled turn re-validated on `chat:done` (`32` §5). |
| P4 | **Memory** over a long session | No unbounded growth; the sliding window keeps context cost/latency **flat** regardless of total history (`31` §4.3); disposed STT model frees memory after idle. |
| P5 | **Audio-bytes path** (`audio:playBytes`) | Size cap enforced; bytes-not-path rule inviolable; no leak as more voice providers arrive (`39` §4.1). |

---

## 8. Per-phase testing matrix (keyed to EP-1…EP-11)

`MVP DECISION` — This **re-keys `38` §7's P1–P7 matrix to the execution phases** (`41` §5).
Each phase's DoD **must** add its row's tests. "Phase checklist" = that EP's own doc (`42`–`52`);
the suites named are this doc's §2–§7.

| EP | Doc | New tests the DoD must add | Cross-phase suites to run |
| --- | --- | --- | --- |
| **EP-1** | `42` | Provider **factory + `withFallback`** unit tests; `AssistantTurn`/action-schema unit suite (pinned pre-OpenAI, `38` §2); **IPC-contract** integration tests; dead-seam (D1) live-predicate test; migration 003 (if any); the 96 core floor stays green. | §6 (R1–R3, R6, R7) |
| **EP-2** | `43` | `useConversation` + `ChatScreen` **component** tests (jsdom project stood up here); conversation-routing unit tests; confirmation-card "no-Confirm-on-clarify" test. | §2 (C5–C7 offline), §6 |
| **EP-3** | `44` | Streaming-vs-batch `SpeechProvider` tests (`33` §2.1); fallback decorator; "audio never on disk"; batch-failure → composer not blocked. | §3 (V1–V5), §5 (SEC8/SEC9 begin), §6 |
| **EP-4** | `45` | `audio:playBytes` bytes-not-path; `voiceId`/`rate` threaded `trigger-sink`→`speak`; Preview flow; zero-voices degrade. | §3 (V12–V14), §4 (S8–S14), §5 (SEC15), §6 |
| **EP-5** | `46` | `AssistantTurn` gates on the live provider; OpenAI-mock provider; payload-shape (no ids/memories/settings sent); sliding-window coherence; consent-in-main. | §2 (C1–C4, C10), §5 (SEC5/SEC12), §6 (R5 live), §7 (P3/P4) |
| **EP-6** | `47` | **Dispatcher** pending-proposal invariant; renderer-payload-ignored; unknown/expired `turnId`; reminder-create **byte-identical pre/post** regression gate (`41` §6); old direct path behind a flag until verified. | §5 (SEC10), §6 (R3/R5) |
| **EP-7** | `48` | Voice-yes matcher (yes/no/ambiguous); timeout=cancel; disabled-capability refusal; delete/edit resolve refs (0→clarify, >1→disambiguate). | §2 (C6–C8 voice), §3 (V6–V11), §5 (SEC11), §6 |
| **EP-8** | `49` | `settings:get`-no-leak on the richer DTO; key lifecycle (set/validate/clear); `safeStorage`-unavailable; consent gating + revoke; conditional privacy copy; `SettingsAction` safe-subset. | §4 (S1–S15), §5 (SEC1/SEC4/SEC6/SEC7) |
| **EP-9** | `50` | `memories` repo (`source` always `'user_confirmed'`, `is_sensitive` derived); **"what do you remember" screen exists before "remember this"**; sensitive-never-sent payload test; recall read-only. | §2 (C9, C10 recall), §5 (payload-shape), §6 |
| **EP-10** | `51` | `ResearchProvider` interface tests; per-provider consent + allowlist origin; read-only (no confirmation-gate tension); medical/legal disclaimer copy. | §5 (SEC9 per-origin), §6 |
| **EP-11** | `52` | Performance suite (§7) to target; a11y (NVDA/focus); **E2E packaged smoke** as a CI gate; full regression + all cross-phase suites green. | §2–§7 (all) |

---

## 9. Manual fresh-machine + packaged-build checklist

`MVP DECISION` — This **extends `38` §8.1** and the `current-project-status.md` carryover with
the **conversation-vs-reminder routing** checks. Run on a **clean Windows account** against the
**packaged** build (NSIS + portable), not dev. **Format: Step / Action / Expected Result.**

| Step | Action | Expected Result |
| --- | --- | --- |
| M1 | Install via **NSIS on a standard (non-admin)** account | **No UAC** prompt; app launches to onboarding (`perMachine:false`). |
| M2 | Complete onboarding; land on the Chat screen | Conversational input dock (composer + mic); privacy pane copy is the **conditional** v2 copy (`34` §6). |
| M3 | Type **"Hello"** | A greeting reply (EP-5) **or** the placeholder (EP-2–EP-4). **No reminder created.** |
| M4 | Type **"Explain Docker"** | An answer (EP-5) or placeholder. **No reminder created** — verifies chat-vs-reminder routing. |
| M5 | Type **"Remind me tomorrow at 9 to call Rahul"** | A **confirmation card inside the reply** — "Call Rahul, tomorrow 9:00 AM". Nothing persisted yet. |
| M6 | Press **Confirm** | Reminder appears under **Active Schedules**. |
| M7 | Say (voice) **"remind me in 2 minutes to drink water"** → confirm by saying **"yes"** | Reminder created; the spoken "yes" confirmed it (EP-7); matched locally, not by the LLM. |
| M8 | Wait for it to fire (window open, then closed to tray) | Windows toast **+ Yogi speaks**, both while open and while in tray. |
| M9 | Settings → **enable OpenAI**, paste a key, **accept consent** | Masked key `••••`; "Last used: Never"; **Validate** succeeds. |
| M10 | Re-ask a question with OpenAI on | Streamed answer; Settings shows a **Last-used** time. |
| M11 | Settings → Voice → pick **"Warm Female"** → **Preview** | "This is Yogi. Nice to meet you." in the OpenAI voice; friendly label shown, id stored internally. |
| M12 | **Disable all cloud features** | STT / TTS / chat still work **offline** (sherpa / Windows / parser); privacy status line reverts to "fully on-device". |
| M13 | **Wireshark**, all cloud off, 30-min session incl. a fired reminder | **Zero** outbound packets. |
| M14 | **Wireshark**, a cloud feature on | Traffic to **`api.openai.com` only**. |
| M15 | **Procmon** during a voice command | **No audio file** written anywhere; no writes outside `%APPDATA%\LifeOS`. |
| M16 | **Uninstall** | `%APPDATA%\LifeOS` preserved; `Programs\LifeOS` removed. |

**Routing acceptance (the load-bearing manual check):** M3/M4 must **never** create a reminder,
and M5 must **always** produce a *proposal* (not a silent create). If a statement creates a
reminder or a reminder request auto-persists, the build **fails** this checklist — it is the
manual expression of the confirmation gate and the conversation router.
