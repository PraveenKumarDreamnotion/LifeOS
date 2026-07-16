import { describe, it, expect, vi } from 'vitest';

// session.ts imports electron for installSessionSecurity/installNavigationLocks; those are not
// exercised here. Stub the module so the pure buildCsp/isAllowedOrigin can be imported under
// vitest-node (D1 session-rebind test, 42).
vi.mock('electron', () => ({ app: {}, session: {}, shell: {} }));

const { buildCsp, isAllowedOrigin } = await import('../../electron/main/session');

describe('D1: session security predicate flips with the setting', () => {
  it('packaged CSP excludes OpenAI when cloud is OFF', () => {
    const csp = buildCsp({ packaged: true, aiAssistEnabled: false });
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('api.openai.com');
    // The packaged policy must never carry dev-only relaxations.
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('ws:');
    // EP-4: the audio:playBytes blob: URL must be allowed for <audio> (media-src).
    expect(csp).toContain("media-src 'self' blob:");
  });

  it('packaged CSP includes OpenAI when cloud is ON', () => {
    const csp = buildCsp({ packaged: true, aiAssistEnabled: true });
    expect(csp).toContain('https://api.openai.com');
  });

  it('outbound allowlist blocks OpenAI when cloud is OFF (the fail-safe default)', () => {
    expect(isAllowedOrigin(new URL('https://api.openai.com/v1/models'), false)).toBe(false);
  });

  it('outbound allowlist allows OpenAI ONLY when cloud is ON', () => {
    expect(isAllowedOrigin(new URL('https://api.openai.com/v1/models'), true)).toBe(true);
  });

  it('outbound allowlist never allows an arbitrary origin', () => {
    expect(isAllowedOrigin(new URL('https://evil.example.com/steal'), true)).toBe(false);
    expect(isAllowedOrigin(new URL('https://evil.example.com/steal'), false)).toBe(false);
  });
});
