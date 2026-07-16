import { describe, it, expect, vi } from 'vitest';
import { GmailProvider, GmailApiError } from '../../electron/gmail/gmail-provider';

/** Response builder for a fake fetch. */
function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function rateLimit403() {
  return res(403, { error: { code: 403, message: 'Rate Limit Exceeded', status: 'RESOURCE_EXHAUSTED', errors: [{ reason: 'rateLimitExceeded' }] } });
}
function permission403() {
  return res(403, { error: { code: 403, message: 'Metadata scope does not permit format FULL', status: 'PERMISSION_DENIED', errors: [{ reason: 'accessNotConfigured' }] } });
}
const OK_PROFILE = res(200, { emailAddress: 'me@x.com', historyId: '1' });

function providerWith(responses: Response[]) {
  const fetchImpl = vi.fn(async () => responses.shift() ?? OK_PROFILE) as unknown as typeof fetch;
  const sleep = vi.fn(async () => {}); // no real delay
  return { provider: new GmailProvider({ fetchImpl, sleep }), fetchImpl, sleep };
}

describe('GmailProvider retry policy (Phase 5)', () => {
  it('retries a 403 RATE LIMIT then succeeds', async () => {
    const { provider, fetchImpl } = providerWith([rateLimit403(), rateLimit403(), OK_PROFILE]);
    const r = await provider.getProfile('tok');
    expect(r.emailAddress).toBe('me@x.com');
    expect(fetchImpl).toHaveBeenCalledTimes(3); // two 403s retried, third OK
  });

  it('does NOT retry a 403 PERMISSION error — throws immediately with the reason', async () => {
    const { provider, fetchImpl } = providerWith([permission403()]);
    await expect(provider.getProfile('tok')).rejects.toThrow(GmailApiError);
    await expect(providerWith([permission403()]).provider.getProfile('tok')).rejects.toThrow(/format FULL/);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry
  });

  it('retries a 429 then succeeds', async () => {
    const { provider, fetchImpl } = providerWith([res(429, {}), OK_PROFILE]);
    await provider.getProfile('tok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a 500 then succeeds', async () => {
    const { provider, fetchImpl } = providerWith([res(503, {}), OK_PROFILE]);
    await provider.getProfile('tok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry cap and throws', async () => {
    // 6 rate-limit responses > MAX_RETRIES(4) → throws.
    const { provider } = providerWith([rateLimit403(), rateLimit403(), rateLimit403(), rateLimit403(), rateLimit403(), rateLimit403()]);
    await expect(provider.getProfile('tok')).rejects.toThrow(GmailApiError);
  });
});
