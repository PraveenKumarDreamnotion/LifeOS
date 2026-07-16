# 48 — Execution Phase EP-7: Reminder Workflow v2

> **Ships in v0.6** (with EP-6, `41` §7) · **opt-in** · flag `voice_confirm_enabled`
> (off ⇒ button-only confirmation, the app behaves exactly as it did at the end of EP-6).
>
> **Authority:** build order and invariants are owned by `41` (the Execution Master Plan);
> this doc is the EP-7 execution plan under it. Confirmation methods, weight, and the
> pending-proposal security invariant come from `36` §4; reference resolution from `36` §3;
> the STT path this phase reuses landed in EP-3 (`44`); the dispatcher it builds on landed in
> EP-6 (`47`). Where this doc and `41` disagree on sequencing, **`41` wins**.

---

## Objective

Complete the **conversational reminder** experience on top of the Action Dispatcher (EP-6).
Three capabilities, each already structurally supported by the dispatcher's action types but
not yet wired to conversation or voice:

1. **Conversation-based reminder creation** — a reminder is created through a dispatched
   `reminder_create` proposal that the user confirms, not through the retired single-shot
   `ipc.createReminder` path. (EP-6 already re-routed create through the dispatcher; EP-7
   makes the *conversation* the primary way to reach it and adds edit/delete alongside.)
2. **Voice confirmation and cancellation** — while a proposal is pending, the user may say
   "yes"/"no"/"cancel"/"stop"/"repeat" and have it matched **locally in main** against a
   fixed phrase set (`36` §4.1), **never sent to the LLM**. Needs STT (EP-3) + the dispatcher's
   pending-proposal store (EP-6).
3. **Reminder editing and deletion by conversation** — `reminder_update` and `reminder_delete`
   actions, each resolving a `reminderRef` against real rows (`36` §3) and confirming with a
   card that shows the *resolved* target before anything changes.

Everything is behind `voice_confirm_enabled`; with it off, confirmation is button-only and
this phase reduces to "you can now edit and delete reminders in conversation, by button."

---

## Why this phase exists

EP-6 built the dispatcher and re-routed reminder *creation* through it, but the demo at v0.6
is still fundamentally "type a reminder, press Confirm." Two things are missing to make the
reminder experience genuinely conversational and hands-free:

- **Voice is input-only until now.** EP-3 gave us cloud STT (better dictation), EP-4 gave us a
  natural spoken voice out. But the *loop* still requires a mouse: dictate a reminder, then
  reach for the Confirm button. The product's identity is the confirmation gate (`36` intro,
  `24`) — making that gate answerable **by voice** is what turns dictation into a conversation.
- **Edit and delete had no conversational path.** Today the only way to change a reminder is
  the Schedules screen's direct lifecycle controls (`36` §6). There is no "move the dentist
  reminder to Friday" or "delete my 9am one." Those require `reminder_update`/`reminder_delete`
  actions plus reference resolution — both defined in `36` but not exercised until EP-7.

`MVP DECISION` — EP-7 adds **no new network surface and no new provider.** It composes EP-3's
STT, EP-4's TTS, and EP-6's dispatcher. The only genuinely new code is the **local voice-confirm
matcher** and the **edit/delete proposal UI**. This keeps a v0.6 feature-complete phase small
and its risk contained to one flag.

---

## Current code that will be reused

Grounded in the live tree (`30` §13 "do not change" list):

| Reused as-is | Why it is safe to reuse |
| --- | --- |
| `electron/actions/dispatcher.ts`, `execute.ts`, the pending-proposal store (EP-6) | EP-7 emits `reminder_update`/`reminder_delete` envelopes into the **same** `dispatch()`; the gates, confirmation layer, and `action:confirm/cancel` IPC are unchanged (`36` §2, §4.3). |
| `electron/database/reminder-repository.ts` — `update()`, `delete()`, `create()`, business rules | The dispatcher's execution layer already calls these (`36` §5). Edit/delete are the repo's existing methods, reached through a new front door — **still exactly one writer per entity** (`30` §13.4). |
| `electron/scheduler/scheduler.ts` + `trigger-sink.ts` + `reconcile('mutation')` | An edit or delete broadcasts `reminders:changed` and reconciles, identical to a create (`36` §5). Reminder *lifecycle* is orthogonal to how it's *created/edited* (`41` §4.1). |
| EP-3 `SpeechProvider` + `speech:partial`/`stop()` pipeline (`44`, `30` §11.1) | Voice-confirm reuses the **same capture path** — mic → STT → final transcript. We tap the transcript when a proposal is pending; no new capture code. |
| `src/hooks/useSpeech.ts`, `src/features/chat/MicButton.tsx`, `src/components/Modal.tsx` (`30` §13, `41` §4.1) | Mic UI + speech capture + the modal primitive drive the pending-proposal card and its voice affordance. |
| `src/features/reminders/TriggerModal.tsx` | Untouched — it is a *direct lifecycle* control (Dismiss/Snooze/Done), already-confirmed-by-the-press (`36` §6), NOT a dispatcher proposal. EP-7 must not route it through the dispatcher. |
| EP-4 TTS path (`45`) | The confirmation card's spoken prompt ("Shall I set that reminder?") and the "repeat" command reuse the active `TextToSpeechProvider`; no new TTS work. |

`MVP DECISION` — The **notification + history fan-out stays unconditional and first** on every
edit/delete outcome, exactly as for create (`30` §13.4, `41` §8.6). Voice confirm is best-effort
sugar layered on top of a path that already works by button.

---

## Code that must be refactored

Small, additive — EP-7 is a composition phase, not a refactor phase.

| Refactor | Where | Note |
| --- | --- | --- |
| The dispatcher's pending-proposal store gains a **`voiceEligible` flag + a proposal-open event** so main knows a proposal is awaiting confirmation and can route transcripts to the matcher instead of the composer | `electron/actions/pending-proposal.ts` (EP-6) | Additive field; does not change the `36` §4.3 single-use/`turnId` invariant. |
| The STT final-transcript handler in main gains a **branch: if a voice-eligible proposal is pending, route the transcript to the confirm matcher first** (and only fall through to the composer if it matched neither yes nor no) | `electron/main/ipc/speech.ts` (consolidated onto `guard()` in EP-1, `30` D4) | The matcher decides; an ambiguous transcript is *not* consumed — it stays available and the card stays pending (`36` §4.1). |
| `reminderRef` normalisation (title/time match, fail-closed on 0/>1) must be **live** for `reminder_update`/`reminder_delete`, not just `reminder_create` | `electron/actions/normalise.ts` (EP-6, `36` §3) | EP-6 built resolution for create's fields; EP-7 exercises the *ref* branch in anger for the first time. Verify 0-match → clarification, >1 → disambiguation. |
| The proposal-card message variant (EP-6) gains **edit/delete renderings** (show resolved before/after for update; show the resolved reminder for delete) and a **pending "listening for yes/no" affordance** | `src/features/chat/*` proposal component | Reuses `resolvedSummary` (`31` §4.1, `36` §3); no new store. |

`RISK (low)` — routing transcripts through the matcher-first branch must be strictly scoped to
"a voice-eligible proposal is pending." If it leaks, normal dictation could be swallowed by the
matcher. Enforced by the pending-proposal state gate + a unit test (see Failure Cases).

---

## Files expected to change

| File | Change |
| --- | --- |
| `electron/actions/voice-confirm-matcher.ts` | **NEW** — the local closed-phrase matcher (main). |
| `electron/actions/pending-proposal.ts` | add `voiceEligible`, `openedAt`, proposal-open/close notifications; keep single-use `turnId` (`36` §4.3). |
| `electron/actions/dispatcher.ts` | on `proposeAndAwaitConfirmation`, start the **90 s timeout** and mark the proposal voice-eligible when `voice_confirm_enabled` + STT available. |
| `electron/actions/normalise.ts` | wire `reminderRef` resolution for update/delete (fail-closed) — `36` §3. |
| `electron/main/ipc/speech.ts` | matcher-first routing branch for final transcripts while a proposal is pending. |
| `electron/main/ipc/actions.ts` (EP-6) | `action:confirm/cancel` already exist; add the timeout-cancel broadcast + a `chat:done` "repeat" re-speak trigger. |
| `core/actions/action.ts` (EP-6) | `ReminderUpdateAction`/`ReminderDeleteAction` already defined (`36` §2) — EP-7 only consumes them; no change unless a `patch` field is missing. |
| `src/features/chat/ProposalCard.tsx` (EP-6) | edit/delete renderings + "🎙 say yes or no" pending affordance. |
| `src/features/chat/ConversationView.tsx` (EP-2/EP-6) | show pending state, timeout countdown (optional), and route the mic while pending. |
| `src/lib/ipc.ts` | no new key IPC; add typed wrappers for `action:confirm/cancel` if EP-6 didn't already expose them to the renderer. |
| `electron/main/settings/flags.ts` (EP-1) | register `voice_confirm_enabled` default `false`. |

---

## New folders

- **None required.** EP-6 created `core/actions/` and `electron/actions/`; EP-7 adds files
  *inside* `electron/actions/` (`voice-confirm-matcher.ts`). No new top-level folder.

---

## New services

- **`VoiceConfirmMatcher`** (`electron/actions/voice-confirm-matcher.ts`, main) — a pure,
  dependency-free function `match(transcript): 'affirm' | 'negate' | 'repeat' | 'neither'`.
  Runs **only in main**, against a fixed phrase list, and its result gates
  `action:confirm`/`action:cancel` on the *stored* pending proposal (`36` §4.3). It never calls
  a provider, never touches the DB, never sees the LLM. It is testable in isolation (see
  Voice Testing). Phrase sets (`36` §4.1):
  - **affirm:** `yes, yeah, yep, yup, confirm, do it, go ahead, sure, okay, ok, correct`
  - **negate:** `no, nope, nah, cancel, stop, don't, dont, never mind, nevermind, forget it`
  - **repeat:** `repeat, say again, what was that, read it back`
  - anything else → `neither` (card stays pending).

`MVP DECISION` — The matcher is **word-boundary, normalised, closed-set** — not a fuzzy
classifier. "maybe later," "yes but change the time," "no thanks I'll do it myself" all resolve
to `neither` on purpose: a partial/qualified answer must not be read as a decision (`36` §4.1,
false-positive prevention). Only a clearly-affirmative or clearly-negative utterance acts.

---

## IPC changes

No **new** channels — EP-7 reuses EP-6's `action:confirm`/`action:cancel` and EP-3's speech
channels. Behavioural additions only:

| Channel | Kind | EP-7 change |
| --- | --- | --- |
| `action:confirm` `{ turnId }` (EP-6, `36` §6) | invoke | May now be **triggered internally by the matcher** (voice "yes") as well as by the button. Either way it executes the *stored* proposal — the renderer/voice path cannot submit a different payload (`36` §4.3). |
| `action:cancel` `{ turnId }` (EP-6) | invoke | Triggered by voice "no"/"cancel", by the button, or by the **90 s timeout** (timeout = cancel, always — `36` §4.1). |
| `speech:partial` / `stop()` final (EP-3) | broadcast/return | While a voice-eligible proposal is pending, the **final** transcript is routed to the matcher in main *before* the composer sees it (`44`, `30` §11.1). |
| `chat:done` `{ proposal? }` (EP-5/EP-6, `32` §4) | broadcast | Carries the display-ready proposal for edit/delete, same shape as create. "repeat" re-emits the last proposal's spoken prompt via TTS. |
| `reminders:changed` | broadcast | Fired after an edit/delete executes (`36` §5) — the Schedules screen and caches refresh, identical to create. |

`MVP DECISION` — Voice confirmation adds **zero renderer-callable IPC**. The matcher lives in
main and drives the existing `action:confirm/cancel`. A compromised renderer cannot forge a
voice "yes" into an unshown action because confirm still executes only the stored, validated
proposal (`36` §4.3, `41` §8.3).

---

## Database changes

- **No schema change.** `reminder_update` and `reminder_delete` use the existing
  `reminder-repository.ts` `update()`/`delete()` and the existing reminders table (migrations
  001/002, `30` §13). Provenance for an edit is stored via the existing `source` column
  (`voice` → `'manual'`, `36` §5).
- **No new settings key** except the flag `voice_confirm_enabled` (registered in the flag
  registry, `41` §10) — stored in `settings` as `'false'` by default, read in main.

`MVP DECISION` — The 90 s pending-proposal timeout is **in-memory only** (the pending store,
`36` §4.3). A proposal never persists; if the app quits with a proposal open, it is simply gone
on restart (fails safe — nothing was confirmed).

---

## UI changes

- **Proposal card gains three renderings** (all message-bubble variants, `31` §4.1):
  - *create* (from EP-6) — resolved absolute + relative time, recurrence.
  - *update* — "Change **<title>** from *<old time>* to *<new time>*?" showing the resolved
    before → after (`36` §4.2).
  - *delete* — "Delete **<resolved title>** (*<time>*)?" showing the exact row that will be
    removed (`36` §4.2, `4.3`).
- **Pending affordance** — while `voice_confirm_enabled` and a proposal is open, the card shows
  a subtle "🎙 Say *yes* or *no* — or press Confirm" line and a soft 90 s countdown. Off ⇒ just
  the buttons.
- **Disambiguation card** — when `reminderRef` matches >1 reminder, a card lists the candidates;
  the user picks one (button or by saying its index) → a fresh proposal (`36` §3). This card has
  **no blind Confirm** (it is a clarification, `36` §4.1 Gate 4).
- **Clarification message** — when `reminderRef` matches 0 reminders, a plain assistant message
  "I couldn't find a reminder like that — which one?" (`36` §3), no card.

`MVP DECISION` — Timeout is **visible** (the countdown) so a user is never surprised that a
proposal quietly cancelled; but the countdown is cosmetic — the authoritative timer is in main.

---

## Main process changes

- **Timeout timer** — `proposeAndAwaitConfirmation` arms a 90 s `setTimeout` per pending
  proposal; on fire it calls `action:cancel(turnId)` internally, clears the proposal, and emits
  a `chat:done` "reminder not set — the request timed out" message. **Timeout = cancel, never
  auto-confirm** (`36` §4.1, `41` §8.3).
- **Matcher routing** — the speech final-transcript handler checks the pending store: if a
  voice-eligible proposal is open, run `VoiceConfirmMatcher.match()`; `affirm` →
  `action:confirm`, `negate` → `action:cancel`, `repeat` → re-speak the proposal via TTS,
  `neither` → drop the transcript (card stays pending, optionally speak "Sorry — yes or no?").
- **Ref resolution live** — normalisation resolves `reminderRef` against active reminders and
  **fails closed** (0 → clarification, >1 → disambiguation), then re-validates a
  `reminder_update`'s new `scheduledAt` through the same `CreateReminderInput` gate a typed
  reminder passes (`36` §3).
- **Provenance** — a voice-confirmed edit/delete records `source: 'voice'` on the envelope →
  mapped to `'manual'` in the row (`36` §5).

---

## Renderer changes

- **Route the mic while pending** — `ConversationView` keeps the mic available during a pending
  proposal; the renderer does **not** interpret the transcript (main's matcher does). The
  renderer only *renders* the pending state and *relays* a button Confirm/Cancel (`36` §1, §4.3).
- **Proposal component** renders create/update/delete variants + the pending "say yes/no"
  affordance + the countdown.
- **Disambiguation + clarification** rendering for the ref-resolution outcomes.
- No new settings surface here — the `voice_confirm_enabled` toggle's *UX* lands in **EP-8**
  (`49`); EP-7 ships the flag read from settings with a minimal placeholder toggle if needed.

---

## Provider changes

- **None.** EP-7 introduces no provider and no new origin. It composes the STT provider (EP-3),
  the TTS provider (EP-4), and the dispatcher (EP-6). The OpenAI allowlist/CSP (`32` §3) is
  untouched; with all cloud off, voice-confirm still works using **offline sherpa STT + Windows
  TTS** — voice confirmation is *not* a cloud feature (`41` §8.1, §8.2).

`MVP DECISION` — Voice confirmation works **fully offline.** The matcher is local; STT can be
sherpa; TTS can be Windows. Enabling OpenAI STT only improves transcription accuracy of the
"yes/no" — it is never required. This keeps the Wireshark off→zero proof intact (`32` §8.3).

---

## Security considerations

- **The LLM never interprets a confirmation** (`36` §4.1, `41` §8.5). The matcher is a closed
  local phrase set in main; a prompt-injected model cannot turn "no thanks" into a confirm
  because the transcript is never round-tripped to the LLM for a yes/no decision.
- **Pending-proposal invariant holds** (`36` §4.3): confirm executes the *stored, validated,
  normalised* action keyed by `turnId`; a voice "yes" cannot execute an unshown action, and a
  confirm for an unknown/expired `turnId` is rejected. Single-use, cleared on
  confirm/cancel/timeout.
- **Deletes/updates target only resolved rows** (`36` §3, §7). Fail-closed on 0/>1 matches —
  never a guess. A delete confirmation card shows the exact resolved row.
- **No new IPC callable by the renderer**, so no new attack surface (§IPC changes).
- **Timeout fails safe** — a lapsed proposal cancels; nothing persists (`41` §8.3).
- **Provenance recorded** so History shows voice-created/edited vs typed (`36` §5, `09` §5).

---

## Performance considerations

- **Matcher is O(tokens)** on a short utterance — trivial, main-thread-safe.
- **Voice-confirm reuses the existing STT decode** (already on the main thread, `30` §6; a
  utility-process isolation is a `FUTURE OPTION`, not EP-7). A "yes/no" is a sub-second
  utterance — no added decode pressure beyond what dictation already incurs.
- **90 s timer** is a single `setTimeout` per open proposal (at most one open at a time, the
  store is single-slot per `turnId`) — negligible.
- **Edit/delete reuse the existing repo + one `reconcile('mutation')`** — same cost as a create;
  no `SELECT *`-without-LIMIT growth beyond today (`30` §6).

---

## Risks

- `RISK (medium)` — **false-positive confirmation.** A background "yeah, sounds good" while a
  proposal is open could confirm. *Mitigation:* matcher only runs when a proposal is pending;
  closed phrase set; qualified utterances → `neither`; the card also always offers explicit
  buttons; and (Voice Testing) false-positive cases are a required test gate.
- `RISK (medium)` — **ref resolution ambiguity.** "delete my reminder" with three reminders →
  must disambiguate, never delete the wrong one. *Mitigation:* fail-closed 0/>1 (`36` §3);
  delete card shows the resolved row; a Regression Test asserts no delete without an exact match.
- `RISK (low)` — **transcript stolen from the composer.** The matcher-first branch could
  swallow normal dictation. *Mitigation:* strictly gated on "voice-eligible proposal pending";
  `neither` returns the transcript; unit test.
- `RISK (low)` — **timeout surprises the user** mid-thought. *Mitigation:* visible countdown +
  90 s is generous; "repeat" resets nothing but re-speaks; a timeout produces a clear message,
  and the user can just ask again.

---

## Rollback strategy

`MVP DECISION` — **`voice_confirm_enabled = false` is a complete rollback** with no code revert
(`41` §10). Off ⇒ the matcher-first branch is never entered, proposals are button-only, and the
app is byte-identical to end-of-EP-6 for confirmation. Edit/delete-by-conversation remain (they
are button-confirmable and don't depend on voice), but if edit/delete themselves regress, a
second lever — refusing `reminder_update`/`reminder_delete` in the dispatcher's
`requireCapabilityEnabled` (`36` §2) — reverts to create-only conversation, still a working
app. The full offline reminder loop (create → confirm → schedule → notify + speak) is never at
risk because it does not depend on any EP-7 code.

---

## Definition of Done

Re-asserts the `41` §8 cross-cutting invariants, plus EP-7 specifics:

1. **`41` §8.1** — The full reminder loop works offline with no OpenAI key (create → confirm →
   schedule → notify + speak), and voice-confirm works with **sherpa STT + Windows TTS** (no key).
2. **`41` §8.2** — Wireshark: **zero outbound packets** with all cloud off, *including while
   using voice confirmation* (the matcher and offline STT/TTS make no network call).
3. **`41` §8.3** — The confirmation gate holds: nothing consequential persists without a human
   **or voice** Confirm; **timeout = cancel** (never auto-confirm); the safe-settings carve-out
   is untouched by EP-7.
4. **`41` §8.4** — API key never crosses IPC (EP-7 adds no key IPC).
5. **`41` §8.5** — The LLM never interprets a confirmation; the matcher is local, closed-set, in
   main.
6. **`41` §8.6** — Notification + history fire unconditionally and first on every edit/delete.
7. **Voice confirm/cancel/repeat** work per Voice Testing; ambiguous → neither; 90 s → cancel;
   false-positives prevented.
8. **Edit** (`reminder_update`) and **delete** (`reminder_delete`) work by conversation, resolve
   refs fail-closed (0 → clarify, >1 → disambiguate), and show the resolved target before acting.
9. `voice_confirm_enabled = false` yields button-only confirmation, verified identical to EP-6.
10. Phase test checklist green; the `53` §8 regression suite green (`41` §11).

---

## Feature Checklist

**Already completed (prior phases — reused, not rebuilt):**
- Action Dispatcher, gates, pending-proposal store, `action:confirm/cancel` IPC (EP-6, `36`).
- `reminder_create` re-routed through the dispatcher (EP-6, `41` §6 regression gate).
- STT capture + `SpeechProvider` + `speech:partial`/`stop()` (EP-3, `44`).
- TTS provider + `audio:playBytes` + chosen voice/rate (EP-4, `45`).
- Reminder repo `create/update/delete` + business rules + scheduler reconcile (`30` §13).
- Proposal-as-message-variant (create) UI (EP-6).

**New work (this phase):**
- `VoiceConfirmMatcher` (local closed-phrase, main).
- Matcher-first transcript routing while a proposal is pending.
- 90 s timeout = cancel, armed per proposal.
- `reminder_update` edit flow: ref resolve → resolved before/after card → confirm → execute.
- `reminder_delete` flow: ref resolve → resolved-row card → confirm → execute.
- Disambiguation (>1) and clarification (0) UI for `reminderRef`.
- "repeat" command re-speaks the pending proposal via TTS.
- `voice_confirm_enabled` flag wired.

**Deferred work (to EP-8, `49`):**
- The `voice_confirm_enabled` **toggle UX** and its placement in the redesigned Settings.
- Any settings polish around STT/TTS provider choice that voice-confirm quality depends on.

**Future work (`FUTURE OPTION`):**
- Barge-in / interrupt-while-Yogi-speaks as a first-class capability (EP-11 polish).
- Utility-process STT isolation so a long confirm-listen never janks the scheduler (`30` §6).
- Multi-turn edits ("no, make it 10 not 9") without re-proposing from scratch.
- Confidence-scored matcher / per-locale phrase sets (post-1.0).

---

## Manual Testing

| # | Step / Action | Expected Result |
| --- | --- | --- |
| 1 | Enable `voice_confirm_enabled`; ensure a key-less offline setup (sherpa STT, Windows TTS). | Voice-confirm active with no network. |
| 2 | Dictate "remind me to call mom at 6pm." | A **create** proposal card appears with resolved absolute+relative time; card shows "🎙 Say yes or no." |
| 3 | Say "yes." | Matcher → `action:confirm`; reminder created; Yogi speaks/writes "Done — I'll remind you at 6pm"; Schedules shows it. |
| 4 | Dictate another reminder; say "no." | Matcher → `action:cancel`; card dismisses; "Okay, cancelled"; nothing persisted. |
| 5 | Dictate a reminder; press the **Confirm button** instead of speaking. | Same create outcome — button path unchanged from EP-6. |
| 6 | Say "move the call mom reminder to 7pm." | An **update** proposal shows *6pm → 7pm* for the resolved reminder. |
| 7 | Say "yes." | Reminder updated to 7pm; `reminders:changed`; scheduler reconciles; History notes an edit. |
| 8 | Say "delete the call mom reminder." | A **delete** card shows the exact resolved row (title + 7pm). |
| 9 | Say "yes." | Reminder deleted; confirmation message; row gone from Schedules. |
| 10 | Create a reminder; say "repeat." | Yogi re-speaks the proposal ("Set a reminder to … at …?"); card stays pending. |
| 11 | Create a reminder; wait 90 s in silence. | Card auto-cancels; "the request timed out"; nothing persisted. |
| 12 | With 3 reminders present, say "delete my reminder." | Disambiguation card lists all 3; **no** blind Confirm. |
| 13 | Say "delete my dentist reminder" when none exists. | Clarification message "I couldn't find a reminder like that"; no card, no delete. |
| 14 | Turn `voice_confirm_enabled` **off**; dictate a reminder. | Card shows **buttons only**, no "say yes/no" line; saying "yes" does nothing; button confirms. |
| 15 | Enable OpenAI STT (keyed + consented); repeat steps 2–3. | Identical behaviour, better transcription; traffic to `api.openai.com` only (`32` §3.2). |

---

## Edge Cases

- **Qualified answer** — "yes but make it 7 not 6" → `neither` (matcher won't confirm a
  half-instruction); card stays pending; ideally Yogi re-proposes with the correction if the LLM
  path is on, else "Sorry — yes or no?"
- **Two utterances race** — user says "yes" as the 90 s timeout fires. The pending store is
  single-use keyed by `turnId`; whichever reaches `dispatch` first wins, the other is a no-op on
  a cleared proposal (`36` §4.3). No double-execute.
- **Ref matches a paused reminder** — resolution still finds it (active set includes paused);
  the card shows it; editing an interval is re-validated (`36` §3).
- **Update pushes time into the past** — normalisation re-validates `scheduledAt` against
  `CreateReminderInput` (future-date rule); rejected before confirm with a clarification (`36` §3).
- **Delete of a recurring reminder** — the card is explicit it removes the whole series (matches
  TriggerModal's "snooze hidden for recurring" caution, `TriggerModal.tsx:37`); no partial delete.
- **Mic yields empty/garbage transcript** while pending → `neither`; card stays; no action.
- **Provider switched mid-pending** (offline↔OpenAI STT) — the open proposal is unaffected; the
  next utterance uses the new provider (`33` §5, `35` §13).

---

## Failure Cases

- **STT fails at confirm time** (network/mic) → cannot hear "yes"; card stays pending, buttons
  still work; one non-modal notice "Couldn't hear you — use the buttons or try again" (`32` §5).
- **Matcher returns `affirm` but the execute fails** (DB write error) → sanitised assistant
  message, proposal cleared, nothing half-applied (`36` §5); reminder not created; logged reason
  code + input **hash**, never the input (`32` §5, `11` §12).
- **Ref resolves but the row was deleted concurrently** (rare) → execute finds no row → fail-safe
  "that reminder no longer exists," no crash.
- **TTS fails on "repeat"** → the text version of the proposal is still on screen; degrade to
  Windows voice or silent, notification/history unaffected (`35` §7).
- **Timeout timer leaks** (proposal cleared by confirm but timer still armed) → the timer's
  `action:cancel` on an already-cleared `turnId` is a rejected no-op (`36` §4.3).
- **`voice_confirm_enabled` read fails** → treated as `false` (button-only) — fails safe.

---

## Recovery Tests

1. Kill the network mid-pending (OpenAI STT) → say "yes" → STT fails → buttons still confirm →
   reminder created. Recovery: no data lost, path degrades to button.
2. Force a DB write error on execute → proposal cleared, error message shown → retry the same
   dictation → succeeds. Recovery: no half-applied state (`36` §5).
3. Open a proposal, quit the app, relaunch → no pending proposal, nothing created (in-memory
   fail-safe). Recovery: clean state.
4. Trigger a timeout, then immediately dictate the same reminder → new proposal, confirm →
   created once. Recovery: no ghost from the timed-out proposal.
5. Disambiguation shown, user picks candidate 2, execute fails once, retry → deletes the right
   row only. Recovery: ref stays bound to the chosen row.

---

## Regression Tests

Per `41` §11 / `53` these are the standing gates EP-7 must keep green:

1. **Full offline reminder loop** — create → confirm → schedule → notify + speak, **no key**,
   with `voice_confirm_enabled` both on and off. Must be byte-identical to EP-6 for create.
2. **Confirmation gate** — nothing consequential persists without a human/voice Confirm; the
   safe-settings carve-out is the only exception (`36` §4.2); deletions/edits always confirm.
3. **Wireshark off → zero** — 30-minute capture with all cloud off, exercising voice confirm,
   edit, delete → **zero** outbound packets (`32` §8.3, `41` §8.2).
4. **Key never leaks** — `settings:get` returns no `sk-`, no ciphertext, `hasApiKey` correct;
   EP-7 adds no key IPC so this is unchanged from EP-1/EP-8 (`34` §10, `16` §6). Assert still green.
5. **Dispatcher pending-proposal invariant** — a forged confirm with a wrong/expired `turnId` is
   rejected; confirm executes only the stored action (`36` §4.3).
6. **TriggerModal untouched** — Dismiss/Snooze/Done still go direct `reminders:*`, not through
   the dispatcher (`36` §6).
7. **Scheduler/recurrence** — edit/delete reconcile correctly; no `last_triggered_at`-on-missed
   regression (`30` D3, `41` §4.2).

---

## Performance Tests

1. **Matcher latency** — 1,000 transcripts through `VoiceConfirmMatcher.match()` < 5 ms total
   (pure string work).
2. **Confirm round-trip** — dictate "yes" → reminder persisted < 400 ms after final transcript
   (excludes STT decode), no scheduler jank.
3. **Timeout precision** — 90 s ± 1 s across 10 runs; no drift, no double-fire.
4. **Edit/delete reconcile** — a mutation + `reconcile('mutation')` completes within the same
   budget as a create (no `SELECT *`-without-LIMIT growth, `30` §6).
5. **Concurrent proposals** — only one open at a time; opening a new proposal while one is
   pending cancels the first cleanly (no timer leak, no memory growth over 100 cycles).

---

## Expected App Behaviour (Current → EP-7)

```text
Create (button, EP-6):
  dictate → composer → chat:send → LLM/parser → chat:done{proposal} → card
  → user PRESSES Confirm → action:confirm(turnId) → dispatcher executes stored action
  → reminder created → notify+history first → speak → "Done"

Create (voice, EP-7):
  dictate → card (voice-eligible, 90 s armed, "🎙 say yes or no")
  → user SAYS "yes" → STT final → main matcher: affirm → action:confirm(turnId)
  → same stored action executes → reminder created → notify+history first → speak

Edit (EP-7 new):
  "move the dentist reminder to Friday" → normalise resolves reminderRef (fail-closed)
  → chat:done{update proposal: Wed→Fri} → card → "yes"/Confirm
  → reminder_update executes → reminders:changed → reconcile → "Moved to Friday"

Delete (EP-7 new):
  "delete my 9am one" → resolve ref → card shows the exact resolved row
  → "yes"/Confirm → reminder_delete → reminders:changed → reconcile → "Deleted"

Timeout / cancel:
  card open → 90 s silence OR "no"/"cancel" → action:cancel(turnId) → proposal cleared
  → nothing persisted → "cancelled" / "timed out"
```

---

## Conversation Testing

- **User:** "Remind me to take my meds at 9pm."
  **Expected:** create proposal, resolved 9:00 PM tonight; on "yes"/Confirm → created + spoken.
- **User:** "Actually move that to 9:30."
  **Expected:** `reminder_update` resolves the just-made reminder; card shows 9:00 → 9:30; confirm updates it.
- **User:** "Delete the meds reminder."
  **Expected:** delete card shows the resolved row; confirm removes it; "Deleted."
- **User:** "Delete my reminder." (three exist)
  **Expected:** disambiguation card lists all three; no blind Confirm; user picks one.
- **User:** "Cancel." (a create proposal is pending)
  **Expected:** proposal cancelled, nothing created.
- **User:** "What did you say?" (proposal pending)
  **Expected:** matcher → `repeat`; Yogi re-speaks the proposal; card stays pending.
- **User:** "Move the dentist reminder to yesterday."
  **Expected:** re-validation rejects a past time; clarification, no update.
- **User (no cloud, offline):** "Remind me to stretch in 10 minutes." → "yes."
  **Expected:** works fully offline (sherpa STT + local matcher + Windows TTS); zero packets.

---

## Voice Testing

Required coverage (`36` §4.1; false-positive prevention is a gate):

| # | Utterance (proposal pending) | Matcher result | Expected |
| --- | --- | --- | --- |
| 1 | "yes" / "yeah" / "yep" / "confirm" / "do it" / "go ahead" | `affirm` | `action:confirm` — stored action executes. |
| 2 | "no" / "nope" / "cancel" / "stop" / "don't" | `negate` | `action:cancel` — proposal cleared, nothing persists. |
| 3 | "repeat" / "say again" / "read it back" | `repeat` | Yogi re-speaks the proposal; card stays pending. |
| 4 | "maybe later" / "I'm not sure" / "hmm" | `neither` | No action; card stays pending; optional "yes or no?" prompt. |
| 5 | "yes but change the time to 8" | `neither` | **Not** a confirm — qualified answer; card stays pending (re-propose if LLM on). |
| 6 | 90 s of silence | (timeout) | `action:cancel` — timeout = cancel, never auto-confirm. |
| 7 | User starts speaking a new request while Yogi is speaking the prompt | interrupt | Current speech best-effort; the new utterance is captured; the pending proposal still needs an explicit yes/no or times out (barge-in as first-class = FUTURE). |
| 8 | Background chatter "…yeah sounds good…" with no intent to confirm | `affirm` risk | **False-positive prevention:** matcher only runs while a proposal is pending; test asserts that with **no** proposal pending, the same audio never triggers a confirm; and the explicit buttons remain the trusted path. |
| 9 | "no thanks, I'll do it myself" | `negate` (contains "no") vs intent | Acceptable to treat as cancel (fails safe — cancel never persists); documented that negate-leaning phrases cancel. |
| 10 | Empty/garbled transcript | `neither` | No action; card stays pending. |
| 11 | `voice_confirm_enabled` off + "yes" | (not routed) | Matcher never runs; only the button confirms. |
| 12 | OpenAI STT on, "yes" | `affirm` | Same outcome, better transcription; traffic to `api.openai.com` only. |

`MVP DECISION` — The **safe direction on ambiguity is always "do not confirm."** A missed "yes"
costs the user one button press; a false "yes" would persist an unwanted action — so the matcher
is deliberately conservative, and cancel/timeout always fail safe (`36` §4.1, §7).
