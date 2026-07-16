/**
 * GmailSyncEngine (Phase 2) — the checkpoint-based incremental sync core, provider-agnostic
 * (drives any MailProvider). Design (docs §2.4–§2.5):
 *
 *  - No checkpoint yet  → INITIAL sync: list ids (bounded) + fetch metadata + seed the historyId.
 *  - Have a checkpoint  → INCREMENTAL sync via history(): apply add/delete/label deltas, then
 *    advance the checkpoint ONLY after the batch persists (crash-safe: a mid-batch crash re-runs
 *    from the same checkpoint; adds dedup via messageExists, deletes/labels are idempotent).
 *  - Checkpoint too old → HistoryExpiredError → reseed via a fresh initial sync.
 *
 * Gating: `storeContext=false` means "track the cursor + notify, store nothing" (so the toggle is
 * real). New-mail-for-notification = an INBOX+UNREAD *added* message not already stored — computed
 * BEFORE upsert. Initial sync never notifies (no whole-inbox storm).
 *
 * Token acquisition is behind the single getAccessToken seam (gmail-auth.getValidAccessToken), so
 * an auth failure surfaces in one place: no token → status reconnect_needed, sync skipped.
 */
import type { MailProvider } from '../../core/gmail/mail-provider';
import { HistoryExpiredError } from '../../core/gmail/mail-provider';
import type { GmailRepository } from '../database/gmail-repository';

const CONCURRENCY = 5;
/** Even "unlimited" caps the INITIAL fetch (unlimited = don't prune, not fetch-the-whole-mailbox). */
const INITIAL_HARD_CAP = 500;

export interface SyncConfig {
  storeContext: boolean;
  downloadAttachments: boolean;
  /** 0 = unlimited (no pruning). */
  maxStored: number;
  notificationsEnabled: boolean;
  /** Optional override of the initial-fetch cap (tests). */
  initialLimit?: number;
}

export interface NewMessage {
  id: string;
  fromName: string | null;
  fromAddress: string | null;
  subject: string;
  snippet: string;
}

export interface SyncResult {
  ok: boolean;
  mode: 'initial' | 'incremental' | 'skipped';
  reason?: string;
  fetched: number;
  deleted: number;
  newCount: number;
}

export interface SyncEngineDeps {
  provider: MailProvider;
  repo: GmailRepository;
  getAccessToken: () => Promise<string | null>;
  getConfig: () => SyncConfig;
  onNewMessages?: (msgs: NewMessage[]) => void;
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export class GmailSyncEngine {
  private syncing = false;
  private readonly now: () => number;

  constructor(private readonly deps: SyncEngineDeps) {
    this.now = deps.now ?? Date.now;
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.deps.log?.(level, message);
  }

  /**
   * Sync one account. Serialized: a call while a sync is in flight returns `skipped`.
   *
   * `deliverNew` (default true): when false, an incremental sync still stores mail + advances the
   * checkpoint but does NOT deliver it (no chat/notify/TTS) — the startup CATCH-UP mode, so relaunching
   * after a backlog doesn't burst-create chats or speak (mirrors the reminder "missed-while-closed"
   * policy). Mail is still stored + visible; only the delivery burst is suppressed.
   */
  async sync(accountId: string, opts: { deliverNew?: boolean } = {}): Promise<SyncResult> {
    const deliverNew = opts.deliverNew ?? true;
    if (this.syncing) return { ok: true, mode: 'skipped', fetched: 0, deleted: 0, newCount: 0 };
    this.syncing = true;
    try {
      const token = await this.deps.getAccessToken();
      if (!token) {
        this.deps.repo.setSyncStatus(accountId, 'reconnect_needed', 'no_token');
        return { ok: false, mode: 'skipped', reason: 'not_connected', fetched: 0, deleted: 0, newCount: 0 };
      }
      this.deps.repo.setSyncStatus(accountId, 'syncing');

      // Labels are best-effort context; a failure must not abort the message sync.
      try {
        const labels = await this.deps.provider.listLabels(token);
        this.deps.repo.upsertLabels(accountId, labels);
      } catch (e) {
        this.log('warn', `gmail: label sync failed (${(e as Error).message})`);
      }

      const config = this.deps.getConfig();
      const checkpoint = this.deps.repo.getSyncState(accountId)?.historyId;

      let result: SyncResult;
      if (!checkpoint) {
        result = await this.initialSync(accountId, token, config);
      } else {
        try {
          result = await this.incrementalSync(accountId, token, checkpoint, config, deliverNew);
        } catch (e) {
          if (e instanceof HistoryExpiredError) {
            this.log('warn', 'gmail: history checkpoint expired — reseeding');
            result = await this.initialSync(accountId, token, config);
          } else {
            throw e;
          }
        }
      }

      this.deps.repo.setSyncStatus(accountId, 'idle');
      return result;
    } catch (e) {
      this.deps.repo.setSyncStatus(accountId, 'error', (e as Error).message);
      this.log('error', `gmail: sync failed (${(e as Error).message})`);
      return { ok: false, mode: 'skipped', reason: (e as Error).message, fetched: 0, deleted: 0, newCount: 0 };
    } finally {
      this.syncing = false;
    }
  }

  private async initialSync(accountId: string, token: string, config: SyncConfig): Promise<SyncResult> {
    const { historyId } = await this.deps.provider.getProfile(token);

    const cap = config.initialLimit ?? (config.maxStored > 0 ? config.maxStored : INITIAL_HARD_CAP);
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.deps.provider.listMessageIds(token, pageToken);
      ids.push(...page.ids);
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken && ids.length < cap);
    const toFetch = ids.slice(0, cap);

    let fetched = 0;
    if (config.storeContext) {
      await mapLimit(toFetch, CONCURRENCY, async (id) => {
        try {
          const fm = await this.deps.provider.getMessage(token, id, { full: config.downloadAttachments });
          this.deps.repo.upsertMessage(accountId, { ...fm.message, accountId }, fm.participants, fm.attachments);
          fetched++;
        } catch (e) {
          // One un-fetchable message must not abort the whole seed (see incrementalSync note).
          this.log('warn', `gmail: skipped message ${id} during initial sync (${(e as Error).message})`);
        }
      });
      this.deps.repo.pruneToMax(accountId, config.maxStored);
    }

    if (historyId) this.deps.repo.setHistoryId(accountId, historyId, this.now());
    this.deps.repo.setFullSyncedAt(accountId, this.now());
    this.log('info', `gmail: initial sync stored ${fetched} messages`);
    // No notifications on initial sync (avoid a whole-inbox storm).
    return { ok: true, mode: 'initial', fetched, deleted: 0, newCount: 0 };
  }

  private async incrementalSync(
    accountId: string,
    token: string,
    checkpoint: string,
    config: SyncConfig,
    deliverNew: boolean,
  ): Promise<SyncResult> {
    const delta = await this.deps.provider.history(token, checkpoint);

    const newMsgs: NewMessage[] = [];
    let fetched = 0;

    await mapLimit(delta.messagesAdded, CONCURRENCY, async (id) => {
      try {
        const existed = config.storeContext ? this.deps.repo.messageExists(id) : false;
        const fm = await this.deps.provider.getMessage(token, id, { full: config.downloadAttachments });
        fetched++;
        const m = { ...fm.message, accountId };
        if (config.storeContext) this.deps.repo.upsertMessage(accountId, m, fm.participants, fm.attachments);

        // New-for-notification: a genuinely fresh INBOX+UNREAD arrival, not one we already had.
        const isInbox = m.labelIds.includes('INBOX');
        if (isInbox && m.isUnread && !existed) {
          newMsgs.push({ id: m.id, fromName: m.fromName, fromAddress: m.fromAddress, subject: m.subject, snippet: m.snippet });
        }
      } catch (e) {
        // A message referenced by history.list can vanish before we messages.get it — Gmail returns
        // 404 and the API docs REQUIRE tolerating this. Transient errors are already retried by the
        // provider's backoff, so a final failure here means skip this one id and let the batch (and
        // the checkpoint) advance — never wedge the cursor forever on one bad message.
        this.log('warn', `gmail: skipped added message ${id} (${(e as Error).message})`);
      }
    });

    for (const id of delta.messagesDeleted) this.deps.repo.deleteMessage(id);
    for (const change of delta.labelsChanged) this.deps.repo.applyMessageLabels(change.messageId, change.labelIds);

    // Advance the checkpoint ONLY now that the batch has persisted (crash-safe).
    if (delta.newHistoryId) this.deps.repo.setHistoryId(accountId, delta.newHistoryId, this.now());
    this.deps.repo.pruneToMax(accountId, config.maxStored);

    // Catch-up mode (deliverNew=false) stores + advances the checkpoint but suppresses the delivery
    // burst (no chat/notify/TTS for a backlog accrued while the app was closed).
    if (deliverNew && config.notificationsEnabled && newMsgs.length) this.deps.onNewMessages?.(newMsgs);
    this.log(
      'info',
      `gmail: incremental +${fetched} -${delta.messagesDeleted.length} (${newMsgs.length} new${deliverNew ? '' : ', catch-up'})`,
    );
    return { ok: true, mode: 'incremental', fetched, deleted: delta.messagesDeleted.length, newCount: newMsgs.length };
  }
}

/** Bounded-concurrency map (shared with the email-delivery coordinator). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 0 }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return results;
}
