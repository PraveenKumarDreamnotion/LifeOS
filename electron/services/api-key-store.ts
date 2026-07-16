/**
 * ApiKeyStore (09 §7, 30 §13.6) — the ONLY place the OpenAI API key is encrypted, decrypted,
 * or read. The key is stored as `safeStorage` (DPAPI on Windows) ciphertext in the
 * `ai_key_ciphertext` setting; the decrypted plaintext is produced only here, only in main, and
 * NEVER crosses IPC (the safe DTO exposes `hasApiKey: boolean` only — invariant §8.4).
 *
 * Dependencies are injected (safeStorage + ciphertext read/write) so the store is unit-testable
 * with fakes and never touches the real Electron API under vitest-node.
 */

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(data: Buffer): string;
}

export class EncryptionUnavailableError extends Error {
  constructor() {
    super('Secure key storage is unavailable on this device.');
    this.name = 'EncryptionUnavailableError';
  }
}

export class ApiKeyStore {
  constructor(
    private readonly safeStorage: SafeStorageLike,
    private readonly readCiphertext: () => string,
    private readonly writeCiphertext: (base64: string) => void,
  ) {}

  /**
   * Encrypt and persist the plaintext key. Refuses (no plaintext-on-disk fallback) when
   * OS-level encryption is unavailable — the caller surfaces "secure storage unavailable".
   */
  set(plaintext: string): void {
    const key = plaintext.trim();
    if (!key) throw new Error('empty key');
    if (!this.safeStorage.isEncryptionAvailable()) throw new EncryptionUnavailableError();
    this.writeCiphertext(this.safeStorage.encryptString(key).toString('base64'));
  }

  /**
   * Decrypt and return the key, or null if none is stored or decryption fails (e.g. the
   * profile was moved between machines — treated as "no key", never a crash — 42 recovery test).
   */
  get(): string | null {
    const b64 = this.readCiphertext();
    if (!b64) return null;
    try {
      return this.safeStorage.decryptString(Buffer.from(b64, 'base64'));
    } catch {
      return null;
    }
  }

  clear(): void {
    this.writeCiphertext('');
  }

  /** True if a ciphertext is present (does NOT prove it decrypts — cheap boolean for the DTO). */
  has(): boolean {
    return this.readCiphertext().length > 0;
  }
}
