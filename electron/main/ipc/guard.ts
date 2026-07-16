/**
 * The IPC handler wrapper (16 §5): sender origin check, error sanitisation, Result<T>
 * envelope. Handlers never reject — errors are values, so the renderer cannot forget them.
 */
import type { IpcMainInvokeEvent, WebFrameMain } from 'electron';
import { z } from 'zod';
import type { Result, IpcError } from '../../../core/types/ipc';

export class ValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
  ) {
    super(code);
    this.name = 'ValidationError';
  }
}

export class SecurityError extends Error {}

let appOrigin = 'null';
export function setAppOrigin(origin: string): void {
  appOrigin = origin;
}

/**
 * The single origin check, shared by guard() (invoke channels) and the fire-and-forget
 * speech:audio send channel — one canonical implementation instead of the old inline copies
 * in speech.ts (30 D5).
 */
export function isSenderOurWindow(frame: WebFrameMain | null): boolean {
  if (!frame) return false;
  try {
    return new URL(frame.url).origin === appOrigin;
  } catch {
    return false;
  }
}

function assertSenderIsOurWindow(frame: WebFrameMain | null): void {
  if (!isSenderOurWindow(frame)) throw new SecurityError('bad_origin');
}

function toIpcError(e: unknown): IpcError {
  if (e instanceof ValidationError) return { code: e.code, message: e.userMessage };
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return { code: 'invalid_input', message: first?.message ?? 'That input was not valid.' };
  }
  if (e instanceof SecurityError) return { code: 'forbidden', message: 'Request refused.' };
  // Full detail stays in the local log; a stack trace must never cross IPC.
  console.error('[ipc] internal error:', e);
  return { code: 'internal_error', message: 'Something went wrong.' };
}

export async function guard<T>(
  event: IpcMainInvokeEvent,
  fn: () => T | Promise<T>,
): Promise<Result<T>> {
  try {
    assertSenderIsOurWindow(event.senderFrame);
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: toIpcError(e) };
  }
}
