import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../electron/database/open';
import { GmailRepository } from '../../electron/database/gmail-repository';
import { GmailTokenStore } from '../../electron/services/gmail-token-store';
import { GmailAuthService } from '../../electron/gmail/gmail-auth';
import { GOOGLE_TOKEN_ENDPOINT, GOOGLE_REVOKE_ENDPOINT } from '../../core/gmail/oauth';
import type { SafeStorageLike } from '../../electron/services/api-key-store';
import type { SqliteDriver } from '../../electron/database/driver';

/** The whole connect→refresh→disconnect flow against a REAL DB + REAL token store, with Google's
 *  HTTP endpoints mocked. Proves persistence, the invalid_grant → reconnect path, and that
 *  Disconnect actually calls the server-side revoke — none of which the pure unit tests cover. */

const NOW = 1_700_000_000_000;

function fakeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (p) => Buffer.from('enc:' + p, 'utf8'),
    decryptString: (d) => {
      const s = d.toString('utf8');
      if (!s.startsWith('enc:')) throw new Error('bad');
      return s.slice(4);
    },
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

interface Harness {
  auth: GmailAuthService;
  repo: GmailRepository;
  tokenStore: GmailTokenStore;
  calls: { url: string; body: string }[];
}

let dbPath: string;
let db: SqliteDriver;

beforeEach(() => {
  dbPath = join(tmpdir(), `lifeos-gmailflow-${randomUUID()}.db`);
  db = openDatabase(dbPath);
});

afterEach(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(dbPath + suffix);
    } catch {
      /* ignore */
    }
  }
});

/** Build a service whose refresh endpoint behaves per `refresh`. */
function makeHarness(opts: { refresh?: 'ok' | 'invalid_grant' } = {}): Harness {
  const repo = new GmailRepository(db);
  let tokenCipher = '';
  let secretCipher = '';
  const tokenStore = new GmailTokenStore(
    fakeSafeStorage(),
    { read: () => tokenCipher, write: (b) => { tokenCipher = b; } },
    { read: () => secretCipher, write: (b) => { secretCipher = b; } },
  );
  tokenStore.setClientSecret('client-secret');

  const calls: { url: string; body: string }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    calls.push({ url, body });
    if (url === GOOGLE_TOKEN_ENDPOINT) {
      if (body.includes('grant_type=refresh_token')) {
        if (opts.refresh === 'invalid_grant') return jsonResponse({ error: 'invalid_grant' }, false, 400);
        return jsonResponse({ access_token: 'access-2', expires_in: 3600, token_type: 'Bearer' });
      }
      // authorization_code exchange
      return jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
        token_type: 'Bearer',
      });
    }
    if (url === GOOGLE_REVOKE_ENDPOINT) return jsonResponse({});
    if (url.includes('/users/me/profile')) return jsonResponse({ emailAddress: 'me@example.com', historyId: '42' });
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;

  const auth = new GmailAuthService({
    tokenStore,
    repo,
    getClientId: () => 'client-id',
    openExternal: async () => {},
    fetchImpl,
    now: () => NOW,
  });
  return { auth, repo, tokenStore, calls };
}

async function connect(h: Harness): Promise<void> {
  await h.auth.exchangeAndStore({
    code: 'AUTH_CODE',
    codeVerifier: 'VERIFIER',
    redirectUri: 'http://127.0.0.1:5',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  });
}

describe('gmail connect flow (real DB + real token store, mocked Google)', () => {
  it('exchange persists the account + tokens and returns the address', async () => {
    const h = makeHarness();
    await connect(h);
    expect(h.repo.getAccount()?.emailAddress).toBe('me@example.com');
    expect(h.tokenStore.hasTokens()).toBe(true);
    expect(h.tokenStore.getTokens()?.refreshToken).toBe('refresh-1');
  });

  it('reconnect is idempotent — no duplicate account rows, id preserved, status reset', async () => {
    const h = makeHarness();
    await connect(h);
    const firstId = h.repo.getAccount()!.id;
    // Simulate a prior reconnect_needed state, then reconnect.
    h.repo.setSyncStatus(firstId, 'reconnect_needed', 'invalid_grant');
    await connect(h); // the Reconnect button re-runs the same exchange

    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM gmail_accounts')?.n).toBe(1);
    expect(h.repo.getAccount()!.id).toBe(firstId); // same row, not a new UUID
    expect(h.repo.getSyncState(firstId)?.status).toBe('idle'); // reconnect cleared the error

    // …and disconnect now fully clears (no orphan left behind).
    await h.auth.disconnect();
    expect(h.repo.getAccount()).toBeNull();
  });

  it('returns the stored access token while it is still valid (no refresh call)', async () => {
    const h = makeHarness();
    await connect(h);
    const token = await h.auth.getValidAccessToken();
    expect(token).toBe('access-1');
    expect(h.calls.some((c) => c.body.includes('grant_type=refresh_token'))).toBe(false);
  });

  it('refreshes when the access token is near expiry', async () => {
    const h = makeHarness({ refresh: 'ok' });
    await connect(h);
    // Force expiry by rewriting the stored bundle to an already-expired token.
    const t = h.tokenStore.getTokens()!;
    h.tokenStore.setTokens({ ...t, expiryMs: NOW - 1 });
    const token = await h.auth.getValidAccessToken();
    expect(token).toBe('access-2');
    expect(h.calls.some((c) => c.body.includes('grant_type=refresh_token'))).toBe(true);
  });

  it('invalid_grant on refresh → null + reconnect_needed, tokens cleared', async () => {
    const h = makeHarness({ refresh: 'invalid_grant' });
    await connect(h);
    const accountId = h.repo.getAccount()!.id;
    const t = h.tokenStore.getTokens()!;
    h.tokenStore.setTokens({ ...t, expiryMs: NOW - 1 });

    const token = await h.auth.getValidAccessToken();
    expect(token).toBeNull();
    expect(h.tokenStore.hasTokens()).toBe(false);
    expect(h.repo.getSyncState(accountId)?.status).toBe('reconnect_needed');
  });

  it('testConnection reports the address when connected', async () => {
    const h = makeHarness();
    await connect(h);
    const r = await h.auth.testConnection();
    expect(r.ok).toBe(true);
    expect(r.emailAddress).toBe('me@example.com');
  });

  it('disconnect performs a SERVER-SIDE revoke, then clears tokens + account', async () => {
    const h = makeHarness();
    await connect(h);
    await h.auth.disconnect();
    expect(h.calls.some((c) => c.url === GOOGLE_REVOKE_ENDPOINT)).toBe(true); // revoke actually called
    expect(h.tokenStore.hasTokens()).toBe(false);
    expect(h.repo.getAccount()).toBeNull();
    // The saved client secret is intentionally KEPT so Reconnect is one click.
    expect(h.tokenStore.hasClientSecret()).toBe(true);
  });
});
