/**
 * GmailTokenStore — the ONLY place Gmail OAuth tokens and the OAuth client secret are encrypted,
 * decrypted, or read. Mirrors ApiKeyStore exactly (safeStorage/DPAPI ciphertext held in settings
 * rows; plaintext produced only in main; NEVER crosses IPC). Two independent encrypted slots:
 *
 *   - the token bundle  → `gmail_token_ciphertext`
 *   - the client secret → `gmail_client_secret_ciphertext`
 *
 * Both are excluded from `settings.getAllSafe()`, so the settings DTO can never leak them.
 * Refuses to persist when OS encryption is unavailable (no plaintext-on-disk fallback).
 *
 * Dependencies (safeStorage + the two ciphertext read/write pairs) are injected so the store is
 * unit-testable with fakes, exactly like ApiKeyStore.
 */
import { EncryptionUnavailableError, type SafeStorageLike } from './api-key-store';
import type { GmailTokens } from '../../core/gmail/types';

export { EncryptionUnavailableError } from './api-key-store';

export interface CiphertextSlot {
  read: () => string;
  write: (base64: string) => void;
}

export class GmailTokenStore {
  constructor(
    private readonly safeStorage: SafeStorageLike,
    private readonly tokenSlot: CiphertextSlot,
    private readonly secretSlot: CiphertextSlot,
  ) {}

  private encrypt(plaintext: string): string {
    if (!this.safeStorage.isEncryptionAvailable()) throw new EncryptionUnavailableError();
    return this.safeStorage.encryptString(plaintext).toString('base64');
  }

  private decrypt(b64: string): string | null {
    if (!b64) return null;
    try {
      return this.safeStorage.decryptString(Buffer.from(b64, 'base64'));
    } catch {
      return null; // e.g. profile moved between machines — treat as "not stored", never crash
    }
  }

  // ── token bundle ────────────────────────────────────────────────────────────
  setTokens(tokens: GmailTokens): void {
    this.tokenSlot.write(this.encrypt(JSON.stringify(tokens)));
  }

  getTokens(): GmailTokens | null {
    const json = this.decrypt(this.tokenSlot.read());
    if (!json) return null;
    try {
      return JSON.parse(json) as GmailTokens;
    } catch {
      return null;
    }
  }

  clearTokens(): void {
    this.tokenSlot.write('');
  }

  hasTokens(): boolean {
    return this.tokenSlot.read().length > 0;
  }

  // ── client secret ─────────────────────────────────────────────────────────────
  setClientSecret(secret: string): void {
    const s = secret.trim();
    if (!s) throw new Error('empty client secret');
    this.secretSlot.write(this.encrypt(s));
  }

  getClientSecret(): string | null {
    return this.decrypt(this.secretSlot.read());
  }

  clearClientSecret(): void {
    this.secretSlot.write('');
  }

  hasClientSecret(): boolean {
    return this.secretSlot.read().length > 0;
  }
}
