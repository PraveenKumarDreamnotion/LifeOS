/**
 * Google OAuth 2.0 — Loopback + PKCE, the pure part (no `fetch`, no electron, no node builtins).
 *
 * This module builds URLs and request SHAPES and does the PKCE/state crypto via the Web Crypto
 * API (`globalThis.crypto`, present in Node ≥18 and every browser). The main-process glue
 * (`electron/gmail/gmail-auth.ts`) does the actual HTTP and runs the loopback server. Keeping the
 * shapes here makes the security-critical bits (S256 challenge, offline+consent flags, state
 * validation, revoke) unit-testable with zero Electron.
 *
 * Why Loopback + PKCE (see docs/lifeos-planning/gmail-integration.md §2.1):
 *  - Google removed OOB; Loopback IP is the supported flow for *Desktop app* OAuth clients.
 *  - `access_type=offline` + `prompt=consent` are BOTH required or Reconnect yields no
 *    refresh_token and auto-refresh silently breaks.
 */

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

// ── base64url + Web Crypto helpers ────────────────────────────────────────────

function base64UrlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa exists in Node ≥16 globals and browsers.
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** A high-entropy PKCE code_verifier (43–128 chars, unreserved charset via base64url). */
export function generateCodeVerifier(): string {
  return base64UrlFromBytes(randomBytes(32)); // 32 bytes → 43 base64url chars
}

/** S256 challenge = base64url(SHA-256(verifier)). Async because subtle.digest is async. */
export async function computeCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return base64UrlFromBytes(new Uint8Array(digest));
}

/** An unguessable CSRF/state nonce, verified on the redirect. */
export function generateState(): string {
  return base64UrlFromBytes(randomBytes(16));
}

// ── URL + request-shape builders ──────────────────────────────────────────────

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string; // http://127.0.0.1:<port>
  scopes: readonly string[];
  codeChallenge: string;
  state: string;
  /** Optional login hint to pre-select an account on reconnect. */
  loginHint?: string;
}

/** Build the consent URL opened in the system browser. Always offline + consent (see header). */
export function buildAuthUrl(p: AuthUrlParams): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: p.scopes.join(' '),
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline', // ⇒ issue a refresh_token
    prompt: 'consent', // ⇒ re-issue a refresh_token on every (re)connect
    // NB: no `include_granted_scopes` — we want the minted token to carry ONLY the scopes we ask
    // for (readonly), not accumulate a previously-granted `gmail.metadata` that would poison
    // format=full with a 403. (Later phases add write scopes via a deliberate re-consent.)
    state: p.state,
  });
  if (p.loginHint) q.set('login_hint', p.loginHint);
  return `${GOOGLE_AUTH_ENDPOINT}?${q.toString()}`;
}

export interface TokenRequest {
  url: string;
  /** application/x-www-form-urlencoded body as a flat map. */
  body: Record<string, string>;
}

/** Exchange an authorization code for tokens (PKCE: send the verifier, not a challenge). */
export function buildTokenExchangeRequest(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): TokenRequest {
  return {
    url: GOOGLE_TOKEN_ENDPOINT,
    body: {
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      code_verifier: args.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: args.redirectUri,
    },
  };
}

/** Refresh an access token using the stored refresh_token. */
export function buildRefreshRequest(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): TokenRequest {
  return {
    url: GOOGLE_TOKEN_ENDPOINT,
    body: {
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
      grant_type: 'refresh_token',
    },
  };
}

/** Server-side revoke — used by Disconnect so the grant is actually torn down on Google's side. */
export function buildRevokeRequest(token: string): { url: string; body: Record<string, string> } {
  return { url: GOOGLE_REVOKE_ENDPOINT, body: { token } };
}

// ── redirect parsing / validation ─────────────────────────────────────────────

export type RedirectResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/**
 * Parse the loopback redirect query. Verifies `state` matches the one we generated (CSRF), and
 * surfaces Google's `error` param (e.g. `access_denied`) as a failure rather than a thrown error.
 */
export function parseRedirect(query: URLSearchParams, expectedState: string): RedirectResult {
  const err = query.get('error');
  if (err) return { ok: false, error: err };
  const state = query.get('state');
  if (!state || state !== expectedState) return { ok: false, error: 'state_mismatch' };
  const code = query.get('code');
  if (!code) return { ok: false, error: 'no_code' };
  return { ok: true, code };
}

// ── token-response coercion ───────────────────────────────────────────────────

export interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number; // seconds
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/** Absolute expiry (epoch ms) from a token response's `expires_in`, with a safety skew. */
export function expiryFromResponse(expiresInSeconds: number | undefined, nowMs: number, skewMs = 60_000): number {
  const secs = typeof expiresInSeconds === 'number' && expiresInSeconds > 0 ? expiresInSeconds : 3600;
  return nowMs + secs * 1000 - skewMs;
}
