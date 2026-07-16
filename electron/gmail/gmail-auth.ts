/**
 * GmailAuthService — the main-process OAuth glue (docs §2.1–§2.3, §2.8). Runs the loopback flow
 * and does all HTTP to Google. Node's global `fetch` from main is NOT gated by the session
 * allowlist (same as OpenAiLlmProvider), so privacy is enforced by only calling here when the user
 * has connected/asked — never speculatively.
 *
 * Testability: the security-critical network logic (exchange, refresh, revoke, profile) is split
 * out from the interactive `connect()` (which needs a real browser + loopback socket). Inject
 * `fetchImpl`, `openExternal`, and `now` to unit/integration test without Electron or a network.
 *
 * Invariants: tokens + client secret live only in GmailTokenStore (encrypted); nothing secret is
 * logged or returned to the renderer. Disconnect performs a SERVER-SIDE revoke, not a local delete.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  buildAuthUrl,
  buildTokenExchangeRequest,
  buildRefreshRequest,
  buildRevokeRequest,
  computeCodeChallenge,
  generateCodeVerifier,
  generateState,
  parseRedirect,
  expiryFromResponse,
  type RawTokenResponse,
  type TokenRequest,
} from '../../core/gmail/oauth';
import { PHASE1_SCOPES, type GmailAccount, type GmailTokens } from '../../core/gmail/types';
import type { GmailTokenStore } from '../services/gmail-token-store';
import type { GmailRepository } from '../database/gmail-repository';

const GMAIL_PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
const CONNECT_TIMEOUT_MS = 5 * 60_000;
/** Refresh proactively when the token is within this window of expiry. */
const REFRESH_MARGIN_MS = 2 * 60_000;

export class GmailAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GmailAuthError';
  }
}

export interface GmailAuthDeps {
  tokenStore: GmailTokenStore;
  repo: GmailRepository;
  /** The non-secret Client ID from settings. */
  getClientId: () => string;
  /** Open the consent URL in the user's real browser (injected for tests). */
  openExternal: (url: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export interface ConnectResult {
  emailAddress: string;
}

export interface TestResult {
  ok: boolean;
  emailAddress?: string;
  reason?: string;
}

export class GmailAuthService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly deps: GmailAuthDeps) {
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    this.now = deps.now ?? Date.now;
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.deps.log?.(level, message);
  }

  // ── interactive connect (browser + loopback) ───────────────────────────────
  async connect(): Promise<ConnectResult> {
    const clientId = this.deps.getClientId().trim();
    const clientSecret = this.deps.tokenStore.getClientSecret();
    if (!clientId || !clientSecret) {
      throw new GmailAuthError('missing_credentials', 'Add your Client ID and Client Secret first.');
    }

    const verifier = generateCodeVerifier();
    const challenge = await computeCodeChallenge(verifier);
    const state = generateState();

    const { server, port, waitForCode } = await this.startLoopbackServer(state);
    const redirectUri = `http://127.0.0.1:${port}`;
    try {
      const existing = this.deps.repo.getAccount();
      const authUrl = buildAuthUrl({
        clientId,
        redirectUri,
        scopes: PHASE1_SCOPES,
        codeChallenge: challenge,
        state,
        loginHint: existing?.emailAddress,
      });
      await this.deps.openExternal(authUrl);
      const code = await waitForCode;
      return await this.exchangeAndStore({ code, codeVerifier: verifier, redirectUri, clientId, clientSecret });
    } finally {
      server.close();
    }
  }

  private startLoopbackServer(
    expectedState: string,
  ): Promise<{ server: Server; port: number; waitForCode: Promise<string> }> {
    return new Promise((resolveOuter, rejectOuter) => {
      let settle: ((code: string) => void) | null = null;
      let fail: ((e: Error) => void) | null = null;
      const waitForCode = new Promise<string>((res, rej) => {
        settle = res;
        fail = rej;
      });

      const timer = setTimeout(() => {
        fail?.(new GmailAuthError('timeout', 'Sign-in timed out. Please try again.'));
      }, CONNECT_TIMEOUT_MS);

      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        try {
          const url = new URL(req.url ?? '/', `http://127.0.0.1`);
          if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
            res.writeHead(404).end();
            return;
          }
          const parsed = parseRedirect(url.searchParams, expectedState);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(RESPONSE_PAGE(parsed.ok));
          clearTimeout(timer);
          if (parsed.ok) settle?.(parsed.code);
          else fail?.(new GmailAuthError(parsed.error, this.describeAuthError(parsed.error)));
        } catch (e) {
          res.writeHead(500).end();
          clearTimeout(timer);
          fail?.(e as Error);
        }
      });

      server.on('error', (e) => {
        clearTimeout(timer);
        rejectOuter(e);
      });

      // Bind to loopback with an OS-assigned free port.
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        if (!port) {
          rejectOuter(new GmailAuthError('no_port', 'Could not open a local sign-in port.'));
          return;
        }
        resolveOuter({ server, port, waitForCode });
      });
    });
  }

  private describeAuthError(code: string): string {
    switch (code) {
      case 'access_denied':
        return 'You declined access. Nothing was connected.';
      case 'state_mismatch':
        return 'Sign-in could not be verified (state mismatch). Please try again.';
      default:
        return 'Google sign-in failed. Please try again.';
    }
  }

  // ── network logic (testable) ────────────────────────────────────────────────
  async exchangeAndStore(args: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<ConnectResult> {
    const req = buildTokenExchangeRequest(args);
    const resp = await this.postToken(req);
    if (!resp.access_token) {
      throw new GmailAuthError('token_exchange_failed', 'Could not complete sign-in with Google.');
    }
    if (!resp.refresh_token) {
      // offline+consent should always return one; warn but don't hard-fail this session.
      this.log('warn', 'gmail: token exchange returned no refresh_token');
    }
    const tokens: GmailTokens = {
      refreshToken: resp.refresh_token ?? '',
      accessToken: resp.access_token,
      expiryMs: expiryFromResponse(resp.expires_in, this.now()),
      scope: resp.scope ?? PHASE1_SCOPES.join(' '),
      tokenType: resp.token_type ?? 'Bearer',
    };
    const profile = await this.getProfile(tokens.accessToken);
    // Reconnect must be IDEMPOTENT: reuse the existing account's id so saveAccount's upsert
    // updates the same row instead of inserting a duplicate (which would orphan on disconnect).
    // If the user connected a DIFFERENT address, drop the old account's data first.
    const existing = this.deps.repo.getAccount();
    if (existing && existing.emailAddress !== profile.emailAddress) {
      this.deps.repo.deleteAccount(existing.id);
    }
    const reuse = existing && existing.emailAddress === profile.emailAddress ? existing : null;
    const account: GmailAccount = {
      id: reuse?.id ?? randomUUID(),
      emailAddress: profile.emailAddress,
      scope: tokens.scope,
      connectedAt: reuse?.connectedAt ?? this.now(),
      updatedAt: this.now(),
    };
    this.deps.repo.saveAccount(account);
    this.deps.tokenStore.setTokens(tokens);
    // A successful (re)connect clears any prior reconnect_needed/error state.
    this.deps.repo.setSyncStatus(account.id, 'idle', null);
    this.log('info', 'gmail: connected');
    return { emailAddress: profile.emailAddress };
  }

  /** Return a currently-valid access token, refreshing if needed. null ⇒ not connected or the
   *  grant was revoked (caller shows "reconnect needed"). */
  async getValidAccessToken(): Promise<string | null> {
    const tokens = this.deps.tokenStore.getTokens();
    if (!tokens) return null;
    if (tokens.accessToken && tokens.expiryMs > this.now() + REFRESH_MARGIN_MS) {
      return tokens.accessToken;
    }
    if (!tokens.refreshToken) return null;

    const clientId = this.deps.getClientId().trim();
    const clientSecret = this.deps.tokenStore.getClientSecret();
    if (!clientId || !clientSecret) return null;

    let resp: RawTokenResponse;
    try {
      resp = await this.postToken(buildRefreshRequest({ clientId, clientSecret, refreshToken: tokens.refreshToken }));
    } catch (e) {
      this.log('warn', `gmail: refresh failed (${(e as Error).message})`);
      return null;
    }
    if (resp.error === 'invalid_grant' || !resp.access_token) {
      // The user revoked access / changed password / grant expired → require reconnect.
      this.onGrantRevoked();
      return null;
    }
    const updated: GmailTokens = {
      refreshToken: resp.refresh_token ?? tokens.refreshToken,
      accessToken: resp.access_token,
      expiryMs: expiryFromResponse(resp.expires_in, this.now()),
      scope: resp.scope ?? tokens.scope,
      tokenType: resp.token_type ?? tokens.tokenType,
    };
    this.deps.tokenStore.setTokens(updated);
    return updated.accessToken;
  }

  private onGrantRevoked(): void {
    this.deps.tokenStore.clearTokens();
    const account = this.deps.repo.getAccount();
    if (account) this.deps.repo.setSyncStatus(account.id, 'reconnect_needed', 'invalid_grant');
    this.log('warn', 'gmail: grant revoked — reconnect needed');
  }

  /** Test Connection: refresh if needed, then hit the profile endpoint. */
  async testConnection(): Promise<TestResult> {
    const token = await this.getValidAccessToken();
    if (!token) return { ok: false, reason: 'not_connected' };
    try {
      const profile = await this.getProfile(token);
      return { ok: true, emailAddress: profile.emailAddress };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  /** Disconnect: SERVER-SIDE revoke (best-effort), then clear local tokens + account row. Keeps the
   *  saved Client ID/Secret so reconnect is one click. */
  async disconnect(): Promise<{ ok: true }> {
    const tokens = this.deps.tokenStore.getTokens();
    if (tokens?.refreshToken || tokens?.accessToken) {
      const toRevoke = tokens.refreshToken || tokens.accessToken;
      try {
        const { url, body } = buildRevokeRequest(toRevoke);
        await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(body).toString(),
        });
      } catch (e) {
        // A failed revoke must not block local disconnect; log and continue.
        this.log('warn', `gmail: revoke failed (${(e as Error).message})`);
      }
    }
    this.deps.tokenStore.clearTokens();
    const account = this.deps.repo.getAccount();
    if (account) this.deps.repo.deleteAccount(account.id);
    this.log('info', 'gmail: disconnected');
    return { ok: true };
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────
  private async postToken(req: TokenRequest): Promise<RawTokenResponse> {
    const res = await this.fetchImpl(req.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(req.body).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as RawTokenResponse;
    if (!res.ok && !data.error) {
      throw new GmailAuthError('token_http_error', `Google returned ${res.status}.`);
    }
    return data;
  }

  private async getProfile(accessToken: string): Promise<{ emailAddress: string; historyId: string | null }> {
    const res = await this.fetchImpl(GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new GmailAuthError('profile_http_error', `Gmail returned ${res.status}.`);
    const data = (await res.json()) as { emailAddress?: string; historyId?: string };
    if (!data.emailAddress) throw new GmailAuthError('profile_empty', 'Gmail did not return an address.');
    return { emailAddress: data.emailAddress, historyId: data.historyId ?? null };
  }
}

function RESPONSE_PAGE(ok: boolean): string {
  const title = ok ? 'Connected to LifeOS' : 'Sign-in was not completed';
  const body = ok
    ? 'You can close this tab and return to LifeOS.'
    : 'Something went wrong. Return to LifeOS and try again.';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#faf7f2;color:#2b2b2b;
display:grid;place-items:center;height:100vh;margin:0}.card{max-width:420px;text-align:center;padding:2rem}
h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#666;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}
