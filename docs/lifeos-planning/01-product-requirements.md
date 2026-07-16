# 01 — Product Requirements

> **Status:** Baseline requirements, restated and disambiguated from the original brief.
> **Audience:** The solo developer building the MVP, and Claude Code acting as implementer.

---

## 1. Product identity

| Field | Value |
| --- | --- |
| Product name | **LifeOS** |
| Assistant persona | **Yogi** |
| Codename | Yogi |
| Category | Privacy-first local AI personal companion ("Second Brain") |
| MVP platform | Windows 10 (1809+) and Windows 11, x64 |
| Distribution | GitHub Releases (NSIS installer + portable `.exe`) |
| Operating cost target | ₹0 / month |

## 2. The one sentence that defines the MVP

> LifeOS proves that a user can speak a natural reminder, see exactly how Yogi understood it, confirm it, and have Yogi reliably remind them at the right time — entirely offline, on their own machine.

Everything that does not serve that sentence is out of scope. See `03-mvp-scope-and-non-goals.md`.

## 3. The core loop

```text
Voice (or typed text)
  → Transcript
    → Intent + slot extraction
      → Ambiguity check
        → Confirmation card (user must approve)
          → Persisted to local SQLite
            → Scheduler holds it
              → Trigger: notification + spoken reminder (+ optional MP3)
                → History record
```

**Non-negotiable property:** nothing is written to the reminder store without an explicit user confirmation action. There is no "auto-create" path, not from the local parser and not from an LLM.

## 4. Functional requirements

### FR-1 — Input

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1.1 | User can type a command into a text box and submit it. | **P0** |
| FR-1.2 | User can press a microphone button, speak, and press stop. | **P0** |
| FR-1.3 | Partial ("interim") transcript is rendered word-by-word while speaking. | **P1** |
| FR-1.4 | Final transcript is editable before Yogi parses it. | **P1** |
| FR-1.5 | Microphone permission is requested once, explained in onboarding. | **P0** |

> **FR-1.1 is P0 and FR-1.2 is P0, but FR-1.1 must be built first.** Typed input is the fallback that keeps the product demonstrable if speech integration slips. See `02-assumption-challenge-and-recommendations.md` §2.

### FR-2 — Understanding

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-2.1 | Extract intent from a fixed allow-list: `create_reminder`, `create_sing_reminder`, `unknown`. | **P0** |
| FR-2.2 | Extract reminder title (the action to be reminded of). | **P0** |
| FR-2.3 | Extract absolute scheduled datetime from relative phrasing ("in 5 minutes", "after 2 hours"). | **P0** |
| FR-2.4 | Extract absolute datetime from calendar phrasing ("tomorrow at 9 AM", "on 25 July at 6 PM", "next Friday at 10 AM"). | **P0** |
| FR-2.5 | Extract weekly recurrence ("every Monday at 7 AM") into an RRULE string. | **P0** |
| FR-2.6 | Produce a confidence score in `[0,1]`. | **P0** |
| FR-2.7 | Detect when a required slot is missing or ambiguous and emit a clarification question instead of guessing. | **P0** |
| FR-2.8 | Record the IANA timezone at creation time. | **P0** |
| FR-2.9 | Optional LLM fallback when local confidence < threshold, only if user enabled AI Assist. | **P2** |

### FR-3 — Confirmation

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-3.1 | Show a structured interpretation card: title, resolved absolute date+time in human words, recurrence in plain language, action type. | **P0** |
| FR-3.2 | Card offers **Confirm**, **Edit**, **Cancel**. | **P0** |
| FR-3.3 | Edit opens a form with title, date, time, repeat — all editable. | **P0** |
| FR-3.4 | Yogi speaks a confirmation sentence when the card appears. | **P1** |
| FR-3.5 | Nothing is persisted until Confirm is pressed. | **P0** |
| FR-3.6 | The resolved date must be displayed as an unambiguous absolute ("Saturday, 11 July 2026, 9:00 AM"), never only as "tomorrow". | **P0** |

### FR-4 — Storage

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-4.1 | Reminders persist in SQLite under `%APPDATA%/LifeOS/`. | **P0** |
| FR-4.2 | Schema versioned by migrations. | **P0** |
| FR-4.3 | All SQL parameterized. | **P0** |
| FR-4.4 | Reminders survive app restart and machine reboot. | **P0** |
| FR-4.5 | Execution history recorded per trigger. | **P1** |
| FR-4.6 | Schema includes forward-looking `memories` and `conversations` tables (unused by MVP UI). | **P2** |

### FR-5 — Scheduling

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-5.1 | Scheduler runs in the **main process**, not the renderer. | **P0** |
| FR-5.2 | Scheduler uses a periodic tick that queries for due reminders — **not** a single long `setTimeout`. | **P0** |
| FR-5.3 | On app start, overdue reminders are detected and surfaced as "missed while LifeOS was closed". | **P0** |
| FR-5.4 | After a recurring reminder fires, the next occurrence is computed and stored. | **P0** |
| FR-5.5 | Scheduler re-syncs on `powerMonitor` `resume`. | **P1** |
| FR-5.6 | User can pause/resume all reminders. | **P1** |
| FR-5.7 | User can edit and delete individual reminders. | **P0** |

### FR-6 — Trigger actions

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-6.1 | Windows toast notification appears. | **P0** |
| FR-6.2 | Yogi speaks the reminder text aloud. | **P0** |
| FR-6.3 | An in-app reminder modal appears (window is shown/focused). | **P1** |
| FR-6.4 | If `action_type = 'sing'`, a bundled MP3 plays. | **P0** |
| FR-6.5 | User can Dismiss or Mark Complete; Snooze if the reminder is not recurring. | **P1** |
| FR-6.6 | Trigger works while the window is hidden in the system tray. | **P0** |

### FR-7 — Tray & lifecycle

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-7.1 | Close button hides to tray; does not quit. | **P0** |
| FR-7.2 | One-time explanatory message on first close-to-tray. | **P0** |
| FR-7.3 | Tray menu: Open LifeOS, View Active Schedules, Pause Reminders, Resume Reminders, Quit LifeOS. | **P0** |
| FR-7.4 | Quit fully exits; documented that reminders will not fire while quit. | **P0** |
| FR-7.5 | Single-instance lock — a second launch focuses the existing window. | **P1** |
| FR-7.6 | App does **not** add itself to Windows startup. | **P0** |

### FR-8 — Settings & privacy

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-8.1 | Privacy panel stating no data leaves the device by default. | **P0** |
| FR-8.2 | AI Assist toggle, default **off**. | **P1** |
| FR-8.3 | API key field; stored encrypted via Electron `safeStorage`. | **P1** |
| FR-8.4 | "Reset LifeOS Local Data" wipes only `%APPDATA%/LifeOS/`. | **P0** |
| FR-8.5 | STT/TTS provider selectors (may show only one implemented option). | **P2** |
| FR-8.6 | About panel with version, license, links. | **P1** |

## 5. Non-functional requirements

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-1 | Cold start to interactive window | < 3 s |
| NFR-2 | Parse latency (local, typed input) | < 50 ms |
| NFR-3 | Reminder trigger accuracy | within ±30 s of scheduled time (tick interval) |
| NFR-4 | Idle RAM (tray, no STT loaded) | < 250 MB |
| NFR-5 | Installer size | < 200 MB including STT model |
| NFR-6 | Admin rights required | **Never** |
| NFR-7 | Network calls with AI Assist off | **Zero** |
| NFR-8 | Crash on missing microphone | Must degrade gracefully to typed input |

## 6. Safety requirements (hard constraints)

These are restated as testable assertions. See `11-electron-security-architecture.md` for enforcement.

| ID | Assertion |
| --- | --- |
| SEC-1 | The app never requests elevation (no `requestedExecutionLevel: requireAdministrator`). |
| SEC-2 | The app writes only inside `app.getPath('userData')` and reads only from its own resources. |
| SEC-3 | No registry writes. No driver installs. No Windows Task Scheduler entries. |
| SEC-4 | No `child_process` execution derived from user speech, user text, or LLM output. |
| SEC-5 | LLM output is parsed as JSON, schema-validated, and only ever *displayed as a proposal*. It is never executed and never auto-persisted. |
| SEC-6 | Renderer has `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. |
| SEC-7 | Every IPC handler validates its payload against a schema before touching the database. |
| SEC-8 | Reset deletes only the LifeOS userData directory, by absolute path, after a typed confirmation. |
| SEC-9 | No `eval`, no `new Function`, no remote module, no `webSecurity: false`. |
| SEC-10 | CSP forbids remote script origins in the packaged build. |

## 7. Supported command grammar (MVP)

The parser must handle natural variants of the following. This list is the acceptance surface for `18-testing-strategy.md`.

**One-time relative**
- `remind me in 5 minutes to call my mother`
- `remind me after 10 minutes to give medicine to my grandfather`
- `remind me in 2 hours to drink water`
- `remind me after 30 minutes to check the oven`

**One-time absolute**
- `remind me tomorrow at 9 AM to attend the meeting`
- `remind me on 25 July at 6 PM to pay the electricity bill`
- `remind me next Friday at 10 AM to submit the report`
- `remind me tonight at 8 PM to call Rahul`

**Weekly recurring**
- `remind me every Monday at 7 AM to exercise`
- `remind me every Friday at 6 PM to submit my weekly report`
- `remind me every Sunday at 9 AM to call my family`

**Sing action**
- `please sing after 2 minutes`
- `sing after 5 minutes`
- `play the Yogi song in 1 minute`

**Must trigger clarification, not a guess**
- `remind me Friday` → ask for time
- `remind me tomorrow morning` → propose 9:00 AM, ask to confirm
- `remind me at 6` → ask AM or PM
- `remind me later` → ask when
- `remind me after lunch` → ask for a specific time
- `remind me every Monday` → ask for time
- `remind me to call Rahul` → ask when

## 8. Explicit out-of-scope for MVP

Wake word; continuous listening; computer control; Gmail/WhatsApp/Calendar/Drive; cloud sync; accounts; medical/legal/financial advice; open-ended chat; autonomous agents; web browsing; purchases; sending messages or calls; shell execution; file deletion outside userData; vector search; semantic memory recall UI; macOS/Linux/mobile/web builds.

See `03-mvp-scope-and-non-goals.md` and `24-future-roadmap.md`.

## 9. Acceptance definition

The MVP is done when the 23-point checklist in `00-project-summary.md` §Definition of Done passes on a **fresh Windows machine** from the **published GitHub Release artifact** — not from `npm run dev`.
