/**
 * Pure safety guard for Reset Local Data (10 §10) — no Electron import, so it is unit-testable.
 * Refuses any path that is not the LifeOS data directory or is shallow enough to reach a
 * drive root.
 */
import { resolve, sep, basename } from 'node:path';

export class UnsafeResetPathError extends Error {
  constructor(path: string) {
    super(`Refusing to delete an unexpected path: ${path}`);
    this.name = 'UnsafeResetPathError';
  }
}

// Packaged builds use "LifeOS"; the dev harness uses "LifeOS-dev" (isolated profile). Windows is
// case-insensitive, so also accept the lowercase spellings. Any other basename is refused.
const ALLOWED_DIR_NAMES = new Set(['lifeos', 'LifeOS', 'lifeos-dev', 'LifeOS-dev']);

export function assertSafeResetPath(userDataPath: string): string {
  const p = resolve(userDataPath);
  if (!ALLOWED_DIR_NAMES.has(basename(p))) throw new UnsafeResetPathError(p);
  if (p.split(sep).filter(Boolean).length < 3) throw new UnsafeResetPathError(p);
  return p;
}
