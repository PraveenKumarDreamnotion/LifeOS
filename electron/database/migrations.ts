/**
 * Schema migrations as inline SQL constants (10 §5, §8).
 *
 * Kept as TypeScript string constants rather than .sql files so they are bundled into
 * the main-process build with zero path-resolution risk when packaged. Forward-only:
 * no DROP TABLE, no DROP COLUMN, ever.
 */

export const M001_INITIAL = `
CREATE TABLE reminders (
  id                TEXT    PRIMARY KEY,
  title             TEXT    NOT NULL,
  description       TEXT,
  scheduled_at      INTEGER NOT NULL,              -- UTC epoch ms. Original intent.
  next_fire_at      INTEGER NOT NULL,              -- UTC epoch ms. THE SCHEDULER READS THIS.
  timezone          TEXT    NOT NULL,              -- IANA
  recurrence_rule   TEXT,                          -- RRULE string, or NULL
  action_type       TEXT    NOT NULL DEFAULT 'notify',
  status            TEXT    NOT NULL DEFAULT 'pending',
  source            TEXT    NOT NULL DEFAULT 'local',
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
  id            TEXT    PRIMARY KEY,
  reminder_id   TEXT    NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  title_at_time TEXT    NOT NULL,
  triggered_at  INTEGER NOT NULL,
  action_taken  TEXT    NOT NULL DEFAULT 'triggered',
  dismissed_at  INTEGER,
  completed_at  INTEGER,
  snoozed_to    INTEGER,

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
  context    TEXT,
  created_at INTEGER NOT NULL,

  CHECK (level IN ('debug', 'info', 'warn', 'error'))
);

CREATE INDEX idx_logs_time ON app_logs (created_at DESC);
`;

export const M002_MEMORY = `
CREATE TABLE memories (
  id           TEXT    PRIMARY KEY,
  subject      TEXT    NOT NULL,
  fact         TEXT    NOT NULL,
  category     TEXT    NOT NULL,
  confidence   REAL    NOT NULL DEFAULT 1.0,
  source       TEXT    NOT NULL,
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
`;

export const M003_CHAT_SESSIONS = `
-- Persistent, resumable chat threads. A session groups turns; reminders link back to their session.
CREATE TABLE chat_sessions (
  id         TEXT    PRIMARY KEY,
  title      TEXT    NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL                     -- last activity; the chat list orders by this
);

CREATE INDEX idx_chat_sessions_updated ON chat_sessions (updated_at DESC);

-- The FAITHFUL render source (NOT the best-effort conversations telemetry): one row per turn,
-- assistant_text is exactly what was SHOWN, and a proposal turn carries its settled outcome so a
-- reopened chat renders a real settled card, never a lie. id == the engine turnId so the
-- confirm/cancel/expire paths can settle the row by id.
CREATE TABLE chat_turns (
  id               TEXT    PRIMARY KEY,           -- == engine turnId
  session_id       TEXT    NOT NULL,
  user_text        TEXT    NOT NULL,
  assistant_text   TEXT    NOT NULL,              -- what the user actually saw
  intent           TEXT,
  proposal_summary TEXT,                          -- resolved summary, if this turn showed a card
  proposal_status  TEXT,                          -- NULL (no card) | pending | executed | cancelled
  reminder_id      TEXT,                          -- created reminder, if executed
  created_at       INTEGER NOT NULL,

  CHECK (proposal_status IS NULL OR proposal_status IN ('pending', 'executed', 'cancelled'))
);

CREATE INDEX idx_chat_turns_session ON chat_turns (session_id, created_at);

-- Link a reminder to the chat that created it (nullable, app-managed — reminders OUTLIVE chats,
-- so deleting a chat must NEVER cascade to reminders). Stamped as provenance at persist time.
ALTER TABLE reminders ADD COLUMN session_id TEXT;
`;

export const M004_TURN_KIND = `
-- Conversational reminder delivery (DELIVERY): a chat_turns row is either a normal 'chat' exchange
-- or a 'reminder' delivery (a fired reminder dropped INTO its chat). A reminder turn has no user
-- text and renders as an assistant-only bubble; both the renderer AND the engine's LLM-context
-- projection special-case it (an empty user message would malform the request).
ALTER TABLE chat_turns ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
`;

export const M005_REMINDER_EXECUTION = `
-- Structured execution intent (reminder-execution): a fired reminder can now DO something (run an
-- AI research task and deliver the answer) instead of only speaking its title. The spec is a
-- validated JSON blob; NULL means the classic notify/sing behaviour — every existing row and every
-- plain reminder is untouched. Additive, forward-only (no CHECK so future spec versions don't need
-- a migration; the app validates the JSON on read and fails safe to NULL).
ALTER TABLE reminders ADD COLUMN execution_json TEXT;
`;

export const M006_GMAIL = `
-- Gmail integration (docs/lifeos-planning/gmail-integration.md §4). Additive, forward-only.
-- Only the tables Phases 1–2 exercise are created here; email_ai_context / email_embeddings /
-- web_research are DEFERRED to their own later migrations (their shape depends on the local-vs-
-- OpenAI embeddings decision — migrations are additive, so deferring costs nothing).
-- Phase 1 reads/writes only gmail_accounts + gmail_sync_state; the rest back the Phase-2 sync
-- engine so it needs no further migration.

CREATE TABLE gmail_accounts (
  id            TEXT    PRIMARY KEY,
  email_address TEXT    NOT NULL,
  scope         TEXT    NOT NULL DEFAULT '',
  connected_at  INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- One incremental-sync cursor per account. history_id is the checkpoint the Phase-2 engine
-- catches up from; a future Pub/Sub pull feed would advance the same field.
CREATE TABLE gmail_sync_state (
  account_id        TEXT    PRIMARY KEY REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  history_id        TEXT,
  last_sync_at      INTEGER,
  last_full_sync_at INTEGER,
  watch_expiry      INTEGER,                         -- push-mode watch expiry (future); NULL under polling
  status            TEXT    NOT NULL DEFAULT 'idle',
  last_error        TEXT,

  CHECK (status IN ('idle', 'syncing', 'error', 'reconnect_needed'))
);

CREATE TABLE gmail_threads (
  id              TEXT    PRIMARY KEY,               -- Gmail thread id
  account_id      TEXT    NOT NULL REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  snippet         TEXT    NOT NULL DEFAULT '',
  last_message_at INTEGER,
  message_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_gmail_threads_account ON gmail_threads (account_id, last_message_at DESC);

CREATE TABLE gmail_messages (
  id            TEXT    PRIMARY KEY,                 -- Gmail message id (globally unique → dedup)
  account_id    TEXT    NOT NULL REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  thread_id     TEXT    NOT NULL,
  history_id    TEXT,
  internal_date INTEGER NOT NULL,                    -- UTC epoch ms
  from_name     TEXT,
  from_address  TEXT,
  subject       TEXT    NOT NULL DEFAULT '',
  snippet       TEXT    NOT NULL DEFAULT '',
  is_unread     INTEGER NOT NULL DEFAULT 0,
  is_starred    INTEGER NOT NULL DEFAULT 0,
  size_estimate INTEGER NOT NULL DEFAULT 0,
  label_ids     TEXT    NOT NULL DEFAULT '',         -- denormalized CSV for fast filtering
  body_text     TEXT,                                -- populated on demand
  body_html     TEXT,
  created_at    INTEGER NOT NULL,

  CHECK (is_unread IN (0, 1)),
  CHECK (is_starred IN (0, 1))
);

CREATE INDEX idx_gmail_messages_date   ON gmail_messages (account_id, internal_date DESC);
CREATE INDEX idx_gmail_messages_thread ON gmail_messages (thread_id);
CREATE INDEX idx_gmail_messages_unread ON gmail_messages (account_id, is_unread) WHERE is_unread = 1;

CREATE TABLE gmail_participants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT    NOT NULL REFERENCES gmail_messages(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL,
  name       TEXT,
  address    TEXT    NOT NULL,

  CHECK (role IN ('from', 'to', 'cc', 'bcc'))
);

CREATE INDEX idx_gmail_participants_msg  ON gmail_participants (message_id);
CREATE INDEX idx_gmail_participants_addr ON gmail_participants (address);

-- Label ids like 'INBOX' repeat across accounts, so the identity is (account_id, id).
CREATE TABLE gmail_labels (
  account_id TEXT NOT NULL REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'user',

  PRIMARY KEY (account_id, id)
);

CREATE TABLE gmail_message_labels (
  message_id TEXT NOT NULL REFERENCES gmail_messages(id) ON DELETE CASCADE,
  label_id   TEXT NOT NULL,

  PRIMARY KEY (message_id, label_id)
);

CREATE TABLE gmail_attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id    TEXT    NOT NULL REFERENCES gmail_messages(id) ON DELETE CASCADE,
  attachment_id TEXT    NOT NULL,
  filename      TEXT    NOT NULL DEFAULT '',
  mime_type     TEXT    NOT NULL DEFAULT '',
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  local_path    TEXT,                                -- set only if downloaded (opt-in)
  text_content  TEXT                                 -- future OCR/extraction (OCR-ready)
);

CREATE INDEX idx_gmail_attachments_msg ON gmail_attachments (message_id);
`;

export const M007_EMAIL_CONTEXT = `
-- Gmail Phase 3: AI context per message + link a chat session to the email it was created for.
-- Additive, forward-only. email_embeddings / web_research remain deferred (semantic search is a
-- later phase; this phase is conversational email delivery + summaries).

CREATE TABLE email_ai_context (
  message_id    TEXT    PRIMARY KEY REFERENCES gmail_messages(id) ON DELETE CASCADE,
  summary       TEXT    NOT NULL DEFAULT '',
  sender_intent TEXT    NOT NULL DEFAULT '',
  action_items  TEXT    NOT NULL DEFAULT '[]',      -- JSON array of strings
  key_dates     TEXT    NOT NULL DEFAULT '[]',      -- JSON array of strings
  priority      TEXT    NOT NULL DEFAULT 'normal',
  model         TEXT,
  created_at    INTEGER NOT NULL,

  CHECK (priority IN ('low', 'normal', 'high'))
);

-- A chat auto-created for a delivered email links back to it (nullable; NULL = a normal chat).
-- Also lets voice-continuity fallbacks EXCLUDE email chats so a new email never hijacks the
-- launcher's "continue the most-recent conversation".
ALTER TABLE chat_sessions ADD COLUMN email_message_id TEXT;
`;

export const M008_WEB_RESEARCH = `
-- Gmail Phase 4: opt-in web research on an email. The research DECISION (worthwhile + query) rides
-- on the cached summary (one LLM call); the research RESULT is cached per message so a re-sync
-- never re-pays for the same search. Additive, forward-only.
ALTER TABLE email_ai_context ADD COLUMN research_worthwhile INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_ai_context ADD COLUMN research_query TEXT NOT NULL DEFAULT '';

CREATE TABLE web_research (
  message_id TEXT    PRIMARY KEY REFERENCES gmail_messages(id) ON DELETE CASCADE,
  query      TEXT    NOT NULL,
  answer     TEXT    NOT NULL,
  citations  TEXT    NOT NULL DEFAULT '[]',       -- JSON array of { title, url }
  created_at INTEGER NOT NULL
);
`;

/** Ordered. Index i migrates the DB from user_version i to i+1. */
export const MIGRATIONS: readonly string[] = [
  M001_INITIAL,
  M002_MEMORY,
  M003_CHAT_SESSIONS,
  M004_TURN_KIND,
  M005_REMINDER_EXECUTION,
  M006_GMAIL,
  M007_EMAIL_CONTEXT,
  M008_WEB_RESEARCH,
];
