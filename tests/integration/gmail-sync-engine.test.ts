import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../electron/database/open';
import { GmailRepository } from '../../electron/database/gmail-repository';
import { GmailSyncEngine, type SyncConfig, type NewMessage } from '../../electron/gmail/sync-engine';
import { HistoryExpiredError, type MailProvider, type FetchedMessage, type HistoryDelta } from '../../core/gmail/mail-provider';
import type { SqliteDriver } from '../../electron/database/driver';
import type { GmailAccount } from '../../core/gmail/types';

/** Drives the real engine + real DB against a scripted fake MailProvider — proves initial/
 *  incremental/recovery/dedup/delete/label/notify + the storeContext gate + not-connected path. */

function fetched(id: string, labels: string[], date = 1_700_000_000_000): FetchedMessage {
  return {
    message: {
      id,
      threadId: `t-${id}`,
      accountId: '',
      historyId: '1',
      internalDate: date,
      fromName: 'Sender',
      fromAddress: `${id}@x.com`,
      subject: `Subject ${id}`,
      snippet: `snippet ${id}`,
      isUnread: labels.includes('UNREAD'),
      isStarred: labels.includes('STARRED'),
      sizeEstimate: 100,
      labelIds: labels,
    },
    participants: [{ name: 'Sender', address: `${id}@x.com`, role: 'from' }],
    attachments: [],
  };
}

class FakeProvider implements MailProvider {
  readonly id = 'fake';
  profileHistoryId = '100';
  pages: string[][] = [];
  private pageIdx = 0;
  messages: Record<string, FetchedMessage> = {};
  historyQueue: HistoryDelta[] = [];
  historyThrows = false;

  async getProfile() {
    return { emailAddress: 'me@x.com', historyId: this.profileHistoryId };
  }
  async listMessageIds(_t: string, _pageToken?: string) {
    const ids = this.pages[this.pageIdx] ?? [];
    const next = this.pageIdx < this.pages.length - 1 ? String(this.pageIdx + 1) : null;
    this.pageIdx++;
    return { ids, nextPageToken: next };
  }
  async getMessage(_t: string, id: string): Promise<FetchedMessage> {
    const m = this.messages[id];
    if (!m) throw new Error(`no fake message ${id}`);
    return m;
  }
  async history(_t: string): Promise<HistoryDelta> {
    if (this.historyThrows) throw new HistoryExpiredError();
    return this.historyQueue.shift() ?? { messagesAdded: [], messagesDeleted: [], labelsChanged: [], newHistoryId: null };
  }
  async listLabels() {
    return [];
  }
}

let dbPath: string;
let db: SqliteDriver;
let repo: GmailRepository;
let provider: FakeProvider;
let account: GmailAccount;
let newBatches: NewMessage[][];

function makeEngine(configOverride: Partial<SyncConfig> = {}, token: string | null = 'tok') {
  const config: SyncConfig = {
    storeContext: true,
    downloadAttachments: false,
    maxStored: 0,
    notificationsEnabled: true,
    ...configOverride,
  };
  return new GmailSyncEngine({
    provider,
    repo,
    getAccessToken: async () => token,
    getConfig: () => config,
    onNewMessages: (msgs) => newBatches.push(msgs),
  });
}

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-sync-${randomUUID()}.db`);
  db = openDatabase(dbPath);
  repo = new GmailRepository(db);
  provider = new FakeProvider();
  newBatches = [];
  const now = Date.now();
  account = { id: randomUUID(), emailAddress: 'me@x.com', scope: 's', connectedAt: now, updatedAt: now };
  repo.saveAccount(account);
});

afterEach(() => {
  db.close();
  for (const s of ['', '-wal', '-shm']) {
    try {
      rmSync(dbPath + s);
    } catch {
      /* ignore */
    }
  }
});

describe('GmailSyncEngine', () => {
  it('initial sync stores messages, seeds the checkpoint, and does NOT notify', async () => {
    provider.profileHistoryId = '100';
    provider.pages = [['m1', 'm2']];
    provider.messages = { m1: fetched('m1', ['INBOX', 'UNREAD']), m2: fetched('m2', ['INBOX']) };

    const r = await makeEngine().sync(account.id);
    expect(r.mode).toBe('initial');
    expect(r.fetched).toBe(2);
    expect(repo.messageCount(account.id)).toBe(2);
    expect(repo.getSyncState(account.id)?.historyId).toBe('100');
    expect(newBatches).toHaveLength(0); // no whole-inbox notification storm
    expect(repo.getSyncState(account.id)?.status).toBe('idle');
  });

  it('incremental: new INBOX+UNREAD is stored + notified; deletes and label changes apply; checkpoint advances', async () => {
    // Seed two stored messages + a checkpoint.
    repo.upsertMessage(account.id, { ...fetched('m1', ['INBOX', 'UNREAD']).message, accountId: account.id }, [], []);
    repo.upsertMessage(account.id, { ...fetched('m2', ['INBOX', 'UNREAD']).message, accountId: account.id }, [], []);
    repo.setHistoryId(account.id, '100', Date.now());

    provider.messages = { m3: fetched('m3', ['INBOX', 'UNREAD']) };
    provider.historyQueue = [
      {
        messagesAdded: ['m3'],
        messagesDeleted: ['m1'],
        labelsChanged: [{ messageId: 'm2', labelIds: ['INBOX'] }], // UNREAD removed → read
        newHistoryId: '200',
      },
    ];

    const r = await makeEngine().sync(account.id);
    expect(r.mode).toBe('incremental');
    expect(r.newCount).toBe(1);
    expect(r.deleted).toBe(1);
    expect(repo.messageExists('m3')).toBe(true); // added
    expect(repo.messageExists('m1')).toBe(false); // deleted
    expect(repo.getMessage('m2')?.isUnread).toBe(false); // label delta applied
    expect(repo.getSyncState(account.id)?.historyId).toBe('200'); // checkpoint advanced
    expect(newBatches.flat().map((m) => m.id)).toEqual(['m3']);
  });

  it('dedup: an already-stored added message does not notify again', async () => {
    repo.upsertMessage(account.id, { ...fetched('m3', ['INBOX', 'UNREAD']).message, accountId: account.id }, [], []);
    repo.setHistoryId(account.id, '100', Date.now());
    provider.messages = { m3: fetched('m3', ['INBOX', 'UNREAD']) };
    provider.historyQueue = [{ messagesAdded: ['m3'], messagesDeleted: [], labelsChanged: [], newHistoryId: '201' }];

    const r = await makeEngine().sync(account.id);
    expect(r.newCount).toBe(0); // existed before → not "new"
    expect(newBatches).toHaveLength(0);
  });

  it('a non-INBOX added message (e.g. SENT) is not treated as new mail', async () => {
    repo.setHistoryId(account.id, '100', Date.now());
    provider.messages = { s1: fetched('s1', ['SENT']) };
    provider.historyQueue = [{ messagesAdded: ['s1'], messagesDeleted: [], labelsChanged: [], newHistoryId: '202' }];

    const r = await makeEngine().sync(account.id);
    expect(r.newCount).toBe(0);
  });

  it('expired checkpoint → reseeds via a fresh initial sync', async () => {
    repo.setHistoryId(account.id, '5', Date.now());
    provider.historyThrows = true;
    provider.profileHistoryId = '300';
    provider.pages = [['m9']];
    provider.messages = { m9: fetched('m9', ['INBOX']) };

    const r = await makeEngine().sync(account.id);
    expect(r.mode).toBe('initial'); // recovered by reseeding
    expect(repo.messageExists('m9')).toBe(true);
    expect(repo.getSyncState(account.id)?.historyId).toBe('300');
  });

  it('storeContext=false: nothing stored, but the cursor advances and new mail still notifies', async () => {
    repo.setHistoryId(account.id, '100', Date.now());
    provider.messages = { m7: fetched('m7', ['INBOX', 'UNREAD']) };
    provider.historyQueue = [{ messagesAdded: ['m7'], messagesDeleted: [], labelsChanged: [], newHistoryId: '250' }];

    const r = await makeEngine({ storeContext: false }).sync(account.id);
    expect(repo.messageCount(account.id)).toBe(0); // nothing persisted
    expect(r.newCount).toBe(1); // still notified
    expect(repo.getSyncState(account.id)?.historyId).toBe('250'); // cursor advanced
  });

  it('an un-fetchable added message (Gmail 404) is skipped — batch + checkpoint still advance', async () => {
    repo.setHistoryId(account.id, '100', Date.now());
    // 'gone' is in the history delta but absent from the provider → getMessage throws (404-like).
    provider.messages = { good1: fetched('good1', ['INBOX', 'UNREAD']), good2: fetched('good2', ['INBOX', 'UNREAD']) };
    provider.historyQueue = [
      { messagesAdded: ['good1', 'gone', 'good2'], messagesDeleted: [], labelsChanged: [], newHistoryId: '500' },
    ];

    const r = await makeEngine().sync(account.id);
    expect(r.ok).toBe(true); // not wedged
    expect(repo.messageExists('good1')).toBe(true);
    expect(repo.messageExists('good2')).toBe(true); // the good ones after the bad id still stored
    expect(repo.messageExists('gone')).toBe(false);
    expect(r.newCount).toBe(2);
    expect(repo.getSyncState(account.id)?.historyId).toBe('500'); // checkpoint advanced past the bad id
    expect(repo.getSyncState(account.id)?.status).toBe('idle');
  });

  it('no access token → status reconnect_needed, sync skipped', async () => {
    const r = await makeEngine({}, null).sync(account.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_connected');
    expect(repo.getSyncState(account.id)?.status).toBe('reconnect_needed');
  });

  it('maxStored prunes to the newest N after sync', async () => {
    provider.profileHistoryId = '100';
    provider.pages = [['a', 'b', 'c']];
    provider.messages = {
      a: fetched('a', ['INBOX'], 1000),
      b: fetched('b', ['INBOX'], 2000),
      c: fetched('c', ['INBOX'], 3000),
    };
    // initialLimit>maxStored forces fetch-all-then-prune (initial fetch normally caps at maxStored).
    await makeEngine({ maxStored: 2, initialLimit: 10 }).sync(account.id);
    expect(repo.messageCount(account.id)).toBe(2);
    expect(repo.messageExists('a')).toBe(false); // oldest pruned
    expect(repo.messageExists('c')).toBe(true);
  });
});
