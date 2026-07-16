/**
 * Local logging → app_logs, level-gated and redacted (11 §12). No telemetry, no crash
 * reporter — logs never leave the device except when a user deliberately attaches one.
 */
import type { SqliteDriver } from '../database/driver';

type Level = 'debug' | 'info' | 'warn' | 'error';

const REDACTIONS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{20,}/g, 'sk-***REDACTED***'],
  [/Bearer\s+\S+/gi, 'Bearer ***REDACTED***'],
];

function redact(s: string): string {
  return REDACTIONS.reduce((acc, [re, sub]) => acc.replace(re, sub), s);
}

export class Logger {
  private readonly minLevel: Level;

  constructor(
    private readonly db: SqliteDriver | null,
    packaged: boolean,
  ) {
    // debug rows are never written in a packaged build.
    this.minLevel = packaged ? 'info' : 'debug';
  }

  private static readonly order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

  private write(level: Level, module: string, message: string, context?: unknown): void {
    if (Logger.order[level] < Logger.order[this.minLevel]) return;

    const msg = redact(message);
    // Mirror to the process console for dev visibility.
    const line = `[${level}] ${module}: ${msg}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);

    try {
      this.db?.run(
        'INSERT INTO app_logs (level, module, message, context, created_at) VALUES (?,?,?,?,?)',
        [level, module, msg, context ? redact(JSON.stringify(context)) : null, Date.now()],
      );
    } catch {
      // Logging must never throw into the caller.
    }
  }

  debug(module: string, message: string, context?: unknown): void {
    this.write('debug', module, message, context);
  }
  info(module: string, message: string, context?: unknown): void {
    this.write('info', module, message, context);
  }
  warn(module: string, message: string, context?: unknown): void {
    this.write('warn', module, message, context);
  }
  error(module: string, message: string, context?: unknown): void {
    this.write('error', module, message, context);
  }
}
