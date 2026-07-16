/**
 * The mail-source seam (extensibility). Gmail implements this in Phase 2; Outlook / Microsoft 365
 * / Exchange / Yahoo / IMAP can be added later as new adapters WITHOUT touching the sync engine,
 * schema, repository, notifications, AI context, or Yogi capabilities — the whole point of the
 * "connected source → local store → Yogi context" spine (docs §8).
 *
 * Phase 1 defines the interface only. No provider is registered yet; `makeMailProvider` returns
 * null so the seam exists and the wiring compiles.
 */
import type { GmailMessage, GmailAttachmentMeta, GmailLabel, GmailParticipant } from './types';

/** Thrown by a provider's `history()` when the stored checkpoint is too old to catch up from
 *  (Gmail returns 404). The sync engine catches this and reseeds via a bounded re-list. */
export class HistoryExpiredError extends Error {
  constructor() {
    super('history checkpoint expired');
    this.name = 'HistoryExpiredError';
  }
}

/** A minimal, provider-agnostic message view the sync engine persists. */
export interface FetchedMessage {
  message: GmailMessage;
  participants: GmailParticipant[];
  attachments: GmailAttachmentMeta[];
}

/** The delta a history/incremental call yields. */
export interface HistoryDelta {
  messagesAdded: string[];
  messagesDeleted: string[];
  labelsChanged: { messageId: string; labelIds: string[] }[];
  /** The new checkpoint to persist after this batch. */
  newHistoryId: string | null;
}

/**
 * Provider capabilities the sync engine relies on. All methods take an access token supplied by
 * the provider's own auth module (Gmail: `gmail-auth.getValidAccessToken()`), so this interface
 * carries no credentials itself.
 */
export interface MailProvider {
  readonly id: string; // 'gmail' | 'outlook' | 'imap' | …

  /** Verify connectivity + return the account address (used by "Test Connection"). */
  getProfile(accessToken: string): Promise<{ emailAddress: string; historyId: string | null }>;

  /** Initial-sync listing (paged); returns message ids + the next page token. */
  listMessageIds(accessToken: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken: string | null }>;

  /** Fetch one message. `full` pulls the MIME tree (needed for attachment parts); default is the
   *  cheaper metadata form (headers + labels + snippet), which is all Phase-2 sync stores. */
  getMessage(accessToken: string, id: string, opts?: { full?: boolean }): Promise<FetchedMessage>;

  /** Incremental delta since a checkpoint. Throws `HistoryExpiredError` if the checkpoint is too
   *  old (Gmail 404) so the engine can reseed via a bounded re-list. */
  history(accessToken: string, startHistoryId: string): Promise<HistoryDelta>;

  /** Label catalog. */
  listLabels(accessToken: string): Promise<GmailLabel[]>;
}

/** Config a mail provider factory reads. Phase 1 stub — extended in Phase 2. */
export interface MailProviderConfig {
  source: 'gmail' | 'none';
  connected: boolean;
}

/**
 * Factory seam. Phase 1: no concrete provider yet → null (the engine that would consume it is
 * Phase 2). Registering Gmail here in Phase 2 is a one-line change; adding Outlook/IMAP later is
 * another adapter + another branch.
 */
export function makeMailProvider(_cfg: MailProviderConfig): MailProvider | null {
  return null;
}
