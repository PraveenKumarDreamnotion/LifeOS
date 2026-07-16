# 10 — Local Database and Memory Architecture

> **Everything in this document lives at `%APPDATA%\LifeOS\` and nowhere else.**

---

## 1. Binding decision

`VERIFIED FACT` — `node:sqlite` no longer requires `--experimental-sqlite` as of **Node 22.13.0 / 23.4.0**. It is a Release Candidate (stability 1.2) offering on-disk databases, ACID transactions, and a synchronous `DatabaseSync` API, with foreign keys and defensive mode on by default. (https://nodejs.org/api/sqlite.html)

`VERIFIED FACT` — Electron 43 bundles **Node 24**, past that gate. The module is compiled into Electron's Node.

`ASSUMPTION (strongly grounded, not doc-confirmed)` — Therefore `require('node:sqlite')` works flag-free in the Electron 43 main process. No official Electron document states this explicitly, and there is a cautionary history: Electron 35 (Node 22.9) exposed it only behind the flag, and passing `--experimental-sqlite` via `appendSwitch` **did not work** (electron/electron#45532, closed). That pain was specific to the pre-22.13 Node bundled at the time.

**→ SPIKE-1 verifies this empirically in 60 minutes, before any schema is written.**

### The payoff, if it holds

| Problem eliminated |
| --- |
| Native module ABI rebuild against Electron |
| Visual Studio Build Tools requirement |
| Python-on-PATH requirement for node-gyp |
| `asarUnpack` configuration |
| Prebuild-availability lag when Electron bumps |
| An entire class of "works on my machine" packaging failures |

### Ranked decision

```text
1. node:sqlite         ← 60-min spike. If green, ship it.
2. better-sqlite3      ← proven fallback.
3. node-sqlite3-wasm   ← if both disappoint.
✗  sql.js              ← DISQUALIFIED.
```

`VERIFIED FACT` — **`better-sqlite3` 12.11.2** (2026-07-03) ships **Electron prebuilds**, including `better-sqlite3-v12.11.2-electron-v133-win32-x64.tar.gz`, across ABI v121→v136+. The widely-repeated 2022-era claim that it has no Electron prebuilds is **false as of 2026**.

`RISK (medium)` — Prebuild coverage lags the newest Electron by weeks (WiseLibs/better-sqlite3#1384 — *"Missing prebuild-install binaries for Node 24/N-API 137"*). **Mitigation:** pin to an Electron major that already has a matching prebuild asset, and keep the toolchain installed so a source build can succeed.

```jsonc
// If the fallback is taken:
"scripts": { "postinstall": "electron-builder install-app-deps" }
"build":   { "asarUnpack": ["**/node_modules/better-sqlite3/**"] }
```

`VERIFIED FACT` — Native `.node` binaries **cannot be loaded from inside a compressed asar** and must be unpacked. `node:sqlite` needs no `asarUnpack` because it lives inside the Electron binary.

`VERIFIED FACT` — **`sql.js` is disqualified.** It is in-memory only; persistence means `db.export()`-ing the whole database and rewriting the file. A crash between exports loses reminders. A reminders app that can lose reminders is not a reminders app.

`RECOMMENDATION` — `node-sqlite3-wasm` is the third option: it implements a Node `fs` VFS and gives **real durable file writes** with no recompilation. Slower and less battle-tested, but a legitimate escape hatch.

## 2. The abstraction that makes the choice reversible

`MVP DECISION` — All SQL lives behind a hand-written adapter with a 6-method surface. Swapping bindings is a one-file change.

```ts
// electron/database/driver.ts
export interface SqliteDriver {
  exec(sql: string): void;
  get<T>(sql: string, params?: unknown[]): T | undefined;
  all<T>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  transaction<T>(fn: () => T): T;
  close(): void;
}

// electron/database/drivers/node-sqlite-driver.ts   ← primary
// electron/database/drivers/better-sqlite3-driver.ts ← fallback, same interface
```

`RISK (low)` — `node:sqlite` lacks better-sqlite3's `.pragma()` sugar; you run `db.exec('PRAGMA journal_mode=WAL')`. The adapter absorbs this.

`RISK (low)` — Both are **synchronous** and run on the main process event loop. For a personal reminders app with single-digit writes per day and tens of rows, this is correct and simple. It would not be for a chat app with a 100k-row history. Revisit only if `app_logs` grows unbounded (§9).

## 3. Location and pragmas

`VERIFIED FACT` — `app.getPath('userData')` = appData + app name, preferring **`productName`** over `name`. On Windows this resolves to `C:\Users\<user>\AppData\Roaming\<productName>`. Call it only after the `ready` event.

```ts
const dbPath = path.join(app.getPath('userData'), 'lifeos.db');
// → C:\Users\<user>\AppData\Roaming\LifeOS\lifeos.db
```

`RISK (low)` — In an unpackaged dev run, the name may fall back to `Electron`. Set a clean `productName: "LifeOS"` in the builder config. A `productName` containing filesystem-illegal characters breaks the path.

`MVP DECISION` — Portable builds use `PORTABLE_EXECUTABLE_DIR` to keep data next to the exe, so a portable LifeOS on a USB stick carries its reminders with it:

```ts
const dataDir = process.env.PORTABLE_EXECUTABLE_DIR
  ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'LifeOS-data')
  : app.getPath('userData');
```

Pragmas applied at open, in order:

```sql
PRAGMA journal_mode = WAL;      -- durability + concurrent reads
PRAGMA foreign_keys = ON;       -- ON by default in node:sqlite; explicit anyway
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;    -- WAL makes FULL unnecessary; NORMAL is crash-safe
```

## 4. Migrations

`VERIFIED FACT` — `PRAGMA user_version` is a free integer in the SQLite header. It is the standard lightweight migration mechanism and needs no metadata table.

```ts
// electron/database/migrate.ts
const migrations: Array<(d: SqliteDriver) => void> = [
  d => d.exec(M001_INITIAL_SCHEMA),   // index 0 → user_version 1
  d => d.exec(M002_MEMORY_TABLES),    // index 1 → user_version 2
];

export function migrate(d: SqliteDriver): void {
  d.exec('PRAGMA journal_mode = WAL');
  const current = d.get<{ user_version: number }>('PRAGMA user_version')!.user_version;

  if (current > migrations.length) {
    throw new DatabaseFromNewerVersionError(current, migrations.length);
  }

  for (let v = current; v < migrations.length; v++) {
    d.transaction(() => {
      migrations[v](d);
      d.exec(`PRAGMA user_version = ${v + 1}`);   // safe: v is a loop index, never user input
    });
  }
}
```

`MVP DECISION` — **Migrations are forward-only and never destructive.** No `DROP TABLE`, no `DROP COLUMN`. SQLite's `ALTER TABLE ADD COLUMN` is cheap; use it.

`MVP DECISION` — **`DatabaseFromNewerVersionError`** — if a user downgrades LifeOS, do not run backwards and do not open the file. Show: *"This data was created by a newer version of LifeOS. Please update, or reset local data."* Silently corrupting a user's reminders on a downgrade is unacceptable.

`MVP DECISION` — Before the *first* migration on an existing database, copy `lifeos.db` → `lifeos.db.bak-v<n>`. Keep the two most recent. This costs kilobytes and buys a rollback.

## 5. Schema — migration 001

```sql
-- electron/database/migrations/001_initial.sql

CREATE TABLE reminders (
  id                TEXT    PRIMARY KEY,           -- uuid v4, generated in main
  title             TEXT    NOT NULL,
  description       TEXT,
  scheduled_at      INTEGER NOT NULL,              -- UTC epoch ms. Original intent.
  next_fire_at      INTEGER NOT NULL,              -- UTC epoch ms. THE SCHEDULER READS THIS.
  timezone          TEXT    NOT NULL,              -- IANA, e.g. 'Asia/Kolkata'
  recurrence_rule   TEXT,                          -- RRULE string, or NULL
  action_type       TEXT    NOT NULL DEFAULT 'notify',
  status            TEXT    NOT NULL DEFAULT 'pending',
  source            TEXT    NOT NULL DEFAULT 'local',   -- 'local' | 'llm' | 'manual'
  is_paused         INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  completed_at      INTEGER,
  last_triggered_at INTEGER,

  CHECK (action_type IN ('notify', 'sing')),
  CHECK (status IN ('pending', 'triggered', 'completed', 'dismissed', 'cancelled', 'missed', 'error')),
  CHECK (source IN ('local', 'llm', 'manual')),
  CHECK (is_paused IN (0, 1)),
  CHECK (length(trim(title)) > 0),
  CHECK (next_fire_at > 0)
);

-- The scheduler's hot query. Partial index: only pending, unpaused rows matter.
CREATE INDEX idx_reminders_due
  ON reminders (next_fire_at)
  WHERE status = 'pending' AND is_paused = 0;

CREATE INDEX idx_reminders_status ON reminders (status, next_fire_at DESC);

CREATE TABLE reminder_history (
  id           TEXT    PRIMARY KEY,
  reminder_id  TEXT    NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  title_at_time TEXT   NOT NULL,          -- denormalised: history survives a title edit
  triggered_at INTEGER NOT NULL,
  action_taken TEXT    NOT NULL DEFAULT 'triggered',
  dismissed_at INTEGER,
  completed_at INTEGER,
  snoozed_to   INTEGER,

  CHECK (action_taken IN ('triggered', 'dismissed', 'completed', 'snoozed', 'missed', 'failed'))
);

CREATE INDEX idx_history_reminder ON reminder_history (reminder_id, triggered_at DESC);
CREATE INDEX idx_history_time     ON reminder_history (triggered_at DESC);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE app_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  level      TEXT    NOT NULL,
  module     TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  context    TEXT,                        -- JSON blob, PII-scrubbed
  created_at INTEGER NOT NULL,

  CHECK (level IN ('debug', 'info', 'warn', 'error'))
);

CREATE INDEX idx_logs_time ON app_logs (created_at DESC);
```

### Notes on the deviations from the brief's suggested schema

| Change | Why |
| --- | --- |
| Added `next_fire_at` alongside `scheduled_at` | `scheduled_at` records what the user asked for. `next_fire_at` is what the scheduler compares against `Date.now()`. For a recurring reminder they diverge after the first fire. Conflating them means either losing the original intent or corrupting the schedule. **This column is the whole scheduler.** |
| `id` is `TEXT` (uuid), not `INTEGER` | Renderer-generated optimistic UI; no round-trip to learn an id. Also survives an export/merge in a future sync. |
| Times are `INTEGER` epoch-ms, not ISO strings | Integer comparison in the hot `findDue` query. Formatting is a display concern. Timezone is stored separately and explicitly. |
| Added `is_paused` | The brief wants per-reminder pause. A status enum value would conflate "paused" with "cancelled". |
| Added `source` | Provenance. History can show *"understood by AI Assist."* |
| Added `status = 'missed'` and `'error'` | The brief's status list has nowhere to put a reminder that was due while the app was closed, or one with an unparseable rule. Silently dropping either is the alternative. |
| `title_at_time` denormalised into history | Editing a reminder's title must not rewrite the past. |
| `CHECK` constraints throughout | The database is the last line of defence, after Zod and the IPC validator. Cheap. |
| Partial index on `idx_reminders_due` | The scheduler queries it every 30 seconds forever. |

## 6. Repository — parameterized, always

The brief: *"Use parameterized SQL queries. Never concatenate user text directly into SQL."*

```ts
// electron/database/reminder-repository.ts
export class ReminderRepository {
  constructor(private readonly db: SqliteDriver) {}

  create(input: CreateReminderInput): Reminder {
    const now = Date.now();
    const row: ReminderRow = {
      id: randomUUID(),
      title: input.title,
      description: input.description ?? null,
      scheduled_at: input.scheduledAtUtcMs,
      next_fire_at: input.scheduledAtUtcMs,
      timezone: input.timezone,
      recurrence_rule: input.recurrenceRule ?? null,
      action_type: input.actionType,
      status: 'pending',
      source: input.source,
      is_paused: 0,
      created_at: now,
      updated_at: now,
      completed_at: null,
      last_triggered_at: null,
    };

    this.db.run(
      `INSERT INTO reminders
         (id, title, description, scheduled_at, next_fire_at, timezone, recurrence_rule,
          action_type, status, source, is_paused, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.id, row.title, row.description, row.scheduled_at, row.next_fire_at, row.timezone,
       row.recurrence_rule, row.action_type, row.status, row.source, row.is_paused,
       row.created_at, row.updated_at],
    );
    return toDomain(row);
  }

  /** The scheduler's hot path. Hits idx_reminders_due. */
  findDue(nowMs: number): Reminder[] {
    return this.db.all<ReminderRow>(
      `SELECT * FROM reminders
        WHERE status = 'pending' AND is_paused = 0 AND next_fire_at <= ?
        ORDER BY next_fire_at ASC
        LIMIT 20`,                       // storm guard — see 08 §14
      [nowMs],
    ).map(toDomain);
  }

  setNextFireAt(id: string, nextMs: number): void {
    this.db.run(
      `UPDATE reminders SET next_fire_at = ?, last_triggered_at = ?, updated_at = ? WHERE id = ?`,
      [nextMs, Date.now(), Date.now(), id],
    );
  }

  // update(), delete(), listActive(), listHistory(), pause(), resume(), markMissed()…
}
```

`MVP DECISION` — **Zero string interpolation into SQL, anywhere, with exactly one exception:** `PRAGMA user_version = ${v + 1}` in the migration runner, where `v` is a loop index over a hardcoded array and SQLite does not permit a bound parameter in a PRAGMA. This is called out in a code comment and asserted by a lint rule that forbids template literals in any other `exec`/`run`/`all` call.

`MVP DECISION` — `LIMIT 20` on `findDue` is the notification-storm guard from `08` §14. If a system clock change makes 200 reminders due at once, the user gets 20 and a warning, not 200 toasts.

## 7. Settings

`MVP DECISION` — Key/value TEXT, with a typed accessor layer. No JSON blob column, no ORM.

```ts
const SETTING_DEFAULTS = {
  onboarding_completed:    'false',
  tray_notice_shown:       'false',
  reminders_paused:        'false',
  theme:                   'system',
  tts_enabled:             'true',
  tts_voice_id:            '',
  tts_rate:                '1.0',
  tts_degraded:            'false',
  stt_provider:            'sherpa-onnx',
  notification_sound:      'true',
  snooze_minutes:          '10',
  tick_interval_ms:        '30000',
  close_action:            'tray',            // 'tray' | 'quit'
  ai_assist_enabled:       'false',
  ai_provider:             'openai',
  ai_model:                'gpt-4o-mini',
  ai_only_when_uncertain:  'true',
  ai_consent_accepted_at:  '',
  ai_last_used_at:         '',
  ai_key_ciphertext:       '',
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
```

`MVP DECISION` — `settings:get` over IPC **never returns `ai_key_ciphertext`.** The handler strips it and substitutes `hasApiKey: boolean`. Enforced by a test that asserts the IPC response shape (`16` §6).

## 8. Memory — schema now, feature later

The brief: *"Memory is not required for the core 7-day MVP, but the database schema should support it."*

`MVP DECISION` — Ship migration 002 creating the tables. Build **no UI, no extraction, no recall.** Empty tables cost nothing; a schema migration on a user's live database in v0.3 costs trust.

```sql
-- electron/database/migrations/002_memory.sql

CREATE TABLE memories (
  id           TEXT    PRIMARY KEY,
  subject      TEXT    NOT NULL,            -- 'grandfather'
  fact         TEXT    NOT NULL,            -- 'Has diabetes'
  category     TEXT    NOT NULL,            -- 'health' | 'family' | 'preference' | 'other'
  confidence   REAL    NOT NULL DEFAULT 1.0,
  source       TEXT    NOT NULL,            -- 'user_confirmed' | 'inferred'
  is_sensitive INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,

  CHECK (source IN ('user_confirmed', 'inferred')),
  CHECK (is_sensitive IN (0, 1)),
  CHECK (confidence BETWEEN 0.0 AND 1.0)
);

CREATE INDEX idx_memories_subject ON memories (subject, category);

CREATE TABLE conversations (
  id                 TEXT    PRIMARY KEY,
  user_text          TEXT    NOT NULL,
  assistant_response TEXT,
  intent             TEXT,
  reminder_id        TEXT REFERENCES reminders(id) ON DELETE SET NULL,
  created_at         INTEGER NOT NULL
);

CREATE INDEX idx_conversations_time ON conversations (created_at DESC);
```

### The memory design contract (for v0.3)

The brief's example:

> User: *"My grandfather has diabetes."*
> Yogi: *"Would you like me to remember that your grandfather has diabetes?"*

`MVP DECISION (forward-binding)` — Memory obeys the **same confirmation gate as reminders**:

1. Yogi never stores a fact it inferred without asking.
2. `source = 'user_confirmed'` is the only value written by the confirm flow. `'inferred'` is reserved and currently unreachable.
3. `is_sensitive = 1` for anything in `category IN ('health', 'family')`. Sensitive memories are:
   - never sent to any AI provider, even with AI Assist on;
   - redacted from `app_logs`;
   - listed in a **Manage Memories** screen with a per-row delete;
   - deleted by Reset Local Data along with everything else.
4. There is a *"What do you remember about me?"* screen before there is a *"remember this"* feature. Users must be able to read their profile before the app builds one.

`RISK (high, product)` — Health and family facts are the most sensitive data this app could hold, and they arrive through the least reliable channel (speech recognition of casual conversation). A mis-transcribed medical fact recalled confidently months later is a real harm. `MVP DECISION` — memory extraction stays out of the MVP entirely, and when it lands it must show the **verbatim source utterance** next to every stored fact.

## 9. Retention

`RISK (medium)` — `app_logs` and `reminder_history` grow forever. A daily reminder produces 365 history rows a year; a debug-level logger produces far more. Unbounded growth in an app with a synchronous DB driver is a slow-motion performance bug.

`MVP DECISION` — On every app start, in a background microtask after the window paints:

```sql
DELETE FROM app_logs         WHERE created_at < ?;   -- now - 14 days
DELETE FROM reminder_history WHERE triggered_at < ?; -- now - 365 days
```

Then, if either deleted rows, run `PRAGMA incremental_vacuum` (with `auto_vacuum = INCREMENTAL` set at creation).

`MVP DECISION` — Log level defaults to `info` in production, `debug` in development. `debug` rows are never written in a packaged build.

## 10. Reset Local Data

The brief's safety requirement, implemented literally.

```ts
// electron/services/reset-service.ts
export async function resetLocalData(): Promise<void> {
  const userData = app.getPath('userData');           // resolved by Electron, not by us

  // Paranoia: refuse to delete anything that is not the LifeOS userData directory.
  const resolved = path.resolve(userData);
  if (!resolved.endsWith(`${path.sep}LifeOS`) && !isPortableDataDir(resolved)) {
    throw new UnsafeResetPathError(resolved);
  }
  if (resolved.split(path.sep).length < 4) throw new UnsafeResetPathError(resolved);

  db.close();                                         // release the WAL
  await fs.rm(resolved, { recursive: true, force: true });
  app.relaunch();
  app.exit(0);
}
```

Invariants:

- `MVP DECISION` — The path comes from **`app.getPath('userData')`**, never from a setting, never from IPC, never from a renderer-supplied string. The IPC handler takes **no arguments at all**: `ipcMain.handle('settings:resetLocalData', () => resetLocalData())`.
- `MVP DECISION` — Two guards before `rm`: the path must end in `LifeOS` (or be the portable data dir), and it must be at least four segments deep. `C:\` cannot be reached from here.
- `MVP DECISION` — The user must **type `RESET`** (`12` §8.1). The modal enumerates what will be destroyed with live counts, and states plainly what will not be touched.
- `MVP DECISION` — This is the **only** filesystem-delete operation in the entire codebase. An ESLint rule permits `fs.rm` in this file and nowhere else.
- `RISK (low)` — `fs.rm` on Windows can fail with `EBUSY` if the WAL is held. Close the driver first; retry once after 200 ms; on a second failure, tell the user to quit and reopen rather than leaving a half-deleted directory.

## 11. Backup and portability

`MVP DECISION` — There is no export feature in the MVP. There is something better and free: **the database is a single file, in a documented location, in the world's most portable format.**

The README says so:

> Your data is one SQLite file at `%APPDATA%\LifeOS\lifeos.db`. Copy it to back it up. Open it with any SQLite browser to read it. Delete it to start over. LifeOS has no lock-in because it has no server.

`FUTURE OPTION` — `Export to JSON` / `Import from JSON` in v0.2, which is also the prerequisite for any future opt-in sync.

## 12. SPIKE-1 — acceptance criteria (Day 1, 60 minutes)

```text
□ In the Electron 43 main process, `require('node:sqlite')` resolves without a flag.
□ `new DatabaseSync(path)` opens a file under app.getPath('userData').
□ PRAGMA journal_mode = WAL returns 'wal'.
□ PRAGMA user_version reads and writes.
□ CREATE TABLE with CHECK constraints succeeds.
□ Parameterized INSERT with a title containing  '); DROP TABLE reminders;--
    stores that literal string and the table still exists.     ← proves parameterization
□ Restart the app; the row is still there.
□ A CHECK violation (empty title) throws, and the error is catchable.
□ Package with electron-builder; install; the DB lands in %APPDATA%\LifeOS\
    and the same test passes in the installed app.             ← the real test
```

**On failure at any step:** switch the driver to `better-sqlite3`, add `postinstall: electron-builder install-app-deps` and the `asarUnpack` glob, and re-run. Budget 90 additional minutes. Only the file `electron/database/drivers/*.ts` changes; the repository, migrations and schema are untouched — which is the entire point of §2.
