/**
 * Gmail repository (docs §4). Every query parameterized — zero string interpolation, mirroring
 * reminder-repository.ts. Phase 1 exercises account + sync-state CRUD and the cache-delete path;
 * the message/thread/label/attachment methods back the Phase-2 sync engine (so it needs no new
 * migration and no new repo).
 */
import type { SqliteDriver } from './driver';
import type {
  GmailAccount,
  GmailSyncState,
  GmailSyncStatus,
  GmailMessage,
  GmailParticipant,
  GmailAttachmentMeta,
  GmailLabel,
  EmailAiContext,
  WebResearch,
} from '../../core/gmail/types';

interface AccountRow {
  id: string;
  email_address: string;
  scope: string;
  connected_at: number;
  updated_at: number;
}

interface SyncStateRow {
  account_id: string;
  history_id: string | null;
  last_sync_at: number | null;
  last_full_sync_at: number | null;
  watch_expiry: number | null;
  status: string;
  last_error: string | null;
}

interface MessageRow {
  id: string;
  thread_id: string;
  account_id: string;
  history_id: string | null;
  internal_date: number;
  from_name: string | null;
  from_address: string | null;
  subject: string;
  snippet: string;
  is_unread: number;
  is_starred: number;
  size_estimate: number;
  label_ids: string;
}

function safeJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function toMessage(r: MessageRow): GmailMessage {
  return {
    id: r.id,
    threadId: r.thread_id,
    accountId: r.account_id,
    historyId: r.history_id,
    internalDate: r.internal_date,
    fromName: r.from_name,
    fromAddress: r.from_address,
    subject: r.subject,
    snippet: r.snippet,
    isUnread: r.is_unread === 1,
    isStarred: r.is_starred === 1,
    sizeEstimate: r.size_estimate,
    labelIds: r.label_ids ? r.label_ids.split(',') : [],
  };
}

function toAccount(r: AccountRow): GmailAccount {
  return {
    id: r.id,
    emailAddress: r.email_address,
    scope: r.scope,
    connectedAt: r.connected_at,
    updatedAt: r.updated_at,
  };
}

function toSyncState(r: SyncStateRow): GmailSyncState {
  return {
    accountId: r.account_id,
    historyId: r.history_id,
    lastSyncAt: r.last_sync_at,
    lastFullSyncAt: r.last_full_sync_at,
    watchExpiry: r.watch_expiry,
    status: r.status as GmailSyncStatus,
    lastError: r.last_error,
  };
}

export class GmailRepository {
  constructor(private readonly db: SqliteDriver) {}

  // ── account ───────────────────────────────────────────────────────────────
  /** Insert or replace the connected account, and ensure a sync-state row exists. LifeOS is
   *  single-account in Phase 1, but the schema supports many, so this is keyed by id. */
  saveAccount(account: GmailAccount): void {
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO gmail_accounts (id, email_address, scope, connected_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           email_address = excluded.email_address,
           scope = excluded.scope,
           updated_at = excluded.updated_at`,
        [account.id, account.emailAddress, account.scope, account.connectedAt, account.updatedAt],
      );
      this.db.run(
        `INSERT OR IGNORE INTO gmail_sync_state (account_id, status) VALUES (?, 'idle')`,
        [account.id],
      );
    });
  }

  /** The single connected account (or null). Most-recently connected wins if several exist. */
  getAccount(): GmailAccount | null {
    const row = this.db.get<AccountRow>(
      'SELECT * FROM gmail_accounts ORDER BY connected_at DESC LIMIT 1',
    );
    return row ? toAccount(row) : null;
  }

  /** Remove one account and everything under it (messages/threads/labels/attachments/sync cascade). */
  deleteAccount(id: string): void {
    this.db.run('DELETE FROM gmail_accounts WHERE id = ?', [id]);
  }

  /** Full disconnect wipe — every account and all Gmail data. */
  clearAll(): void {
    this.db.run('DELETE FROM gmail_accounts');
  }

  // ── sync state ────────────────────────────────────────────────────────────
  getSyncState(accountId: string): GmailSyncState | null {
    const row = this.db.get<SyncStateRow>(
      'SELECT * FROM gmail_sync_state WHERE account_id = ?',
      [accountId],
    );
    return row ? toSyncState(row) : null;
  }

  setSyncStatus(accountId: string, status: GmailSyncStatus, lastError: string | null = null): void {
    this.db.run(
      'UPDATE gmail_sync_state SET status = ?, last_error = ? WHERE account_id = ?',
      [status, lastError, accountId],
    );
  }

  setHistoryId(accountId: string, historyId: string, at: number): void {
    this.db.run(
      'UPDATE gmail_sync_state SET history_id = ?, last_sync_at = ? WHERE account_id = ?',
      [historyId, at, accountId],
    );
  }

  setFullSyncedAt(accountId: string, at: number): void {
    this.db.run('UPDATE gmail_sync_state SET last_full_sync_at = ? WHERE account_id = ?', [at, accountId]);
  }

  // ── message writes (Phase 2 sync engine) ───────────────────────────────────
  messageExists(id: string): boolean {
    return !!this.db.get<{ x: number }>('SELECT 1 AS x FROM gmail_messages WHERE id = ?', [id]);
  }

  getMessage(id: string): GmailMessage | null {
    const row = this.db.get<MessageRow>('SELECT * FROM gmail_messages WHERE id = ?', [id]);
    return row ? toMessage(row) : null;
  }

  /** Newest-first, for context/views. */
  listRecent(accountId: string, limit = 50): GmailMessage[] {
    return this.db
      .all<MessageRow>('SELECT * FROM gmail_messages WHERE account_id = ? ORDER BY internal_date DESC LIMIT ?', [
        accountId,
        limit,
      ])
      .map(toMessage);
  }

  /** Upsert a message with its participants, label join, attachments, and thread rollup — all in
   *  one transaction. is_unread/is_starred are derived from the label set (single source of truth). */
  upsertMessage(
    accountId: string,
    m: GmailMessage,
    participants: GmailParticipant[],
    attachments: GmailAttachmentMeta[],
  ): void {
    const isUnread = m.labelIds.includes('UNREAD') ? 1 : 0;
    const isStarred = m.labelIds.includes('STARRED') ? 1 : 0;
    const now = Date.now();
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO gmail_messages
           (id, account_id, thread_id, history_id, internal_date, from_name, from_address, subject,
            snippet, is_unread, is_starred, size_estimate, label_ids, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           thread_id = excluded.thread_id, history_id = excluded.history_id,
           internal_date = excluded.internal_date, from_name = excluded.from_name,
           from_address = excluded.from_address, subject = excluded.subject, snippet = excluded.snippet,
           is_unread = excluded.is_unread, is_starred = excluded.is_starred,
           size_estimate = excluded.size_estimate, label_ids = excluded.label_ids`,
        [
          m.id, accountId, m.threadId, m.historyId, m.internalDate, m.fromName, m.fromAddress, m.subject,
          m.snippet, isUnread, isStarred, m.sizeEstimate, m.labelIds.join(','), now,
        ],
      );

      this.db.run('DELETE FROM gmail_participants WHERE message_id = ?', [m.id]);
      for (const p of participants) {
        this.db.run('INSERT INTO gmail_participants (message_id, role, name, address) VALUES (?,?,?,?)', [
          m.id, p.role, p.name, p.address,
        ]);
      }

      this.db.run('DELETE FROM gmail_message_labels WHERE message_id = ?', [m.id]);
      for (const lid of m.labelIds) {
        this.db.run('INSERT OR IGNORE INTO gmail_message_labels (message_id, label_id) VALUES (?,?)', [m.id, lid]);
      }

      this.db.run('DELETE FROM gmail_attachments WHERE message_id = ?', [m.id]);
      for (const a of attachments) {
        this.db.run(
          `INSERT INTO gmail_attachments (message_id, attachment_id, filename, mime_type, size_bytes, local_path)
           VALUES (?,?,?,?,?,?)`,
          [m.id, a.attachmentId, a.filename, a.mimeType, a.sizeBytes, a.localPath],
        );
      }

      // Thread rollup: message_count recomputed from the messages actually stored.
      this.db.run(
        `INSERT INTO gmail_threads (id, account_id, snippet, last_message_at, message_count)
           VALUES (?, ?, ?, ?, (SELECT COUNT(*) FROM gmail_messages WHERE thread_id = ?))
         ON CONFLICT(id) DO UPDATE SET
           snippet = excluded.snippet,
           last_message_at = MAX(COALESCE(gmail_threads.last_message_at, 0), excluded.last_message_at),
           message_count = (SELECT COUNT(*) FROM gmail_messages WHERE thread_id = gmail_threads.id)`,
        [m.threadId, accountId, m.snippet, m.internalDate, m.threadId],
      );
    });
  }

  /** Apply a label delta to a stored message (read/unread, star, folder). No-op if not stored. */
  applyMessageLabels(id: string, labelIds: string[]): void {
    const isUnread = labelIds.includes('UNREAD') ? 1 : 0;
    const isStarred = labelIds.includes('STARRED') ? 1 : 0;
    this.db.transaction(() => {
      const changed = this.db.run(
        'UPDATE gmail_messages SET is_unread = ?, is_starred = ?, label_ids = ? WHERE id = ?',
        [isUnread, isStarred, labelIds.join(','), id],
      ).changes;
      if (!changed) return; // not stored (e.g. context off) → nothing to update
      this.db.run('DELETE FROM gmail_message_labels WHERE message_id = ?', [id]);
      for (const lid of labelIds) {
        this.db.run('INSERT OR IGNORE INTO gmail_message_labels (message_id, label_id) VALUES (?,?)', [id, lid]);
      }
    });
  }

  deleteMessage(id: string): void {
    this.db.run('DELETE FROM gmail_messages WHERE id = ?', [id]); // cascades participants/labels/attachments
  }

  upsertLabels(accountId: string, labels: GmailLabel[]): void {
    this.db.transaction(() => {
      for (const l of labels) {
        this.db.run(
          `INSERT INTO gmail_labels (account_id, id, name, type) VALUES (?,?,?,?)
           ON CONFLICT(account_id, id) DO UPDATE SET name = excluded.name, type = excluded.type`,
          [accountId, l.id, l.name, l.type],
        );
      }
    });
  }

  // ── AI context (Phase 3/4) ─────────────────────────────────────────────────
  saveAiContext(messageId: string, ctx: EmailAiContext, model: string | null): void {
    this.db.run(
      `INSERT INTO email_ai_context
         (message_id, summary, sender_intent, action_items, key_dates, priority,
          research_worthwhile, research_query, model, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(message_id) DO UPDATE SET
         summary = excluded.summary, sender_intent = excluded.sender_intent,
         action_items = excluded.action_items, key_dates = excluded.key_dates,
         priority = excluded.priority, research_worthwhile = excluded.research_worthwhile,
         research_query = excluded.research_query, model = excluded.model`,
      [
        messageId, ctx.summary, ctx.senderIntent,
        JSON.stringify(ctx.actionItems), JSON.stringify(ctx.keyDates),
        ctx.priority, ctx.researchWorthwhile ? 1 : 0, ctx.researchQuery, model, Date.now(),
      ],
    );
  }

  getAiContext(messageId: string): EmailAiContext | null {
    const row = this.db.get<{
      summary: string;
      sender_intent: string;
      action_items: string;
      key_dates: string;
      priority: string;
      research_worthwhile: number;
      research_query: string;
    }>(
      `SELECT summary, sender_intent, action_items, key_dates, priority, research_worthwhile, research_query
         FROM email_ai_context WHERE message_id = ?`,
      [messageId],
    );
    if (!row) return null;
    return {
      summary: row.summary,
      senderIntent: row.sender_intent,
      actionItems: safeJsonArray(row.action_items),
      keyDates: safeJsonArray(row.key_dates),
      priority: (row.priority as EmailAiContext['priority']) ?? 'normal',
      researchWorthwhile: row.research_worthwhile === 1,
      researchQuery: row.research_query ?? '',
    };
  }

  // ── web research (Phase 4) — one cached result per email (dedup + no re-pay on re-sync) ──────
  saveResearch(messageId: string, r: WebResearch): void {
    this.db.run(
      `INSERT INTO web_research (message_id, query, answer, citations, created_at)
         VALUES (?,?,?,?,?)
       ON CONFLICT(message_id) DO UPDATE SET
         query = excluded.query, answer = excluded.answer, citations = excluded.citations`,
      [messageId, r.query, r.answer, JSON.stringify(r.citations), Date.now()],
    );
  }

  getResearch(messageId: string): WebResearch | null {
    const row = this.db.get<{ query: string; answer: string; citations: string }>(
      'SELECT query, answer, citations FROM web_research WHERE message_id = ?',
      [messageId],
    );
    if (!row) return null;
    let citations: WebResearch['citations'] = [];
    try {
      const v = JSON.parse(row.citations);
      if (Array.isArray(v)) citations = v.filter((c) => c && typeof c.title === 'string' && typeof c.url === 'string');
    } catch {
      /* ignore */
    }
    return { query: row.query, answer: row.answer, citations };
  }

  hasResearch(messageId: string): boolean {
    return !!this.db.get<{ x: number }>('SELECT 1 AS x FROM web_research WHERE message_id = ?', [messageId]);
  }

  /** Trim to the newest `max` messages (by date). max <= 0 means unlimited. Returns rows removed. */
  pruneToMax(accountId: string, max: number): number {
    if (max <= 0) return 0;
    return this.db.run(
      `DELETE FROM gmail_messages
        WHERE account_id = ?
          AND id NOT IN (
            SELECT id FROM gmail_messages WHERE account_id = ? ORDER BY internal_date DESC LIMIT ?
          )`,
      [accountId, accountId, max],
    ).changes;
  }

  // ── local cache (Delete Local Email Cache) ─────────────────────────────────
  /** Wipe synced email rows but KEEP the account connected; reset the sync checkpoint so the next
   *  sync reseeds. Messages cascade to participants/message_labels/attachments; threads + labels
   *  are per-account and removed explicitly. */
  deleteEmailCache(accountId: string): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM gmail_messages WHERE account_id = ?', [accountId]);
      this.db.run('DELETE FROM gmail_threads WHERE account_id = ?', [accountId]);
      this.db.run('DELETE FROM gmail_labels WHERE account_id = ?', [accountId]);
      this.db.run(
        `UPDATE gmail_sync_state
            SET history_id = NULL, last_sync_at = NULL, last_full_sync_at = NULL
          WHERE account_id = ?`,
        [accountId],
      );
    });
  }

  // ── stats (Settings: Storage Used / counts) ────────────────────────────────
  messageCount(accountId: string): number {
    const row = this.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM gmail_messages WHERE account_id = ?',
      [accountId],
    );
    return row?.n ?? 0;
  }

  /** Rough stored size in bytes (sum of message size estimates) — powers the "Storage Used" line. */
  storageBytes(accountId: string): number {
    const row = this.db.get<{ n: number | null }>(
      'SELECT SUM(size_estimate) AS n FROM gmail_messages WHERE account_id = ?',
      [accountId],
    );
    return row?.n ?? 0;
  }
}
