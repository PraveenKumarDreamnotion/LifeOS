import { describe, it, expect } from 'vitest';
import { GmailTokenStore, EncryptionUnavailableError } from '../../electron/services/gmail-token-store';
import type { SafeStorageLike } from '../../electron/services/api-key-store';
import type { GmailTokens } from '../../core/gmail/types';

function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain: string) => Buffer.from('enc:' + plain, 'utf8'),
    decryptString: (data: Buffer) => {
      const s = data.toString('utf8');
      if (!s.startsWith('enc:')) throw new Error('bad ciphertext');
      return s.slice(4);
    },
  };
}

function makeStore(safe: SafeStorageLike) {
  let tokenCipher = '';
  let secretCipher = '';
  const store = new GmailTokenStore(
    safe,
    { read: () => tokenCipher, write: (b) => { tokenCipher = b; } },
    { read: () => secretCipher, write: (b) => { secretCipher = b; } },
  );
  return { store, peekToken: () => tokenCipher, peekSecret: () => secretCipher };
}

const TOKENS: GmailTokens = {
  refreshToken: 'refresh-abc',
  accessToken: 'access-xyz',
  expiryMs: 1_700_000_000_000,
  scope: 'https://www.googleapis.com/auth/gmail.readonly',
  tokenType: 'Bearer',
};

describe('GmailTokenStore', () => {
  it('encrypts the token bundle and round-trips it', () => {
    const { store, peekToken } = makeStore(fakeSafeStorage());
    store.setTokens(TOKENS);
    expect(peekToken()).not.toBe('');
    expect(peekToken()).not.toContain('refresh-abc'); // never plaintext at rest
    expect(store.getTokens()).toEqual(TOKENS);
    expect(store.hasTokens()).toBe(true);
  });

  it('encrypts the client secret and round-trips it', () => {
    const { store, peekSecret } = makeStore(fakeSafeStorage());
    store.setClientSecret('GOCSPX-supersecret');
    expect(peekSecret()).not.toContain('GOCSPX-supersecret');
    expect(store.getClientSecret()).toBe('GOCSPX-supersecret');
    expect(store.hasClientSecret()).toBe(true);
  });

  it('token and secret slots are independent', () => {
    const { store } = makeStore(fakeSafeStorage());
    store.setClientSecret('sekret');
    expect(store.hasTokens()).toBe(false); // setting the secret doesn't create tokens
    store.setTokens(TOKENS);
    store.clearTokens();
    expect(store.hasTokens()).toBe(false);
    expect(store.hasClientSecret()).toBe(true); // clearing tokens leaves the secret
  });

  it('returns null when nothing is stored', () => {
    const { store } = makeStore(fakeSafeStorage());
    expect(store.getTokens()).toBeNull();
    expect(store.getClientSecret()).toBeNull();
    expect(store.hasTokens()).toBe(false);
    expect(store.hasClientSecret()).toBe(false);
  });

  it('refuses to persist when OS encryption is unavailable (no plaintext on disk)', () => {
    const { store, peekToken, peekSecret } = makeStore(fakeSafeStorage(false));
    expect(() => store.setTokens(TOKENS)).toThrow(EncryptionUnavailableError);
    expect(() => store.setClientSecret('x-secret')).toThrow(EncryptionUnavailableError);
    expect(peekToken()).toBe('');
    expect(peekSecret()).toBe('');
  });

  it('treats undecryptable ciphertext as not-stored (profile moved between machines)', () => {
    const failing: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (p) => Buffer.from('enc:' + p, 'utf8'),
      decryptString: () => {
        throw new Error('decrypt failed');
      },
    };
    const { store } = makeStore(failing);
    store.setTokens(TOKENS);
    expect(store.hasTokens()).toBe(true); // ciphertext present
    expect(store.getTokens()).toBeNull(); // but undecryptable → treated as none, never a crash
  });
});
