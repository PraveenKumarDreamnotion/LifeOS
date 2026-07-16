# LifeOS Planning Documents

> Planning for **LifeOS** (assistant: **Yogi**) — a privacy-first AI reminder companion for Windows.
> Target: a polished, publicly released MVP in **7 days**, built by one developer, at **₹0/month**.
>
> **Research date:** July 2026. **Status:** implementation-ready. No code has been written.

---

## Start here

1. **[00-project-summary.md](00-project-summary.md)** — the whole plan in ten minutes.
2. **[02-assumption-challenge-and-recommendations.md](02-assumption-challenge-and-recommendations.md)** — where the original brief was wrong, with citations.
3. **[19-seven-day-roadmap.md](19-seven-day-roadmap.md)** — what to do tomorrow morning.

If you are about to open Claude Code, read **[26-claude-code-implementation-prompts.md](26-claude-code-implementation-prompts.md)** and paste the session preamble first.

---

## All 28 documents

### Product
| File | What it settles |
| --- | --- |
| [00-project-summary.md](00-project-summary.md) | Executive summary. Architecture, risks, spikes, Definition of Done. |
| [01-product-requirements.md](01-product-requirements.md) | Functional and non-functional requirements, prioritised. Safety as testable assertions. |
| [02-assumption-challenge-and-recommendations.md](02-assumption-challenge-and-recommendations.md) | **Twelve assumptions challenged.** Two falsified with evidence. |
| [03-mvp-scope-and-non-goals.md](03-mvp-scope-and-non-goals.md) | Tiered scope with a **pre-decided cut order**. What is prohibited, not merely deferred. |

### Research
| File | What it settles |
| --- | --- |
| [04-technology-research.md](04-technology-research.md) | Consolidated findings. Every claim labelled and cited. |
| [05-framework-decision.md](05-framework-decision.md) | Electron over Tauri and Flutter, and how to keep the decision reversible. |
| [06-speech-to-text-research.md](06-speech-to-text-research.md) | **Vosk is dead.** sherpa-onnx, the fallback ladder, and the audio pipeline. |
| [07-text-to-speech-research.md](07-text-to-speech-research.md) | `speechSynthesis` vs SAPI, the hidden-window throttling risk, and why `edge-tts` is disqualified. |

### Architecture
| File | What it settles |
| --- | --- |
| [08-smart-scheduling-architecture.md](08-smart-scheduling-architecture.md) | **The highest-priority document.** Understanding (Part I) and Firing (Part II). |
| [09-openai-ai-assist-architecture.md](09-openai-ai-assist-architecture.md) | Optional, off by default. Four validation gates. The LLM never actuates. |
| [10-local-database-and-memory-architecture.md](10-local-database-and-memory-architecture.md) | SQLite binding, schema, migrations, retention, and a safe Reset. |
| [11-electron-security-architecture.md](11-electron-security-architecture.md) | Threat model first. Sandbox, CSP, IPC, the `child_process` prohibition. |
| [12-ui-ux-specification.md](12-ui-ux-specification.md) | Six screens, design tokens, copy rules, every empty and error state. |
| [13-system-architecture.md](13-system-architecture.md) | The whole system on one page. Layer laws. Startup order. Failure isolation. |
| [14-folder-structure.md](14-folder-structure.md) | Why `core/` exists, and the four files with codified exceptions. |
| [15-data-models-and-schemas.md](15-data-models-and-schemas.md) | Row → Domain → DTO. Why `scheduledAt` and `nextFireAt` are both columns. |
| [16-api-and-ipc-contracts.md](16-api-and-ipc-contracts.md) | The `window.lifeos` surface, and what is deliberately absent from it. |

### Quality
| File | What it settles |
| --- | --- |
| [17-error-handling-and-edge-cases.md](17-error-handling-and-edge-cases.md) | Every failure has a message, a next action, and a log line. |
| [18-testing-strategy.md](18-testing-strategy.md) | Test what fails **silently**. 95% on the parser, 20% on React. |
| [25-risk-register.md](25-risk-register.md) | Scored risks, pre-decided responses, and the Day-1 spike verdict table. |

### Execution
| File | What it settles |
| --- | --- |
| [19-seven-day-roadmap.md](19-seven-day-roadmap.md) | The brief's sequence, challenged and resequenced. Nine fields per day. |
| [20-daily-implementation-checklists.md](20-daily-implementation-checklists.md) | 20 steps, each with goal / files / instructions / acceptance / manual test / expected result / tests / failure cases / rollback. |
| [26-claude-code-implementation-prompts.md](26-claude-code-implementation-prompts.md) | Copy-paste prompts, plus **the prompts to refuse**. |

### Release
| File | What it settles |
| --- | --- |
| [21-release-and-github-plan.md](21-release-and-github-plan.md) | Packaging, publishing, SmartScreen, checksums, the demo video shot list. |
| [22-privacy-policy-and-disclosures.md](22-privacy-policy-and-disclosures.md) | **Part A ships verbatim as `PRIVACY.md`.** Part B records why. |
| [23-known-limitations.md](23-known-limitations.md) | Ships. Every row is a decision, not an oversight. |
| [24-future-roadmap.md](24-future-roadmap.md) | v0.2 → v1.0, and what is permanently out of scope. |

### v2 — Conversational Yogi (post-MVP)

> The MVP (docs `00`–`26`) is **built and working**; see `current-project-status.md`. These
> documents plan the pivot from a reminder-first app to a **conversation-first AI companion**
> where reminders are one capability among many. They are grounded in an audit of the actual
> shipped code, not the design docs above — where the two disagree, the audit (doc `30`) wins.

| File | What it settles |
| --- | --- |
| [30-current-architecture-audit.md](30-current-architecture-audit.md) | **Phase 0.** What is actually built, verified from code; strengths, debt, doc-vs-code discrepancies, and what must not change. |
| [31-conversation-engine-architecture.md](31-conversation-engine-architecture.md) | **Canonical** intent taxonomy, the `AssistantTurn` structured-output schema, the conversation data model. |
| [32-openai-integration-plan.md](32-openai-integration-plan.md) | OpenAI chat/STT/TTS, and the offline-first reconciliation of "zero network by default." |
| [33-provider-abstraction.md](33-provider-abstraction.md) | `SpeechProvider` / `TextToSpeechProvider` / `LlmProvider` — streaming-vs-batch and the new audio-bytes path. |
| [34-settings-redesign.md](34-settings-redesign.md) | OpenAI key (safeStorage), provider selection, consent, and the privacy-copy reconciliation. |
| [35-voice-system.md](35-voice-system.md) | OpenAI + Windows voices, friendly-name mapping, Preview, the default Yogi voice. |
| [36-action-dispatcher.md](36-action-dispatcher.md) | The central dispatcher, confirmation layer, and execution layer. The LLM never actuates. |
| [37-phase-development-roadmap.md](37-phase-development-roadmap.md) | Independently-releasable phases, each with the full change/testing/rollback template. |
| [38-testing-guide.md](38-testing-guide.md) | The v2 test pyramid, closing the renderer/IPC/speech coverage gaps, and per-phase test gates. |
| [39-release-roadmap-v2.md](39-release-roadmap-v2.md) | Release mapping, go/no-go gates, and the full architecture scalability review. |
| [55-reminder-popup-workflow.md](55-reminder-popup-workflow.md) | **Conversational reminder popup** — the always-on-top desktop toast that speaks the reminder and lets the user act + keep talking. Electron research (always-on-top, focus, multi-monitor, queue), UI spec, P1/P2/P3 phases, testing. Referenced from `12`/`35`/`36`/`41`/`53`. |

---

## Label taxonomy

Every technical claim in these documents carries one of six labels:

| Label | Meaning |
| --- | --- |
| `VERIFIED FACT` | Confirmed against official documentation or a primary source, with a URL. |
| `ASSUMPTION` | Believed true, reasoned from evidence, **not directly confirmed.** Usually paired with a spike. |
| `RISK` | A way this can fail, with likelihood and impact. |
| `RECOMMENDATION` | A judgement call, with reasoning. |
| `MVP DECISION` | Settled. Do not relitigate during the seven days. |
| `FUTURE OPTION` | Deliberately deferred, with the precondition for revisiting it. |

If a claim carries no label, treat it as prose, not as evidence.

---

## The four things you need to know

**1. The confirmation gate is the product.**
Nothing reaches the database without a user pressing Confirm. Not the parser's output, not the LLM's. There is exactly one function that bridges a parsed result to a persistable input, and it has two call sites.

**2. The scheduler is wall-clock authoritative and lives in the main process.**
`setTimeout` fires a 30-day reminder *immediately* (the 2³¹−1 ms cap). Chromium throttles hidden renderers. A persisted `next_fire_at` column plus a 30-second reconcile tick sidesteps both.

**3. Typed input is built before voice.**
Speech is the riskiest component and the product does not depend on it. The core loop is demonstrable on Day 3 with a text box. Voice is an upgrade to something that already works.

**4. Three spikes must run against a packaged build, on Day 1.**
Toasts silently fail without an AppUserModelID. The tray icon is garbage-collected after ~10 seconds — but only when packaged. Hidden-renderer TTS throttling differs packaged. All three look perfect in `npm run dev`.

---

## What is not here

No code. The repository contains these documents and nothing else. That is deliberate: the brief asked for a plan detailed enough that a developer could follow it step by step without redesigning the architecture midway through the week.

Two assets must be **sourced before Day 5**, and neither exists yet:

- `assets/audio/yogi-song.mp3` — royalty-free, ≤ 15 s, ≤ 500 KB, with its provenance recorded in `assets/audio/LICENSE.md`. Do not ship a copyrighted track in a public GitHub Release.
- `tests/fixtures/audio/remind-me-5-min.wav` — 16 kHz mono PCM16, recorded in Audacity. Ten minutes of work, and it is what separates a two-hour resampler bug from a lost day.

---

## The one sentence

> Prove it can be installed on Day 1, prove it can remind you on Day 3, make it hear you on Day 5, and spend the last two days making sure a stranger can trust it.
