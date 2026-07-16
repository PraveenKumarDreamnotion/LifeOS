import { describe, it, expect } from 'vitest';
import {
  generateCodeVerifier,
  computeCodeChallenge,
  generateState,
  buildAuthUrl,
  buildTokenExchangeRequest,
  buildRefreshRequest,
  buildRevokeRequest,
  parseRedirect,
  expiryFromResponse,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_REVOKE_ENDPOINT,
} from '../../core/gmail/oauth';
import { PHASE1_SCOPES } from '../../core/gmail/types';

describe('gmail oauth (pure)', () => {
  it('PKCE code_verifier is base64url and long enough', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no +/=
    expect(v.length).toBeGreaterThanOrEqual(43);
  });

  it('computeCodeChallenge matches the RFC 7636 S256 test vector', async () => {
    // From RFC 7636 Appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await computeCodeChallenge(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generateState returns unguessable, unique nonces', () => {
    const a = generateState();
    const b = generateState();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
  });

  it('auth URL carries the load-bearing flags (offline + consent + S256 + scopes)', () => {
    const url = new URL(
      buildAuthUrl({
        clientId: 'cid.apps.googleusercontent.com',
        redirectUri: 'http://127.0.0.1:51234',
        scopes: PHASE1_SCOPES,
        codeChallenge: 'CHALLENGE',
        state: 'STATE',
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_ENDPOINT);
    const q = url.searchParams;
    expect(q.get('access_type')).toBe('offline'); // ⇒ refresh_token issued
    expect(q.get('prompt')).toBe('consent'); // ⇒ refresh_token re-issued on reconnect
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toBe('CHALLENGE');
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe('cid.apps.googleusercontent.com');
    expect(q.get('redirect_uri')).toBe('http://127.0.0.1:51234');
    expect(q.get('state')).toBe('STATE');
    expect(q.get('scope')).toContain('gmail.readonly');
    // metadata scope is deliberately NOT requested — it restricts messages.get to format=metadata
    // and 403s format=full even alongside readonly (it "poisons" the token).
    expect(q.get('scope')).not.toContain('gmail.metadata');
    // Phase 1 must NOT request write scopes.
    expect(q.get('scope')).not.toContain('gmail.send');
    expect(q.get('scope')).not.toContain('gmail.modify');
    // No scope carry-forward, so a clean readonly-only grant is possible.
    expect(q.has('include_granted_scopes')).toBe(false);
  });

  it('includes login_hint only when provided', () => {
    const withHint = new URL(
      buildAuthUrl({ clientId: 'c', redirectUri: 'r', scopes: PHASE1_SCOPES, codeChallenge: 'x', state: 's', loginHint: 'me@x.com' }),
    );
    expect(withHint.searchParams.get('login_hint')).toBe('me@x.com');
    const without = new URL(buildAuthUrl({ clientId: 'c', redirectUri: 'r', scopes: PHASE1_SCOPES, codeChallenge: 'x', state: 's' }));
    expect(without.searchParams.has('login_hint')).toBe(false);
  });

  it('token exchange request has the PKCE verifier and auth_code grant', () => {
    const req = buildTokenExchangeRequest({
      clientId: 'cid',
      clientSecret: 'secret',
      code: 'AUTH_CODE',
      codeVerifier: 'VERIFIER',
      redirectUri: 'http://127.0.0.1:5',
    });
    expect(req.url).toBe(GOOGLE_TOKEN_ENDPOINT);
    expect(req.body.grant_type).toBe('authorization_code');
    expect(req.body.code).toBe('AUTH_CODE');
    expect(req.body.code_verifier).toBe('VERIFIER');
    expect(req.body.client_id).toBe('cid');
    expect(req.body.client_secret).toBe('secret');
    expect(req.body.redirect_uri).toBe('http://127.0.0.1:5');
  });

  it('refresh request uses the refresh_token grant', () => {
    const req = buildRefreshRequest({ clientId: 'cid', clientSecret: 'secret', refreshToken: 'RT' });
    expect(req.url).toBe(GOOGLE_TOKEN_ENDPOINT);
    expect(req.body.grant_type).toBe('refresh_token');
    expect(req.body.refresh_token).toBe('RT');
  });

  it('revoke request targets the revoke endpoint with the token', () => {
    const req = buildRevokeRequest('THE_TOKEN');
    expect(req.url).toBe(GOOGLE_REVOKE_ENDPOINT);
    expect(req.body.token).toBe('THE_TOKEN');
  });

  it('parseRedirect enforces state (CSRF) and surfaces Google errors', () => {
    const ok = parseRedirect(new URLSearchParams('code=abc&state=S'), 'S');
    expect(ok).toEqual({ ok: true, code: 'abc' });

    expect(parseRedirect(new URLSearchParams('code=abc&state=WRONG'), 'S')).toEqual({ ok: false, error: 'state_mismatch' });
    expect(parseRedirect(new URLSearchParams('error=access_denied&state=S'), 'S')).toEqual({ ok: false, error: 'access_denied' });
    expect(parseRedirect(new URLSearchParams('state=S'), 'S')).toEqual({ ok: false, error: 'no_code' });
  });

  it('expiryFromResponse subtracts a safety skew', () => {
    expect(expiryFromResponse(3600, 1_000_000, 60_000)).toBe(1_000_000 + 3_600_000 - 60_000);
    // Missing/invalid expires_in falls back to 3600s.
    expect(expiryFromResponse(undefined, 0, 0)).toBe(3_600_000);
  });
});
