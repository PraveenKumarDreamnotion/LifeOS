import { describe, it, expect } from 'vitest';
import { ApiKeyStore, EncryptionUnavailableError, type SafeStorageLike } from '../../electron/services/api-key-store';

/** A fake safeStorage: "encryption" is a reversible base64 marker so the test is deterministic. */
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
  let cipher = '';
  const store = new ApiKeyStore(
    safe,
    () => cipher,
    (b64) => {
      cipher = b64;
    },
  );
  return { store, peek: () => cipher };
}

describe('ApiKeyStore', () => {
  it('encrypts on set and round-trips on get', () => {
    const { store, peek } = makeStore(fakeSafeStorage());
    store.set('sk-test-0000000000000000000000');
    expect(peek()).not.toBe(''); // ciphertext stored
    expect(peek()).not.toContain('sk-test'); // not plaintext at rest
    expect(store.get()).toBe('sk-test-0000000000000000000000');
    expect(store.has()).toBe(true);
  });

  it('returns null and has()=false when no key is stored', () => {
    const { store } = makeStore(fakeSafeStorage());
    expect(store.get()).toBeNull();
    expect(store.has()).toBe(false);
  });

  it('clear() removes the key', () => {
    const { store } = makeStore(fakeSafeStorage());
    store.set('sk-test-0000000000000000000000');
    store.clear();
    expect(store.has()).toBe(false);
    expect(store.get()).toBeNull();
  });

  it('refuses to persist when encryption is unavailable (no plaintext on disk)', () => {
    const { store, peek } = makeStore(fakeSafeStorage(false));
    expect(() => store.set('sk-test-0000000000000000000000')).toThrow(EncryptionUnavailableError);
    expect(peek()).toBe(''); // nothing written
  });

  it('rejects an empty key', () => {
    const { store } = makeStore(fakeSafeStorage());
    expect(() => store.set('   ')).toThrow();
  });

  it('treats undecryptable ciphertext as no key (e.g. profile moved between machines)', () => {
    // Store ciphertext with a safeStorage that then fails to decrypt it.
    const failing: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (p) => Buffer.from('enc:' + p, 'utf8'),
      decryptString: () => {
        throw new Error('decrypt failed');
      },
    };
    const { store } = makeStore(failing);
    store.set('sk-test-0000000000000000000000');
    expect(store.has()).toBe(true); // ciphertext present
    expect(store.get()).toBeNull(); // but undecryptable → treated as no key, never a crash
  });
});
