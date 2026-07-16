# 22 — Privacy Policy and Disclosures

> This document is written to be **copied into `PRIVACY.md` and shipped**. It is also written to be *true*, which means it says several things a marketing page would not.

---

## Part A — The user-facing privacy statement

*(This section is the shippable `PRIVACY.md`.)*

---

# LifeOS Privacy Statement

**Last updated:** 10 July 2026 · **Applies to:** LifeOS 0.1.0

## The short version

LifeOS has no server. It has no account. It has no telemetry. Your reminders live in a file on your computer, and nothing is sent anywhere unless you turn on a feature that is off by default.

## What LifeOS stores, and where

Everything lives in one folder:

```text
%APPDATA%\LifeOS\
  lifeos.db        your reminders, history, and settings (a standard SQLite file)
  logs/            local diagnostic logs
```

Inside `lifeos.db`:

| Table | What it holds |
| --- | --- |
| `reminders` | Title, description, when it fires, whether it repeats |
| `reminder_history` | When reminders fired, and what you did about them |
| `settings` | Your preferences, and your AI Assist key if you set one (encrypted) |
| `app_logs` | Local diagnostics, kept 14 days |
| `memories`, `conversations` | **Empty.** Created for a future version. LifeOS 0.1.0 writes nothing here. |

You can open this file with any SQLite browser and read every byte of it. Copy it to back it up. Delete it to start over. There is no lock-in because there is no server.

## What LifeOS sends over the network

**By default: nothing. Not once.**

LifeOS 0.1.0 makes zero network requests with its default settings. This is not a policy — it is enforced in code, by a network filter that blocks every outbound request that is not on an allowlist, and the allowlist is empty until you change a setting.

You can verify this yourself with Wireshark, and we encourage it.

### The one exception: AI Assist

AI Assist is **off by default**. If you turn it on, you must accept a consent dialog, and you must supply your own OpenAI API key.

When it is on, and **only** when LifeOS is not confident it understood your command:

| Sent to OpenAI | Never sent |
| --- | --- |
| The **text** of that one command | Any audio, ever |
| The current date, time and your timezone | Your reminders |
| | Your reminder history |
| | Your memories or notes |
| | Your settings |
| | Your name, email, device ID, or any identifier |

Requests go directly from your computer to OpenAI, under your own API key, billed to your own OpenAI account. LifeOS has no server in the middle, and its authors never see your data or your bill.

You can see when it was last used in **Settings → AI Assist → Last used**.

## Speech

Your voice is transcribed **on your computer**, by a speech model that ships inside the app. Audio never leaves your machine and is never written to disk. It exists in memory while you speak, and is discarded when you stop.

There is no wake word. There is no background listening. The microphone opens when you press the button and closes when you press it again, after two seconds of silence, or after thirty seconds — whichever comes first. While it is open, the button pulses.

Windows asks for microphone permission the first time you press the button, not when you install.

## Your API key

If you enable AI Assist, your OpenAI key is encrypted using Windows DPAPI (via Electron's `safeStorage`) and stored in the local database. It is tied to your Windows user account.

**Be precise about what that protects.** It protects against someone copying your `%APPDATA%` folder to another machine, or reading the database file directly. It does **not** protect against software already running as you on your computer — nothing on a desktop can. Any application you run has the same access to DPAPI that LifeOS does.

If Windows reports that secure storage is unavailable, LifeOS refuses to save your key to disk and offers to hold it in memory for the session instead. It will never write your key in plain text.

## Telemetry, analytics, crash reports

None. There is no analytics SDK, no crash reporter, no "anonymous usage statistics", no update ping. LifeOS does not know you exist.

Crash reports would contain the contents of memory, which would contain your reminders. So there are none. If LifeOS crashes and you want to help, **Settings → Open logs folder** shows you exactly what would be shared, and you decide whether to attach it to a GitHub issue. Please read it first — your reminder titles are in there.

## Deleting your data

**Settings → Reset LifeOS Local Data.** You will be asked to type `RESET`.

This deletes everything inside `%APPDATA%\LifeOS\` — reminders, history, settings, your encrypted API key, and logs. It touches nothing else on your computer. It cannot touch anything else: the folder is resolved by the operating system, not by anything you can configure, and the code refuses to delete a path that is not that folder.

**Uninstalling LifeOS does not delete your data.** `%APPDATA%\LifeOS\` remains. That is deliberate — reinstalling should not lose your reminders. Delete the folder by hand if you want it gone.

## What LifeOS will never do

LifeOS runs as your normal Windows user account and never asks for administrator access. It will never:

- Modify Windows system files, the registry (beyond its own uninstall entry), or install drivers or services
- Create Windows Task Scheduler jobs
- Run shell or PowerShell commands built from anything you say or type
- Execute code, scripts or commands returned by an AI model
- Read or delete files outside its own data folder
- Add itself to Windows startup without you explicitly asking
- Install software, make purchases, send messages, or control your computer
- Upload your data anywhere by default

If a future version of LifeOS ever needs to do any of these, it will ask, and it will explain why, and you will be able to say no.

## Children

LifeOS is not directed at children under 13 and collects no information about anyone.

## Changes

This statement lives in the repository. Its history is the commit log. If it changes, you can see exactly what changed and when.

## Contact

Open an issue at `github.com/<user>/lifeos`.

---

## Part B — Internal notes (not shipped)

*(This section is for the developer. It records why the statement above says what it says.)*

### B1 — Claims we make, and how each is enforced

A privacy policy that is not enforced by code is a wish. Each claim above maps to a mechanism and a test.

| Claim | Mechanism | Test |
| --- | --- | --- |
| Zero network by default | `session.webRequest.onBeforeRequest` default-deny (`11` §4) | Wireshark, 30 min, `18` §10 |
| Audio never leaves the device | STT runs in the main process; no code path sends PCM anywhere | Code review + the payload test |
| Audio never written to disk | Frames are in-memory `ArrayBuffer`s, dropped on stop | Procmon: no `.wav`/`.pcm` writes |
| Only command text goes to OpenAI | Request body built from exactly `{transcript, nowIso, timezone}` | `tests/unit/ai-payload.test.ts` — asserts a seeded reminder title is absent |
| AI Assist off by default | `ai_assist_enabled = 'false'` in `SETTING_DEFAULTS` | Fresh-install integration test |
| Consent is required | Checked **in main**, not the renderer | `ai-assist-consent.test.ts` — `fetch` never called |
| Key never crosses IPC | `settings:get` destructures it out; returns `hasApiKey` | `ipc-contracts.test.ts` — greps the JSON for `sk-` |
| No telemetry | No SDK in `package.json`; `crashReporter` never started | Dependency review |
| Reset deletes only our folder | Path from `app.getPath('userData')`; two guards; **no-argument IPC handler** | Symlink test |
| No admin required | `nsis.perMachine: false` | Fresh-VM install, no UAC |
| No registry / Task Scheduler | Nothing in the code does this | Procmon |
| No shell from user/LLM input | ESLint bans `child_process` outside one allowlisted file | Lint + `grep` in the release checklist |

`MVP DECISION` — **The Wireshark check is the most important test in the project**, because it is the only one that tests the product's actual claim rather than an implementation detail. It goes in the demo video.

### B2 — Where we deliberately under-claim

Honesty here is a feature, and it is also self-protection.

| Weaker claim | Why we don't claim more |
| --- | --- |
| DPAPI "protects a copied folder, not malware running as you" | True. Overclaiming here would be a lie that a security researcher would find in five minutes and publish. |
| "Encrypted **if possible**" → we say "if Windows reports secure storage is unavailable, we refuse to save it" | `safeStorage.isEncryptionAvailable()` can be false. The honest behaviour is to refuse, not to silently downgrade. |
| We do **not** say "military-grade encryption" | It is DPAPI. It is fine. It is not that. |
| We do **not** say "your data is 100% secure" | Nothing is. We say where it is and who can read it. |
| We say memories tables are **empty** | They exist in the schema. A user opening the DB would find them and reasonably wonder. Pre-empt it. |
| We say uninstall does **not** delete data | Users assume it does. Surprising them later is worse than telling them now. |

### B3 — The disclosure text, verbatim

The brief specifies this string. It appears in Settings and in the consent modal, unchanged:

> *AI Assist may send your command text to your selected AI provider when local understanding is uncertain. Your reminders and local data remain stored on your device.*

`MVP DECISION` — Do not paraphrase it in either surface. If it changes, it changes in both places, in the same commit.

### B4 — The consent dialog

Enabling AI Assist opens a modal. **The toggle does not flip until the modal is accepted.** Copy in `12` §8.2. Key properties:

1. It states what is sent **and** what is never sent, as two lists, side by side.
2. It states that the user pays OpenAI, not us, and gives a realistic monthly figure (well under ₹1).
3. It records `ai_consent_accepted_at` as a timestamp.
4. The main process refuses the network call if that timestamp is absent — **the renderer's UI state is not the enforcement point.**

### B5 — GDPR / DPDP posture

`ASSUMPTION` — LifeOS 0.1.0 is not a data controller or processor under GDPR or India's DPDP Act, because it never receives personal data. All processing is local, by the data subject, on their own device, for personal use. There is no service to which a data-subject request could be addressed.

`RISK (future)` — This changes the moment any of these ship: cloud sync, an account system, a crash reporter, a telemetry endpoint, or a hosted LLM proxy. **Any one of them makes LifeOS a data controller** and brings a real compliance obligation with it. That is a product decision, not an engineering one, and it should be made deliberately.

`MVP DECISION` — Record this in `24-future-roadmap.md` against every feature that would trip it. Cloud sync is not "just a sync feature"; it is the feature that ends this document's ability to say "there is no server."

### B6 — Third-party components in the shipped binary

| Component | Phones home? | Notes |
| --- | --- | --- |
| Electron / Chromium | **Potentially** | Disabled: `spellcheck: false` (Chromium's spellchecker downloads dictionaries from Google's CDN). No `crashReporter`. No `autoUpdater` in 0.1.0. The default-deny network filter catches anything missed. |
| sherpa-onnx + model | No | Local inference. Model bundled in the installer. |
| chrono-node, luxon, zod, React | No | Pure computation. |
| Windows TTS voices | No | OS-local. **Not** `edge-tts`, which is cloud — see below. |

`VERIFIED FACT` — **`edge-tts` connects to Microsoft's online TTS WebSocket endpoint.** Had it been chosen as the default voice (it is a common recommendation, and it sounds good), every spoken reminder would have silently transmitted its text to Microsoft, and this privacy statement would have been false. It was rejected for exactly that reason (`07` §4).

`MVP DECISION` — Any future dependency that opens a socket must be reviewed against this document **before** it is added, not after. The default-deny network filter means such a dependency will fail loudly rather than exfiltrate quietly — which is precisely why the filter exists.
