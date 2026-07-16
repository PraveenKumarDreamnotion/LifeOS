# 38 — Testing Guide (v2)

> **Starting point (verified by the Phase 0 audit, `30` §10):** 96 tests over 6 files, all
> green, but all concentrated in `core/` + `electron/database` + `electron/scheduler`. There
> are **zero** tests for the renderer/React, the IPC boundary, either preload, the speech
> pipeline, notifications, tray, or session. `vitest` runs `environment:'node'`, so React
> **cannot** be tested under the current config. There is **no E2E/smoke** of the packaged
> app. CI runs typecheck + lint + test on `windows-latest` only — a green CI does not prove
> the app packages or launches.
>
> v2 adds the exact layers that are untested (conversation UI, cloud providers, the
> dispatcher). This guide makes closing that gap **part of each phase's Definition of Done**
> (`37`), not an afterthought. Extends `18-testing-strategy.md`.

---

## 1. The v2 test pyramid

```text
        ╱  E2E / packaged smoke (NEW) ╲          Playwright-electron; 1 launch + reminder round-trip
       ╱   Component (NEW, jsdom)      ╲         ChatScreen, useConversation, Settings, MicButton
      ╱     Integration (real DB/main)  ╲        repos, migrations, IPC-contract, dispatcher
     ╱       Unit (pure core)            ╲       parser, scheduling, AssistantTurn/action schemas,
    ╱_____________________________________╲      provider factory + fallback decorator
```

`MVP DECISION` — Two **new** vitest projects are added alongside the existing node project:

```ts
// vitest.config.ts → vitest.workspace.ts (or projects[])
projects: [
  { name: 'node', environment: 'node',
    include: ['tests/unit/**', 'tests/integration/**'] },          // existing
  { name: 'dom', environment: 'jsdom',                             // NEW
    include: ['tests/component/**'], setupFiles: ['tests/component/setup.ts'] },
]
```

The `jsdom` project is the single config change the audit named as missing (`30` §9.7). It
unlocks renderer/hook/component testing (`@testing-library/react`). E2E lives outside vitest
(Playwright), gated behind a `test:e2e` script and a CI job that builds first.

---

## 2. Unit tests (pure `core/`, no Electron)

Keep the existing 96 as a non-regressing floor. Add:

| Area | What to assert |
| --- | --- |
| `AssistantTurnSchema` (`31` §3) | accepts a valid turn; **rejects** an unknown `intent`, an extra key (`.strict()`), `reply` empty, `confidence` out of range |
| Per-intent action schemas (`31` §3) | `ReminderCreateAction` rejects a past `scheduledAt`, an unsupported RRULE; `SettingsAction` rejects a setting outside the closed safe set; `MemorySaveAction` marks health/family sensitive |
| Semantics gate (`36` §2, `09` §5 Gate 2) | future-date, ≤2y, sing-not-recurring, resolvable-ref (0/>1 → clarify) |
| Safety scan (`09` §5 Gate 3) | a shell command / URL in `reply` or `title` → `unsafe_content` |
| Provider factory (`33` §5) | returns offline provider when key absent / consent missing; returns cloud when all gates true; `withFallback` swaps to backup on primary error |
| Voice-confirmation matcher (`36` §4.1) | "yes/yep/do it" → confirm; "no/cancel" → cancel; anything ambiguous → neither |
| Deterministic parser | unchanged 56-fixture corpus stays green (it is now the offline reminder executor, `33` §6) |

`MVP DECISION` — The `AssistantTurn` validation suite is the v2 analogue of `09` §11's
LLM-validation tests, and is **mandatory even before OpenAI ships** — if the schema exists in
the repo, its safety properties are pinned.

---

## 3. Integration tests (real DB, real main process)

| Area | What to assert |
| --- | --- |
| Migrations | fresh DB reaches latest `user_version`; if v2 adds migration 003, it is idempotent, refuses a newer DB, and rolls back on mid-failure (existing pattern) |
| `conversations` repo (NEW, `31` §4.2) | one row per turn; `reminder_id` FK `SET NULL` on reminder delete; retention sweep prunes >365d |
| `memories` repo (v0.3) | `source` only ever `'user_confirmed'`; `is_sensitive` derived; per-row delete |
| **IPC contract tests** (NEW — the audit's biggest gap) | every registered channel is in `CH`; `reminders:create` rejects unknown key / past date; SQL-injection stored as literal; **no stack trace crosses IPC**; oversized `speech:audio` dropped without allocating; `resetLocalData` takes no args |
| **`settings:get` never leaks the key** (`16` §6) | after `setApiKey`, the serialized `settings:get` contains neither the key nor "ciphertext"; `hasApiKey === true` |
| Dispatcher (NEW, `36`) | data-modifying action → pending proposal → `action:confirm(turnId)` executes the **stored** action; a confirm with a mismatched/expired `turnId` is rejected; a renderer-supplied action payload at confirm time is ignored |

`MVP DECISION` — IPC-contract and dispatcher tests run against a **real** main process (the
`18`/`16` §9 pattern), because the guard/validation boundary is security-critical and its
whole value is that it behaves correctly against hostile input.

---

## 4. Component tests (NEW, jsdom)

| Component | What to assert |
| --- | --- |
| `useConversation` (`31` §4.1) | appends user + streaming assistant messages; `chat:delta` grows the streaming bubble; `chat:done` settles it with a `proposal` |
| `ChatScreen` | routes reply-only vs proposal; a proposal renders the confirmation card **inside** an assistant bubble; Confirm calls `action:confirm`, not `reminders:create` directly |
| Confirmation card | `needsClarification` → **no Confirm button** (`09` §5 Gate 4); Cancel discards; timeout cancels (not confirms) |
| Settings (`34`) | key field is masked; enabling a cloud feature shows the consent modal; `hasApiKey` renders `••••`, never a value |
| `MicButton` / live transcript | state → label/glyph mapping; `supportsPartials:false` provider shows spinner+final, not a live strip (`33` §2.1) |

The renderer talks to a **mocked `window.lifeos`** (a typed test double), so these are fast
and deterministic.

---

## 5. Provider & cloud testing (no real network in CI)

`MVP DECISION` — CI **never** makes a real OpenAI call. Providers are tested against a
`fetch` mock / injected transport:

- **OpenAI LLM:** given a canned Structured-Outputs response, the provider returns raw
  `unknown` and the engine's `AssistantTurnSchema.parse()` validates it; a malformed response
  degrades to the offline parser (`32` §5).
- **STT streaming vs batch (`33` §2.1):** `SherpaSpeechProvider` emits `partial` events per
  frame; `OpenAiSpeechProvider` (batch) emits **no** partials and resolves final only at
  `stop()`; the UI adapter reads `supportsPartials` and renders accordingly.
- **`audio:playBytes` (`33` §3.1):** a fake `{mime,bytes}` reaches the audio window, becomes a
  `blob:` URL, plays; a path/URL is **never** accepted; `audio:playbackError` is wired.
- **Fallback decorator (`33` §5):** primary `init/start/stop` throws → backup runs
  transparently; `tts_degraded`/equivalent flag set; reason logged **without** payload.
- **Payload-shape test (`09` §11):** the outbound OpenAI request body contains only the
  intended fields — no reminder ids, no sensitive memories, no settings.

---

## 6. Security / privacy tests that must stay green

| Test | Reference |
| --- | --- |
| `settings:get` leaks neither key nor ciphertext | `16` §6, `34` |
| **Zero outbound packets with all cloud features OFF** (Wireshark, 30-min session incl. a fired reminder) | `11` §14 SEC-10 — **re-verified for v2**, still the headline proof |
| With a cloud feature ON: traffic to `api.openai.com` **only** | `32` §3 |
| `typeof require === 'undefined'`, `window.lifeos.ipcRenderer === undefined`, `Object.isFrozen(window.lifeos)` in the packaged renderer | `11` §14 SEC-6 |
| Packaged CSP contains no `'unsafe-eval'`, no `ws:`, and `connect-src` has OpenAI **only when cloud enabled** | `11` §5, `32` §3.2 |
| LLM validator rejects `intent:'delete_all'`, extra keys, past dates, unsafe content | `09` §11, `31` §5 |
| Pending-proposal invariant: renderer cannot execute an unshown action | `36` §4.3 |
| Voice "yes" cannot be spoofed by the model (matched locally, never LLM-interpreted) | `36` §4.1 |
| `grep -rE "child_process\|exec\(\|spawn\(\|eval\(\|new Function"` returns only the allowlisted file(s) | `11` §14 SEC-4 |
| No audio written to disk on any path | `32` §7, `06` |

---

## 7. Per-phase testing matrix (keyed to `37`)

Each phase's Definition of Done **must** add its row's tests before release:

| Phase (`37`) | New tests required in its DoD |
| --- | --- |
| P1 Conversation shell (offline) | `useConversation` + `ChatScreen` component tests; conversation-routing unit tests; migration 003 (if any) integration test; the whole existing 96 still green |
| P2 OpenAI LLM (chat/intent) | `AssistantTurn` gates; OpenAI-mock provider; payload-shape; consent-in-main; Wireshark off/on; `settings:get`-no-leak; safeStorage key IPC |
| P3 OpenAI STT (batch) | streaming-vs-batch provider tests; fallback decorator; "audio never on disk"; batch-failure → composer not blocked |
| P4 OpenAI TTS + Voice | `audio:playBytes` path; bytes-not-path; voice-id/rate threaded through `trigger-sink`→`speak`; Preview flow; zero-voices degrade |
| P5 Voice confirmation + dispatcher | dispatcher pending-proposal invariant; voice-yes matcher; timeout=cancel; disabled-capability refusal |
| P6 Memory foundation | `memories` repo; sensitive-never-sent; "what do you remember" screen exists before "remember this" |
| P7 Research foundation | `ResearchProvider` interface tests; per-provider consent + allowlist origin; medical/legal disclaimer copy |

---

## 8. Manual testing checklists

### 8.1 Fresh-machine / packaged build (carry-over from `current-project-status.md` + v2)

```text
1.  Install via NSIS on a standard (non-admin) account.
      Expected: no UAC prompt; app launches to onboarding.
2.  Complete onboarding; land on the Chat screen.
      Expected: conversational input dock (composer + mic).
3.  Type "hi yogi".            Expected: a chat reply. NO reminder created. (P1/P2)
4.  Type "explain docker".     Expected: an answer. NO reminder created. (P2)
5.  Type "remind me tomorrow at 9 to call Rahul".
      Expected: a confirmation card INSIDE the reply — "Call Rahul, tomorrow 9:00 AM".
6.  Press Confirm.             Expected: reminder appears under Active Schedules.
7.  Say (voice) "remind me in 2 minutes to drink water" → Confirm by saying "yes".
      Expected: reminder created; the "yes" confirmed it. (P5)
8.  Wait for it to fire (window open, then closed to tray).
      Expected: Windows toast + Yogi speaks, both times.
9.  Settings → enable OpenAI, paste a key, accept consent.
      Expected: masked key; "Last used: Never"; validate succeeds. (P2/34)
10. Re-ask a question with OpenAI on.  Expected: streamed answer; Settings shows a Last-used time.
11. Settings → Voice → pick "Warm Female" → Preview.
      Expected: "This is Yogi. Nice to meet you." in the OpenAI voice. (P4/35)
12. Disable all cloud features.  Expected: STT/TTS/chat still work offline (sherpa/Windows/parser).
```

### 8.2 Privacy verification (the promise, measured)

```text
□ Wireshark, all cloud OFF, 30-min session incl. a fired reminder → ZERO outbound packets.
□ Wireshark, cloud ON → traffic to api.openai.com only.
□ Procmon → no audio file written anywhere during a voice command.
□ Uninstall → %APPDATA%\LifeOS preserved; Programs\LifeOS removed.
```

---

## 9. Coverage goals & gaps closed

- **Add a coverage provider** (v8) with a floor per project; the audit noted there is none
  today, so the untested surface is invisible.
- **Targets:** `core/` and `electron/database`/`scheduler` stay high (already strong);
  the **new** layers (conversation engine, dispatcher, providers, IPC boundary, key
  handling) ship at ≥ the same bar as their phase's DoD.
- **CI change:** add the `dom` project to the existing job; add a **separate** job that runs
  `build` + the Playwright smoke on `windows-latest` (gated on tags or a label so PR CI stays
  fast). A green CI must, by v2, imply "packages and launches."
