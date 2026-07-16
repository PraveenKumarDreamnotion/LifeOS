# 34 — Settings Redesign

> **Scope:** the Settings surface for v2 — OpenAI enable/key management, provider selection,
> voice, consent management — plus the two structural fixes the audit found blocking it.
> Voice-picker detail lives in `35`; key/network/consent enforcement lives in `32`. This doc
> owns the *Settings UX and data model*, and references those for the machinery.
>
> **Load-bearing constraint (`32`, `30` §11.3):** cloud is opt-in, per-feature, revocable,
> and never the only path. Settings is where the user opts in — so Settings is also where the
> "offline, nothing uploaded" copy must stop lying the moment they do.

---

## 1. Current Settings reality (what exists)

`src/features/settings/SettingsScreen.tsx` is a flat list of six hand-written
`<section className="settings-group">` blocks — no section abstraction, every control bespoke
JSX, one `onUpdate(patch)` prop threaded from `App` → `useSettings.update`:

1. **Privacy** — copy + "Open data folder".
2. **Speech** — one checkbox (`ttsEnabled`) + the line *"Speech-to-text and voice run entirely
   offline on your computer."* (`SettingsScreen.tsx:42`).
3. **Reminders** — one checkbox (`remindersPaused`).
4. **Window & tray** — `closeAction` + `theme` selects.
5. **Danger zone** — the type-`RESET` modal.
6. **About** — version string.

Two problems the audit (`30` §3.1, §3.2, D6) flags that this redesign must fix:

- **`RISK (medium)` — `SettingsDto` / `SettingsUpdate` duplication.** `SettingsScreen`
  imports `SettingsDto` from `core/types/ipc` **and** a separately hand-maintained
  `SettingsUpdate` from `src/lib/ipc.ts`. Every new setting must be added in three places in
  lockstep (`SETTING_DEFAULTS`, `SettingsDto`, `SettingsUpdate`). Adding the ~10 new v2 keys
  this way is a drift factory.
- **`RISK (high, reputational)` — privacy copy hard-coded in ≥3 renderer places** asserting
  "offline / no server / nothing uploaded," which becomes **false** the moment a user enables
  OpenAI (§6).

`SETTING_DEFAULTS` (`settings-repository.ts:6-27`) already carries the seeds for the cloud
world — `tts_voice_id`, `tts_rate`, `tts_degraded`, `stt_provider`, `ai_assist_enabled`,
`ai_provider`, `ai_model`, `ai_consent_accepted_at`, `ai_last_used_at`, `ai_key_ciphertext` —
**all currently orphaned** (`30` §3.2). This redesign is largely *wiring what the schema
already anticipates*, not inventing storage.

---

## 2. New Settings information architecture

The six existing sections stay; four cloud-related sections are added. Order is chosen so a
privacy-first user sees the offline story first and the cloud story as a deliberate expansion:

```text
Settings
├── Privacy                     (kept; copy made conditional — §6)
├── Yogi's intelligence   NEW   ← the master "connect OpenAI" section (§3)
│     • OpenAI account: [Add key] / [•••• Update] [Remove] [Validate]
│     • Enable cloud features:  ☐ Conversation  ☐ Speech-to-text  ☐ Voice
│     • Last used · monthly estimate · [Manage consent]
├── Providers             NEW   ← per-capability engine choice (§4)
│     • Speech-to-text:  (•) Offline (Sherpa)   ( ) OpenAI
│     • Voice (TTS):     (•) Windows voices     ( ) OpenAI
├── Voice                 NEW   ← voice picker + preview (detail in 35)
├── Speech                      (kept; the "Speak reminders aloud" toggle; copy — §6)
├── Reminders                   (kept)
├── Window & tray               (kept)
├── Danger zone                 (kept)
└── About                       (kept)
```

`MVP DECISION` — **"Yogi's intelligence" is the single master gate.** Providers/Voice sections
are **disabled and visually dimmed until a valid key is present** — you cannot select the
OpenAI STT provider if there is no key. This makes the dependency (key → consent → provider)
legible instead of letting a user select a provider that silently can't run (`32` §2).

---

## 3. The "Yogi's intelligence" (OpenAI) section

### 3.1 API key management (the brief's Save / Update / Remove / Validate)

All four operations go through **new** IPC channels (`32` §4) — the key never crosses IPC in
readable form, and no getter exists:

| Action | Channel | Behaviour |
| --- | --- | --- |
| Save / Update | `settings:setApiKey(key)` | `safeStorage.encryptString` → `ai_key_ciphertext` (base64). Field shows `••••••••` afterward; the plaintext is never echoed back. |
| Remove | `settings:clearApiKey()` | clears the ciphertext **and** disables all three cloud toggles (a key-less cloud feature is meaningless) |
| Validate | `settings:validateApiKey()` | main makes one cheap live call (e.g. `GET /v1/models`) with the stored key → `{ valid }`. This is the only way to know a key works without persisting an unvalidated one. |

`MVP DECISION` — The key input is a **masked `SecretField`** (§7). On focus it is empty (never
pre-filled with a decrypted value — the renderer must not be able to read it back, `16` §6).
The row shows one of three states: *No key · Key saved ✓ · Key rejected* (last validation
result), never the key itself.

### 3.2 `safeStorage` unavailable (`RISK (medium)`, `32` §3.3 / `09` §7)

If `safeStorage.isEncryptionAvailable()` returns `false`, `settings:setApiKey` **refuses to
persist** and returns a coded error. The UI then offers a checkbox: *"Keep my key for this
session only (not saved to disk)."* — an in-memory-only key that dies on quit. **Never write a
plaintext key to disk.** The section shows a one-line explanation of why.

### 3.3 Per-feature enable toggles + consent

Three independent toggles (`32` §2): **Conversation**, **Speech-to-text**, **Voice**. Flipping
one **on** for the first time opens its consent modal (§5); the toggle does not actually flip
until consent is accepted (`09` §3). Each toggle backs a setting:

- Conversation → `ai_assist_enabled` (reused; in v2 it gates the Conversation Engine's LLM
  path, not just the old "assist when uncertain" path).
- Speech-to-text → `stt_provider = 'openai'` (vs `'sherpa-onnx'`).
- Voice → `tts_provider = 'openai'` (**new key**, vs `'web-speech'`).

Below the toggles: **Last used** timestamps (`ai_last_used_at` + new `stt_last_used_at` /
`tts_last_used_at`) and an optional **local monthly spend estimate** (`32` §6 — call counters
× published per-call cost, pure local arithmetic, no network).

---

## 4. The "Providers" section

Per-capability engine selection, reading the (previously orphaned) `stt_provider` and the new
`tts_provider` (`33` §7). Presented as radio groups so the offline default is always visibly
the alternative to cloud:

```text
Speech-to-text   (•) Offline — Sherpa (on-device)      ( ) OpenAI (cloud, uses your key)
Voice (TTS)      (•) Windows voices (on-device)         ( ) OpenAI (cloud, uses your key)
```

`FUTURE OPTION` — additional rows appear here as providers land: **ElevenLabs**, **Piper**
(`07`), **Ollama** for the LLM (`24`'s v0.4 vision; release v0.8), **Deepgram** for STT (`06`). Each is a new radio
option behind the same `SpeechProvider`/`TextToSpeechProvider`/`LlmProvider` factory (`33`),
so this section grows by adding options, not rewriting.

`MVP DECISION` — Selecting an OpenAI provider **requires** the corresponding enable toggle +
consent from §3; the radio is disabled otherwise, with helper text *"Add an OpenAI key and
enable this feature above."* The factory re-runs on change (`33` §5) so switching is live, no
restart (also the fix for the dead `aiAssistEnabled` seam, `30` D1 / `32` §3.1).

---

## 5. Consent management

`MVP DECISION` — Consent is **per feature** (`32` §2), stored as timestamps so "accepted" is a
verifiable fact with a date, not a boolean someone can flip blind:

- `ai_consent_accepted_at` (exists), `stt_consented_at` (**new**), `tts_consented_at`
  (**new**) — ISO strings, empty = not consented.

Each consent modal states exactly what leaves the device for *that* feature (`32` §2 table),
and the **Speech-to-text** modal carries the explicit sentence *"Your voice recording is sent
to OpenAI to transcribe it"* — the one that reverses `09`'s "Audio, ever" rule and must be
actively accepted. All modals include the billing/cost line (`32` §6).

A **Manage consent** subview lists the three features with their consent date and a **Revoke**
button each. Revoking clears the timestamp and turns the feature off (and its provider reverts
to offline). Consent enforcement is in **main** (`32` §2) — revoking here is authoritative,
not cosmetic.

---

## 6. Privacy-copy reconciliation (the content audit)

`RISK (high)` — Three renderer locations assert an absolute offline promise that a cloud
feature falsifies. Each must become **conditional on whether any cloud feature is enabled**:

| Location | Current copy | v2 copy |
| --- | --- | --- |
| `SettingsScreen.tsx:42` (Speech) | "Speech-to-text and voice run entirely offline on your computer." | **Cloud off:** unchanged. **Cloud on:** "Speech-to-text and voice run on-device unless you enable OpenAI above, in which case the relevant audio or text is sent to OpenAI under your key." |
| `App.tsx` rail chip | (privacy chip asserting "offline / no server") | Show "On-device" when all cloud off; show "OpenAI enabled" (a distinct, honest badge) when any cloud on — never claim "offline" while a cloud toggle is on. |
| `OnboardingFlow.tsx` privacy pane | "No account. No server. Nothing leaves your device." | "LifeOS works fully offline out of the box — no account, no server. You can *optionally* connect your own OpenAI key later in Settings for conversation and better voices; nothing is sent until you do." |

`MVP DECISION` — The Privacy section gains a **live status line** derived from settings:
*"Currently: fully on-device"* or *"Currently: OpenAI enabled for Conversation, Voice"* — so
the promise the app makes always matches the switches the user has actually set. The privacy
claim becomes a *computed truth*, not a hard-coded slogan.

---

## 7. Settings data model fixes

`MVP DECISION` — **Single `SettingsDto` source of truth.** Delete the hand-maintained
`SettingsUpdate` in `src/lib/ipc.ts` (`30` D6); derive the update/patch type from the DTO
(`Partial<SettingsDto>` minus read-only fields like `hasApiKey`). One place to add a setting.

`MVP DECISION` — **Typed accessors** on `SettingsRepository` (`getBool`/`getNumber`/`getEnum`)
so call sites stop hand-parsing `'true'`/`'30000'`/`'1.0'` (`30` §3.2). The DTO exposes typed
fields (`ttsRate: number`, `aiEnabled: boolean`, …); `getAllSafe()` (which already strips
`ai_key_ciphertext`, `settings-repository.ts:61-69`) feeds the DTO builder.

New setting keys to add to `SETTING_DEFAULTS`: `tts_provider` (`'web-speech'`), `tts_voice`
(the friendly voice key, default `'calm'`, `35` §8), `stt_consented_at` (`''`),
`tts_consented_at` (`''`), `stt_last_used_at` (`''`), `tts_last_used_at` (`''`), and the local
spend counters. Existing orphans (`tts_voice_id`, `tts_rate`, `tts_degraded`, `stt_provider`)
are now *read* by the provider factory (`33` §7).

`MVP DECISION` — The LLM `settings` action (`31` §3) can only touch a **closed safe subset**
(`theme`, `tts_enabled`, `reminders_paused`, `voice`) via the `SettingsAction` discriminated
union. It can **never** reach `ai_key_ciphertext`, any consent timestamp, `ai_assist_enabled`,
or a provider selection — Yogi cannot enable its own cloud access or read its own key.

---

## 8. Reusable renderer components (none exist today, `30` §5)

The redesign introduces the shared primitives the current bespoke JSX lacks:

- `Section` — titled settings group (replaces repeated `<section className="settings-group">`).
- `SettingRow` — label + control + optional helper/`dim` line.
- `Toggle` — accessible switch (`aria-pressed`), replacing raw checkboxes.
- `SecretField` — masked input for the API key; empty on focus, never round-trips a value,
  shows saved/rejected state (§3.1).
- `ProviderSelect` — a radio group with an offline option always present + a "requires key"
  disabled state (§4).
- `ConsentModal` — reuses the existing `Modal` primitive; renders the per-feature disclosure.

These also serve the conversation UI and voice section, so they are shared, not settings-only.

---

## 9. IPC / Main / Renderer / Security changes

**IPC (new, all `guard()`-wrapped, `32` §4):** `settings:setApiKey`, `settings:clearApiKey`,
`settings:validateApiKey`. **Changed:** `settings:get` DTO gains `hasApiKey`, `aiEnabled`,
`sttProvider`, `ttsProvider`, per-feature `lastUsed`/consent booleans, `spendEstimate` — and
**still never** returns the ciphertext (the `16` §6 destructure stays).

**Main:** `safeStorage` encrypt/decrypt in the settings handlers (decrypt only at OpenAI
call time, never for the renderer); the live `cloudEnabled()` predicate + session-security
re-install on `settings:changed` (`32` §3.1); provider factory re-run on provider/consent
change (`33` §5); per-feature `*_last_used_at` stamped after each successful cloud call.

**Renderer:** the new sections + primitives (§8); `useSettings` unchanged in shape but the DTO
is richer; the conditional privacy copy (§6) driven off the DTO.

**Security:** key write-only from the renderer's view; masked field never holds a real value;
LLM `settings` action restricted to the safe subset; consent revocation authoritative in main;
the `sk-` log redaction (`logger.ts`) retained.

---

## 10. Testing plan

- **Contract (integration):** `settings:get` never returns the key under any name — extend
  the existing `16` §6 test to the new DTO (assert no `sk-`, no `ciphertext`, `hasApiKey`
  correct). This test is **mandatory even if a cloud feature is cut** (`09` §11 posture).
- **Key lifecycle:** set → `hasApiKey` true; validate (mock 200/401) → `{valid}` correct;
  clear → `hasApiKey` false and all cloud toggles off.
- **safeStorage-unavailable:** `isEncryptionAvailable()` false → `setApiKey` rejects, no
  plaintext written to the DB (assert the row stays empty), session-only path offered.
- **Consent gating:** flipping a toggle without accepting consent does not persist the
  enable; revoking consent flips the feature off and reverts the provider.
- **Privacy-copy:** with all cloud off, the offline copy renders; with any cloud on, the
  conditional copy renders and the status line names the enabled features.
- **LLM settings action:** a `SettingsAction` targeting `ai_key_ciphertext`/a consent key is
  rejected by the schema (unreachable member).
- **Renderer (new jsdom project, `38`):** `SecretField` never exposes a value;
  `ProviderSelect` OpenAI option is disabled without a key.

## 11. Edge cases

- Key present but consent later revoked → provider reverts to offline mid-session (factory
  re-run), no crash, one notice.
- `safeStorage` becomes unavailable between sessions (rare) → stored ciphertext undecryptable
  → treat as "key rejected," prompt re-entry, never crash.
- User enables OpenAI STT but the mic/network fails at capture time → offline sherpa is not
  retroactively usable for that utterance (`32` §5); ask to repeat/type.
- Empty/whitespace or obviously malformed key (`< 20` chars) → rejected at the `z.string()`
  gate before any network call.
- Portable build: settings + ciphertext live in the portable data dir; `safeStorage` (DPAPI)
  is still user-scoped, so a copied portable folder cannot decrypt the key on another account
  (the `09` §7 property, restated in Privacy copy).

## 12. Definition of Done

1. `SettingsUpdate` duplication removed; one `SettingsDto` source of truth; typed accessors.
2. The three key IPC channels exist; `settings:get` leaks nothing (test green).
3. `safeStorage`-unavailable path implemented (refuse-persist + session-only), tested.
4. Per-feature enable + consent + revoke work, enforced in main; provider selection reads the
   real settings and switches live.
5. Privacy copy is conditional in all three locations; the status line matches the switches.
6. New shared primitives (`Section`, `SettingRow`, `Toggle`, `SecretField`, `ProviderSelect`,
   `ConsentModal`) exist and are reused by the conversation + voice UIs.
7. The LLM `settings` action can reach only the safe subset (test green).
8. With all cloud off, Settings presents an app indistinguishable from today's offline MVP.
