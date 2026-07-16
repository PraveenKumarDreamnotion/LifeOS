/**
 * GmailProvider — the concrete Gmail implementation of the MailProvider seam (Phase 2). All Gmail
 * REST calls live here; the sync engine stays provider-agnostic so Outlook/IMAP can slot in later.
 *
 * Fetch strategy (docs §2.6): the normal path uses `format=metadata` (headers + labels + snippet +
 * internalDate + sizeEstimate + threadId + historyId) — cheap, and works even with only the
 * gmail.metadata scope. `format=full` (the MIME tree needed for attachment parts) is requested ONLY
 * when the caller asks (Download Attachments on). Transient 429/5xx are retried with capped
 * exponential backoff + jitter; a 404 on history → HistoryExpiredError for the engine to reseed.
 *
 * The token is passed in per call (from gmail-auth.getValidAccessToken); this class holds no creds.
 */
import type { MailProvider, FetchedMessage, HistoryDelta } from '../../core/gmail/mail-provider';
import { HistoryExpiredError } from '../../core/gmail/mail-provider';
import type { GmailMessage, GmailParticipant, GmailAttachmentMeta, GmailLabel, ParticipantRole } from '../../core/gmail/types';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const METADATA_HEADERS = ['From', 'To', 'Cc', 'Bcc', 'Subject', 'Date'];
const MAX_RETRIES = 4;

/** Capped exponential backoff with jitter (ms) for retry attempt N. */
function backoffMs(attempt: number): number {
  return Math.min(16_000, 2 ** attempt * 500) + Math.floor(Math.random() * 250);
}

export class GmailApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GmailApiError';
  }
}

// ── raw Gmail JSON shapes (only the fields we read) ───────────────────────────
interface RawHeader { name: string; value: string }
interface RawPart {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: RawPart[];
  headers?: RawHeader[];
}
interface RawMessage {
  id: string;
  threadId: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  sizeEstimate?: number;
  labelIds?: string[];
  payload?: RawPart;
}

export class GmailProvider implements MailProvider {
  readonly id = 'gmail';
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (opts.sleep) this.sleep = opts.sleep;
  }

  private sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  async getProfile(token: string): Promise<{ emailAddress: string; historyId: string | null }> {
    const d = (await this.getJson(token, '/profile')) as { emailAddress?: string; historyId?: string };
    if (!d.emailAddress) throw new GmailApiError(0, 'profile missing address');
    return { emailAddress: d.emailAddress, historyId: d.historyId ?? null };
  }

  async listMessageIds(token: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken: string | null }> {
    const q = new URLSearchParams({ maxResults: '100' });
    if (pageToken) q.set('pageToken', pageToken);
    // messages.list excludes SPAM/TRASH by default (includeSpamTrash omitted).
    const d = (await this.getJson(token, `/messages?${q}`)) as { messages?: { id: string }[]; nextPageToken?: string };
    return { ids: (d.messages ?? []).map((m) => m.id), nextPageToken: d.nextPageToken ?? null };
  }

  async getMessage(token: string, id: string, opts?: { full?: boolean }): Promise<FetchedMessage> {
    const q = new URLSearchParams({ format: opts?.full ? 'full' : 'metadata' });
    if (!opts?.full) for (const h of METADATA_HEADERS) q.append('metadataHeaders', h);
    const d = (await this.getJson(token, `/messages/${id}?${q}`)) as RawMessage;
    return parseMessage(d);
  }

  async history(token: string, startHistoryId: string): Promise<HistoryDelta> {
    const added = new Set<string>();
    const deleted = new Set<string>();
    const labelChanges = new Map<string, string[]>();
    let latest = startHistoryId;
    let pageToken: string | undefined;

    do {
      const q = new URLSearchParams({ startHistoryId });
      for (const t of ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']) q.append('historyTypes', t);
      if (pageToken) q.set('pageToken', pageToken);

      let d: RawHistoryResponse;
      try {
        d = (await this.getJson(token, `/history?${q}`)) as RawHistoryResponse;
      } catch (e) {
        if (e instanceof GmailApiError && e.status === 404) throw new HistoryExpiredError();
        throw e;
      }

      if (d.historyId) latest = d.historyId;
      for (const h of d.history ?? []) {
        for (const a of h.messagesAdded ?? []) added.add(a.message.id);
        for (const del of h.messagesDeleted ?? []) deleted.add(del.message.id);
        for (const la of h.labelsAdded ?? []) labelChanges.set(la.message.id, la.message.labelIds ?? []);
        for (const lr of h.labelsRemoved ?? []) labelChanges.set(lr.message.id, lr.message.labelIds ?? []);
      }
      pageToken = d.nextPageToken;
    } while (pageToken);

    // A message that was deleted this window shouldn't also be treated as added or label-changed.
    for (const id of deleted) {
      added.delete(id);
      labelChanges.delete(id);
    }

    return {
      messagesAdded: [...added],
      messagesDeleted: [...deleted],
      labelsChanged: [...labelChanges].map(([messageId, labelIds]) => ({ messageId, labelIds })),
      newHistoryId: latest,
    };
  }

  async listLabels(token: string): Promise<GmailLabel[]> {
    const d = (await this.getJson(token, '/labels')) as { labels?: { id: string; name: string; type?: string }[] };
    return (d.labels ?? []).map((l) => ({ id: l.id, name: l.name, type: l.type ?? 'user' }));
  }

  // ── HTTP with capped backoff ────────────────────────────────────────────────
  private async getJson(token: string, path: string): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) return res.json();

      // 429 / 5xx are always transient → retry without reading the body.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await this.sleep(backoffMs(attempt++));
        continue;
      }

      // Read Google's error (needed for the message AND for 403 rate-limit detection).
      const err = await extractError(res);
      // A 403 can be a RATE LIMIT (machine reason rateLimitExceeded / userRateLimitExceeded /
      // RESOURCE_EXHAUSTED) — retry those. A 403 for scope/permission (e.g. "Metadata scope does not
      // permit format FULL") is terminal and must NOT be retried.
      if (res.status === 403 && err.isRateLimit && attempt < MAX_RETRIES) {
        await this.sleep(backoffMs(attempt++));
        continue;
      }
      throw new GmailApiError(res.status, `Gmail API ${res.status}${err.message ? `: ${err.message}` : ''} on ${path.split('?')[0]}`);
    }
  }
}

/** Best-effort read of a Gmail error body (never throws). Returns the human message plus whether
 *  the machine reason indicates a rate limit (vs a terminal scope/permission 403). */
async function extractError(res: Response): Promise<{ message: string; isRateLimit: boolean }> {
  try {
    const body = (await res.json()) as {
      error?: { message?: string; status?: string; errors?: { reason?: string }[] };
    };
    const err = body.error ?? {};
    const reasons = (err.errors ?? []).map((e) => e?.reason ?? '').join(' ');
    const isRateLimit = /rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/i.test(`${reasons} ${err.status ?? ''}`);
    return { message: err.message ?? '', isRateLimit };
  } catch {
    return { message: '', isRateLimit: false };
  }
}

// ── pure parsing (exported for unit tests) ────────────────────────────────────
interface RawHistoryMessageRef { message: { id: string; labelIds?: string[] } }
interface RawHistoryRecord {
  messagesAdded?: RawHistoryMessageRef[];
  messagesDeleted?: RawHistoryMessageRef[];
  labelsAdded?: RawHistoryMessageRef[];
  labelsRemoved?: RawHistoryMessageRef[];
}
interface RawHistoryResponse {
  history?: RawHistoryRecord[];
  historyId?: string;
  nextPageToken?: string;
}

export function parseMessage(d: RawMessage): FetchedMessage {
  const headers = new Map<string, string>();
  for (const h of d.payload?.headers ?? []) headers.set(h.name.toLowerCase(), h.value);

  const participants: GmailParticipant[] = [
    ...parseAddressList(headers.get('from'), 'from'),
    ...parseAddressList(headers.get('to'), 'to'),
    ...parseAddressList(headers.get('cc'), 'cc'),
    ...parseAddressList(headers.get('bcc'), 'bcc'),
  ];
  const from = participants.find((p) => p.role === 'from') ?? null;
  const labelIds = d.labelIds ?? [];

  const message: GmailMessage = {
    id: d.id,
    threadId: d.threadId,
    accountId: '', // set by the engine at upsert time
    historyId: d.historyId ?? null,
    internalDate: Number(d.internalDate ?? 0),
    fromName: from?.name ?? null,
    fromAddress: from?.address ?? null,
    subject: headers.get('subject') ?? '',
    snippet: d.snippet ?? '',
    isUnread: labelIds.includes('UNREAD'),
    isStarred: labelIds.includes('STARRED'),
    sizeEstimate: d.sizeEstimate ?? 0,
    labelIds,
  };

  return { message, participants, attachments: extractAttachments(d.payload) };
}

/** Walk the MIME tree for parts that are attachments (present only with format=full). */
export function extractAttachments(part: RawPart | undefined): GmailAttachmentMeta[] {
  const out: GmailAttachmentMeta[] = [];
  const walk = (p: RawPart | undefined): void => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      out.push({
        attachmentId: p.body.attachmentId,
        filename: p.filename,
        mimeType: p.mimeType ?? 'application/octet-stream',
        sizeBytes: p.body.size ?? 0,
        localPath: null,
      });
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(part);
  return out;
}

/** Parse an RFC 5322 address list into participants. Best-effort split (quoted commas are rare in
 *  From/To and don't corrupt the address, only a display name). */
export function parseAddressList(raw: string | undefined, role: ParticipantRole): GmailParticipant[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const m = token.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
      if (m) {
        const name = (m[1] ?? '').trim();
        return { name: name || null, address: m[2]!.trim(), role };
      }
      return { name: null, address: token.replace(/[<>]/g, '').trim(), role };
    })
    .filter((p) => p.address.length > 0);
}
