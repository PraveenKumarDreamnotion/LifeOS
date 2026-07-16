import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../electron/database/open';
import { ChatRepository } from '../../electron/database/chat-repository';
import { GmailRepository } from '../../electron/database/gmail-repository';
import { EmailContextService } from '../../electron/gmail/email-context-service';
import { EmailResearchService } from '../../electron/gmail/email-research-service';
import { EmailDeliveryCoordinator } from '../../electron/gmail/email-delivery';
import type { SearchProvider } from '../../core/search/search-provider';
import type { NewMessage } from '../../electron/gmail/sync-engine';
import type { GmailNotifier } from '../../electron/gmail/gmail-notifier';
import type { LlmProvider } from '../../core/llm/llm-provider';
import type { SqliteDriver } from '../../electron/database/driver';
import type { GmailMessage, EmailAiContext } from '../../core/gmail/types';

let dbPath: string;
let db: SqliteDriver;
let chat: ChatRepository;
let gmailRepo: GmailRepository;
let accountId: string;

function storeMessage(id: string, labels = ['INBOX', 'UNREAD']): GmailMessage {
  const m: GmailMessage = {
    id, threadId: `t-${id}`, accountId, historyId: '1', internalDate: Date.now(),
    fromName: 'Amazon', fromAddress: `${id}@x.com`, subject: `Subject ${id}`, snippet: `snippet ${id}`,
    isUnread: labels.includes('UNREAD'), isStarred: false, sizeEstimate: 100, labelIds: labels,
  };
  gmailRepo.upsertMessage(accountId, m, [{ name: 'Amazon', address: `${id}@x.com`, role: 'from' }], []);
  return m;
}

function newMsg(id: string): NewMessage {
  return { id, fromName: 'Amazon', fromAddress: `${id}@x.com`, subject: `Subject ${id}`, snippet: `snippet ${id}` };
}

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-emaildel-${randomUUID()}.db`);
  db = openDatabase(dbPath);
  chat = new ChatRepository(db);
  gmailRepo = new GmailRepository(db);
  accountId = randomUUID();
  gmailRepo.saveAccount({ id: accountId, emailAddress: 'me@x.com', scope: 's', connectedAt: Date.now(), updatedAt: Date.now() });
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

const CTX: EmailAiContext = { summary: 'A parcel is on the way.', senderIntent: 'notify', actionItems: [], keyDates: [], priority: 'normal', researchWorthwhile: false, researchQuery: '' };

function makeCoordinator(over: {
  ttsEnabled?: boolean;
  audioBusy?: boolean;
  ensure?: (m: GmailMessage) => Promise<EmailAiContext | null>;
  autoResearch?: boolean;
  research?: (messageId: string, query: string) => Promise<{ query: string; answer: string; citations: { title: string; url: string }[] } | null>;
} = {}) {
  const show = vi.fn();
  const notifier = { show } as unknown as GmailNotifier;
  const fanout = vi.fn();
  const speak = vi.fn();
  const openChat = vi.fn();
  const context = { ensure: over.ensure ?? (async () => CTX) } as unknown as EmailContextService;
  const research = { research: over.research ?? (async () => null) } as unknown as EmailResearchService;
  const coordinator = new EmailDeliveryCoordinator({
    chat, gmailRepo, context, research, notifier, fanout, speak,
    autoResearch: () => over.autoResearch ?? false,
    ttsEnabled: () => over.ttsEnabled ?? true,
    isAudioBusy: () => over.audioBusy ?? false,
    openChat,
  });
  return { coordinator, show, fanout, speak, openChat };
}

describe('EmailDeliveryCoordinator', () => {
  it('delivers one email as its own chat: session + turn + notify + speak, all once', async () => {
    storeMessage('m1');
    const { coordinator, show, speak, fanout } = makeCoordinator();
    await coordinator.deliver([newMsg('m1')]);

    const session = chat.findSessionByEmail('m1');
    expect(session).toBeDefined();
    expect(session!.emailMessageId).toBe('m1');
    const turns = chat.loadTurns(session!.id);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.kind).toBe('email');
    expect(turns[0]!.userText).toBe(''); // assistant-only
    expect(turns[0]!.assistantText).toContain('A parcel is on the way.');
    expect(show).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledTimes(1);
    // Broadcast a turn-appended + a sessions-changed.
    expect(fanout.mock.calls.some((c) => c[0] === 'chat:turn:appended')).toBe(true);
    expect(fanout.mock.calls.some((c) => c[0] === 'chat:sessionsChanged')).toBe(true);
  });

  it('is quiet: an email chat is NOT the launcher continuity target', async () => {
    const normal = chat.createSession('My conversation');
    storeMessage('m1');
    const { coordinator } = makeCoordinator();
    await coordinator.deliver([newMsg('m1')]);
    // The most-recent NON-email chat is still the normal one, even though the email chat is newer.
    expect(chat.mostRecentConversation()?.id).toBe(normal.id);
  });

  it('dedup: a re-delivered email does not spawn a second chat or notify again', async () => {
    storeMessage('m1');
    const { coordinator, show } = makeCoordinator();
    await coordinator.deliver([newMsg('m1')]);
    show.mockClear();
    await coordinator.deliver([newMsg('m1')]); // same id again

    expect(chat.listSessions().filter((s) => s.emailMessageId === 'm1')).toHaveLength(1);
    expect(show).not.toHaveBeenCalled(); // nothing new delivered
  });

  it('batch: N new emails → N chats but ONE notification and ONE utterance', async () => {
    ['a', 'b', 'c'].forEach((id) => storeMessage(id));
    const { coordinator, show, speak } = makeCoordinator();
    await coordinator.deliver([newMsg('a'), newMsg('b'), newMsg('c')]);

    expect(chat.listSessions().filter((s) => s.emailMessageId).length).toBe(3);
    expect(show).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledTimes(1); // never 3 overlapping
    expect(show.mock.calls[0]![0].title).toContain('3 new emails');
  });

  it('skips TTS when audio is busy, but still notifies', async () => {
    storeMessage('m1');
    const { coordinator, show, speak } = makeCoordinator({ audioBusy: true });
    await coordinator.deliver([newMsg('m1')]);
    expect(show).toHaveBeenCalledTimes(1);
    expect(speak).not.toHaveBeenCalled();
  });

  it('skips TTS when TTS is disabled', async () => {
    storeMessage('m1');
    const { coordinator, speak } = makeCoordinator({ ttsEnabled: false });
    await coordinator.deliver([newMsg('m1')]);
    expect(speak).not.toHaveBeenCalled();
  });
});

// Research is fire-and-forget inside deliver(); flush it before asserting.
const tick = () => new Promise((r) => setTimeout(r, 10));

describe('EmailDeliveryCoordinator — auto-research (Phase 4)', () => {
  const worthy = { ...CTX, researchWorthwhile: true, researchQuery: 'flight AA123 delay' };

  it('researches a worthy email when auto-research is on and appends a research turn', async () => {
    storeMessage('m1');
    const research = vi.fn(async (_id: string, q: string) => ({ query: q, answer: 'Delayed 2h.', citations: [{ title: 'Airline', url: 'https://a.co' }] }));
    const { coordinator } = makeCoordinator({ autoResearch: true, ensure: async () => worthy, research });
    await coordinator.deliver([newMsg('m1')]);
    await tick();

    expect(research).toHaveBeenCalledWith('m1', 'flight AA123 delay');
    const session = chat.findSessionByEmail('m1')!;
    const turns = chat.loadTurns(session.id);
    expect(turns).toHaveLength(2); // summary turn + research turn
    expect(turns[1]!.assistantText).toContain('Delayed 2h.');
    expect(turns[1]!.kind).toBe('email'); // assistant-only → in context for cross-questions
  });

  it('does not research when auto-research is off', async () => {
    storeMessage('m1');
    const research = vi.fn(async () => ({ query: 'q', answer: 'A', citations: [] }));
    const { coordinator } = makeCoordinator({ autoResearch: false, ensure: async () => worthy, research });
    await coordinator.deliver([newMsg('m1')]);
    await tick();
    expect(research).not.toHaveBeenCalled();
  });

  it('does not research a non-worthy email even with auto-research on', async () => {
    storeMessage('m1');
    const research = vi.fn(async () => ({ query: 'q', answer: 'A', citations: [] }));
    const { coordinator } = makeCoordinator({ autoResearch: true, ensure: async () => CTX, research }); // CTX worthy=false
    await coordinator.deliver([newMsg('m1')]);
    await tick();
    expect(research).not.toHaveBeenCalled();
  });

  it('research append does NOT trigger a second spoken line', async () => {
    storeMessage('m1');
    const { coordinator, speak } = makeCoordinator({
      autoResearch: true,
      ensure: async () => worthy,
      research: async () => ({ query: 'q', answer: 'A', citations: [] }),
    });
    await coordinator.deliver([newMsg('m1')]);
    await tick();
    expect(speak).toHaveBeenCalledTimes(1); // only the initial heads-up
  });
});

// ── EmailResearchService (real repo + fake SearchProvider) ─────────────────────
function fakeSearch(search: SearchProvider['search']): SearchProvider {
  return { id: 'test', search };
}

describe('EmailResearchService', () => {
  it('searches, caches, and dedups (second call uses the cache)', async () => {
    storeMessage('m1');
    const search = vi.fn(async () => ({ answer: 'Delayed.', citations: [{ title: 'A', url: 'https://a.co' }] }));
    const svc = new EmailResearchService({ gmailRepo, searchProvider: () => fakeSearch(search) });

    const r = await svc.research('m1', 'flight delay');
    expect(r?.answer).toBe('Delayed.');
    expect(gmailRepo.getResearch('m1')?.answer).toBe('Delayed.'); // persisted
    const again = await svc.research('m1', 'flight delay');
    expect(again?.answer).toBe('Delayed.');
    expect(search).toHaveBeenCalledTimes(1); // cached — no second paid search
  });

  it('returns null with no provider, an empty query, or on a search error', async () => {
    storeMessage('m1');
    expect(await new EmailResearchService({ gmailRepo, searchProvider: () => null }).research('m1', 'q')).toBeNull();
    expect(await new EmailResearchService({ gmailRepo, searchProvider: () => fakeSearch(vi.fn()) }).research('m1', '   ')).toBeNull();
    const boom = new EmailResearchService({
      gmailRepo,
      searchProvider: () => fakeSearch(async () => { throw new Error('x'); }),
    });
    expect(await boom.research('m1', 'q')).toBeNull();
  });
});

// ── EmailContextService (real repo + fake LLM) ────────────────────────────────
function fakeLlm(complete: LlmProvider['complete']): LlmProvider {
  return { id: 'openai', isLocal: false, supportsStreaming: false, complete };
}

describe('EmailContextService', () => {
  it('returns null when summaries are disabled (no LLM call)', async () => {
    storeMessage('m1');
    const complete = vi.fn();
    const svc = new EmailContextService({ gmailRepo, llm: () => fakeLlm(complete), summariesEnabled: () => false });
    expect(await svc.ensure(gmailRepo.getMessage('m1')!)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect(gmailRepo.getAiContext('m1')).toBeNull();
  });

  it('returns null when no provider is available', async () => {
    storeMessage('m1');
    const svc = new EmailContextService({ gmailRepo, llm: () => null, summariesEnabled: () => true });
    expect(await svc.ensure(gmailRepo.getMessage('m1')!)).toBeNull();
  });

  it('generates, persists, and caches (second call does not re-hit the LLM)', async () => {
    storeMessage('m1');
    const complete = vi.fn(async () => ({ summary: 'Parcel shipped.', senderIntent: 'notify', actionItems: ['Track'], keyDates: ['tomorrow'], priority: 'high' }));
    const svc = new EmailContextService({ gmailRepo, llm: () => fakeLlm(complete), summariesEnabled: () => true });

    const ctx = await svc.ensure(gmailRepo.getMessage('m1')!);
    expect(ctx?.summary).toBe('Parcel shipped.');
    expect(ctx?.priority).toBe('high');
    expect(gmailRepo.getAiContext('m1')?.actionItems).toEqual(['Track']); // persisted

    const again = await svc.ensure(gmailRepo.getMessage('m1')!);
    expect(again?.summary).toBe('Parcel shipped.');
    expect(complete).toHaveBeenCalledTimes(1); // cached — no second LLM call
  });

  it('degrades to null on an LLM error (never throws)', async () => {
    storeMessage('m1');
    const complete = vi.fn(async () => {
      throw new Error('boom');
    });
    const svc = new EmailContextService({ gmailRepo, llm: () => fakeLlm(complete), summariesEnabled: () => true });
    expect(await svc.ensure(gmailRepo.getMessage('m1')!)).toBeNull();
  });
});
