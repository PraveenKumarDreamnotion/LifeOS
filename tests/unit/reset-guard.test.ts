import { describe, it, expect } from 'vitest';
import { assertSafeResetPath, UnsafeResetPathError } from '../../electron/services/reset-guard';

describe('assertSafeResetPath', () => {
  it('accepts a real LifeOS userData path', () => {
    expect(assertSafeResetPath('C:\\Users\\kullu\\AppData\\Roaming\\lifeos')).toContain('lifeos');
    expect(assertSafeResetPath('C:\\Users\\kullu\\AppData\\Roaming\\LifeOS')).toContain('LifeOS');
  });

  it('accepts the isolated dev profile (LifeOS-dev)', () => {
    expect(assertSafeResetPath('C:\\Users\\kullu\\AppData\\Roaming\\LifeOS-dev')).toContain('LifeOS-dev');
  });

  it('rejects a drive root', () => {
    expect(() => assertSafeResetPath('C:\\')).toThrow(UnsafeResetPathError);
  });

  it('rejects a shallow path even if named lifeos', () => {
    expect(() => assertSafeResetPath('C:\\lifeos')).toThrow(UnsafeResetPathError);
  });

  it('rejects a path that is not the LifeOS data dir', () => {
    expect(() => assertSafeResetPath('C:\\Users\\kullu\\AppData\\Roaming\\SomethingElse')).toThrow(
      UnsafeResetPathError,
    );
    expect(() => assertSafeResetPath('C:\\Windows\\System32')).toThrow(UnsafeResetPathError);
  });
});
