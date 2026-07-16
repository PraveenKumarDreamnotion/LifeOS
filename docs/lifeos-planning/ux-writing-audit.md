# UX Writing & Content Audit

> **Date:** 2026-07-15 · **Scope:** every user-facing instructional string in the renderer (`src/`) plus shared voice copy (`core/tts`). Goal: friendly, professional, trustworthy, human, privacy-first, consistent — without hiding what actually happens.
>
> **Scope boundary (stated for honesty):** this pass covers `src/` UI copy. A small amount of user-visible text lives in `core/` and is **test-coupled** — notably the offline chat notice (*"I can set reminders and tell you the time offline — but answering that needs an online AI provider…"*) in `chat-turn-service.ts`. It was left unchanged this pass to avoid breaking the 523-test bar; it already follows the same honest, feature-first voice. Flagged here so the "complete audit" claim stays accurate.

## 1. Areas reviewed

| Area | File(s) |
| --- | --- |
| Onboarding (Welcome / Data / Mic & tray) | `src/features/onboarding/OnboardingFlow.tsx` |
| Main chat + empty state + offline banner | `src/features/chat/ChatScreen.tsx`, `MessageList.tsx`, `MessageBubble.tsx` |
| Settings (Privacy, Speech, Launcher, Reminders, Window/Tray, Danger, About) | `src/features/settings/SettingsScreen.tsx` |
| **OpenAI section + AI / STT consent dialogs** | `src/features/settings/OpenAiKeySection.tsx` |
| **Voice section + TTS consent dialog** | `src/features/settings/VoiceSection.tsx` |
| Gmail integration | `src/features/settings/GmailSection.tsx` |
| Reminder trigger + overdue modals | `src/features/reminders/TriggerModal.tsx`, `OverdueModal.tsx` |
| Reminder popup (chat client) | `src/popup/PopupApp.tsx` |
| Desktop voice launcher | `src/launcher/LauncherApp.tsx` |
| Schedules + History empty states | `src/features/schedules/SchedulesScreen.tsx`, `src/features/history/HistoryScreen.tsx` |
| Mic states / errors | `src/features/chat/MicButton.tsx`, `src/hooks/useSpeech.ts` |
| App rail / status chip / paused banner | `src/app/App.tsx` |
| Voice catalog hints | `core/tts/voice-catalog.ts` |
| Legacy chat (rollback path — lexicon only, no polish) | `src/features/chat/LegacyChatScreen.tsx` |

## 2. Issues found

1. **Alarming, data-transfer-first consent copy.** The three OpenAI consent dialogs and their buttons lead with the scariest possible framing: *"Your voice recording is sent to OpenAI"*, *"Your command text is sent to OpenAI"*, buttons literally reading *"Send my voice to OpenAI"* / *"Send my messages to OpenAI"*. Technically correct, but it makes a safe, opt-in feature feel dangerous.
2. **AI-sounding phrasing.** *"Only your microphone audio for each dictation is sent…"* reads like generated text, not product copy.
3. **Inconsistent terminology** (the biggest "one designer" problem):
   - Local storage is described four different ways: *on your computer* (onboarding), *on this device* (Settings), *on your machine* (Gmail), *on-device* (rail chip).
   - The OpenAI chat feature is named three ways: *Yogi's intelligence*, *Chat & answers (AI Assist)*, *AI Assist*.
   - The three consent buttons use three different grammatical shapes for the same kind of action.
4. **Section title drift.** *"Yogi's intelligence (OpenAI)"*, *"Integrations · Google Gmail"*, *"Danger zone"* — no consistent voice.
5. **Missing reassurance.** The consent dialogs never lead with what stays private; they lead with what leaves.

## 3. Writing guidelines applied

1. **Feature-first, not transfer-first.** Frame the choice as *turning on a capability*, not *sending data away*. `Turn on OpenAI transcription`, not `Send my voice to OpenAI`.
2. **Transparent, never hidden.** Every consent dialog still states plainly what data goes to OpenAI, that it uses the user's own key, and that it's billed to their account — that's what makes consent informed. We reframe the verb; we keep the fact.
3. **Reassure with true, scoped claims only.** No blanket "nothing is stored" (Gmail and reminders *are* stored locally by design). Scope each promise to what the code guarantees: STT/TTS audio *isn't saved to disk*; local data *stays on your device*; *you can switch back anytime*; *uses your own API key*.
4. **Human, concise.** Short sentences. No wall-of-text paragraphs. No robotic constructions.
5. **One consistent tone** via the lexicon below.

## 4. Terminology lexicon (single source of truth)

| Concept | Approved wording | Retired variants |
| --- | --- | --- |
| Where local data lives / is processed | **on your device** | on your computer, on this device, on your machine, on-device (prose) |
| Works without internet | **works offline** / **no internet needed** | — |
| The OpenAI chat feature | **AI chat & answers** (short: *AI chat*) | Yogi's intelligence, AI Assist |
| Enable-a-cloud-feature button | **Turn on OpenAI \<feature\>** (parallel) | Send my voice/messages to OpenAI |
| The key | **your own OpenAI API key**, **billed to your OpenAI account** | — |
| Reassurance closer | **You can switch back anytime.** / **You can turn this off anytime.** | — |
| Assistant | **Yogi** | — |

## 5. Key before → after (full table lives in the status-doc summary)

| Location | Before | After |
| --- | --- | --- |
| STT consent title | Use OpenAI for speech-to-text? | Turn on OpenAI speech-to-text? *(parallel with the other two dialogs)* |
| STT consent lead | **Your voice recording is sent to OpenAI to transcribe it.** | **OpenAI turns your speech into text — using your own API key.** |
| STT consent button | Send my voice to OpenAI | Turn on OpenAI transcription |
| AI consent lead | **Your command text is sent to OpenAI.** | **Your messages are answered by OpenAI — using your own API key.** |
| AI consent button | Send my messages to OpenAI | Turn on OpenAI chat |
| TTS consent lead | **The text Yogi speaks is sent to OpenAI to generate the voice.** | **OpenAI creates Yogi's natural voice from the words being spoken.** |
| TTS consent button | Use OpenAI voices | Turn on OpenAI voices |
| OpenAI section title | Yogi's intelligence (OpenAI) | AI features (OpenAI) |

## 6. Deliverables checklist

- [x] Audit every instructional string
- [x] Rewrite scary / robotic / inconsistent copy
- [x] Consistent terminology (lexicon §4)
- [x] Improved dialog titles + button labels + helper text
- [x] Improved onboarding + privacy copy
- [x] Kept every data-disclosure (informed consent preserved)
- [ ] Screenshots — **not possible in this environment** (no display/GUI surface, per the project's standing note). Substituted with before/after tables + manual test steps in the status doc.
