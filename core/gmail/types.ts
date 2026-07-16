/**
 * Gmail domain types (pure — no electron, no node, no DOM). Shared by main (the auth
 * service, repository, future sync engine) and, for the safe subset, the renderer.
 *
 * Phase 1 uses `GmailAccount` + `GmailSyncState`. The message/thread/label/attachment
 * shapes are defined now so the Phase-2 sync engine + repository need no new types and no
 * new migration — the schema (M006_GMAIL) already backs them.
 */

/** OAuth scopes as opaque strings — kept here so main and any test reference the same set. */
export const GMAIL_SCOPES = {
  readonly: 'https://www.googleapis.com/auth/gmail.readonly',
  metadata: 'https://www.googleapis.com/auth/gmail.metadata',
  // Reserved for later phases (draft/send). Requested INCREMENTALLY so a read-only user
  // never grants write access.
  modify: 'https://www.googleapis.com/auth/gmail.modify',
  send: 'https://www.googleapis.com/auth/gmail.send',
} as const;

/**
 * Phase-1 scope set: `gmail.readonly` ONLY.
 *
 * IMPORTANT (learned the hard way): do NOT add `gmail.metadata`. When a token carries the metadata
 * scope, Gmail restricts `messages.get`/`threads.get` to `format=metadata|minimal` and returns 403
 * for `format=full` — even if `readonly` is also granted (metadata "poisons" the token). `readonly`
 * is a strict superset of metadata (headers + labels AND bodies/attachments), so read + metadata +
 * attachments all work under it with no restriction.
 */
export const PHASE1_SCOPES: readonly string[] = [GMAIL_SCOPES.readonly];

/** The decrypted token bundle. NEVER serialized to the renderer; lives only in main memory
 *  and (encrypted) in the token store. */
export interface GmailTokens {
  refreshToken: string;
  accessToken: string;
  /** Absolute expiry, UTC epoch ms. */
  expiryMs: number;
  scope: string;
  tokenType: string;
}

/** A connected account. `emailAddress` is safe to show; nothing here is secret. */
export interface GmailAccount {
  id: string;
  emailAddress: string;
  /** Space-separated granted scopes. */
  scope: string;
  connectedAt: number;
  updatedAt: number;
}

export type GmailSyncStatus = 'idle' | 'syncing' | 'error' | 'reconnect_needed';

/** The incremental-sync cursor (one row per account). `historyId` is the checkpoint the
 *  Phase-2 engine catches up from; a Pub/Sub pull feed would advance the same field. */
export interface GmailSyncState {
  accountId: string;
  historyId: string | null;
  lastSyncAt: number | null;
  lastFullSyncAt: number | null;
  /** Push-mode watch expiry (future); null under polling. */
  watchExpiry: number | null;
  status: GmailSyncStatus;
  lastError: string | null;
}

export type ParticipantRole = 'from' | 'to' | 'cc' | 'bcc';

export interface GmailParticipant {
  name: string | null;
  address: string;
  role: ParticipantRole;
}

export interface GmailAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Local path once downloaded (opt-in); null = metadata only. */
  localPath: string | null;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string; // 'system' | 'user'
}

/** AI-generated understanding of one email (Phase 3). Persisted in email_ai_context; used to speak
 *  the notification line and seed the email's chat so Yogi can answer about it. Phase 4 adds the
 *  web-research DECISION (worthwhile + a focused query) so it rides on the same summary call. */
export interface EmailAiContext {
  summary: string;
  senderIntent: string;
  actionItems: string[];
  keyDates: string[];
  priority: 'low' | 'normal' | 'high';
  /** Phase 4: does this email benefit from a live web lookup (visa/flight/gov/legal/tax/medical/
   *  shipping/admission class)? Defaults false — auto-research fires only on a clear yes. */
  researchWorthwhile: boolean;
  /** The focused search query to run when researchWorthwhile; '' otherwise. */
  researchQuery: string;
}

/** A cached web-research result for one email (Phase 4). */
export interface WebResearch {
  query: string;
  answer: string;
  citations: { title: string; url: string }[];
}

/** A stored message (the core row). `bodyText`/`bodyHtml` are populated on demand. */
export interface GmailMessage {
  id: string; // Gmail message id (unique)
  threadId: string;
  accountId: string;
  historyId: string | null;
  internalDate: number; // UTC epoch ms
  fromName: string | null;
  fromAddress: string | null;
  subject: string;
  snippet: string;
  isUnread: boolean;
  isStarred: boolean;
  sizeEstimate: number;
  labelIds: string[];
}
