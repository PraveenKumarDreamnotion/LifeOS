/**
 * validateOpenAiKey — the single user-initiated outbound call in EP-1 (42, Security §). It runs
 * ONLY when the user clicks "Validate" after entering a key: a discrete, explicit probe, never
 * background traffic (this is how the "zero packets with cloud off" invariant is preserved — the
 * default state makes no call). Runs in the main process; the plaintext key never leaves main.
 * Returns a plain result and never throws across IPC.
 */
export interface KeyValidation {
  valid: boolean;
  reason?: 'invalid' | 'unreachable';
}

const VALIDATE_TIMEOUT_MS = 8_000;

export async function validateOpenAiKey(key: string): Promise<KeyValidation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (res.ok) return { valid: true };
    if (res.status === 401 || res.status === 403) return { valid: false, reason: 'invalid' };
    return { valid: false, reason: 'unreachable' };
  } catch {
    return { valid: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
