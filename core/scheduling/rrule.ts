/**
 * RRULE build/parse. We store the RRULE string for interop and forward-compat, but compute
 * next-run with Luxon (02 A4) — the `rrule` npm package is stale and has a tzid bug.
 *
 * Supported grammar (a strict superset of the original DAILY/WEEKLY MVP shapes):
 *   FREQ=DAILY   [;INTERVAL=n]                          ;BYHOUR=h;BYMINUTE=m [;COUNT=c | ;UNTIL=…]
 *   FREQ=WEEKLY  [;INTERVAL=n] ;BYDAY=MO[,WE,FR]        ;BYHOUR=h;BYMINUTE=m [;COUNT=c | ;UNTIL=…]
 *   FREQ=MONTHLY [;INTERVAL=n]                          ;BYHOUR=h;BYMINUTE=m [;COUNT=c | ;UNTIL=…]
 *   FREQ=YEARLY  [;INTERVAL=n]                          ;BYHOUR=h;BYMINUTE=m [;COUNT=c | ;UNTIL=…]
 *
 * The day-of-month (MONTHLY) and month+day (YEARLY) are NOT encoded in the rule — they are
 * implied by the reminder's anchor (scheduledAt), which is how the occurrence engine steps.
 * This keeps the rule small and the "31st clamps to Feb 28 but returns to 31 in March" edge
 * case correct (see next-occurrence.ts). UNTIL is an inclusive UTC instant. COUNT and UNTIL
 * are mutually exclusive (RFC 5545). Dependency-free (no Luxon) so the preload-safe
 * `core/types/ipc.ts` can validate a rule by calling `parseRule` in a Zod refine.
 */

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface ParsedRule {
  freq: Freq;
  /** Every `interval` days/weeks/months/years. >= 1. Always present after parse. */
  interval: number;
  /** ISO weekday(s) 1=Mon..7=Sun (Luxon convention), sorted ascending. WEEKLY only. */
  weekdays?: number[];
  hour: number;
  minute: number;
  /** Stop after this many occurrences (counting the first). Mutually exclusive with `until`. */
  count?: number;
  /** Inclusive end instant (UTC epoch ms). Mutually exclusive with `count`. */
  until?: number;
}

// RRULE BYDAY token → ISO weekday, and back.
const BYDAY_TO_ISO: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
const ISO_TO_BYDAY = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const FREQS = new Set<Freq>(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const ALLOWED_KEYS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYHOUR', 'BYMINUTE', 'COUNT', 'UNTIL']);

export class UnsupportedRecurrenceError extends Error {
  constructor(rule: string) {
    super(`Unsupported recurrence rule: ${rule}`);
    this.name = 'UnsupportedRecurrenceError';
  }
}

/** `YYYYMMDDTHHMMSSZ` from an epoch-ms instant (UTC). */
function formatUntil(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

function parseUntil(raw: string, rule: string): number {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) throw new UnsupportedRecurrenceError(rule);
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  if (Number.isNaN(ms)) throw new UnsupportedRecurrenceError(rule);
  return ms;
}

function intInRange(raw: string | undefined, min: number, max: number, rule: string): number {
  if (raw === undefined || !/^\d+$/.test(raw)) throw new UnsupportedRecurrenceError(rule);
  const n = Number(raw);
  if (n < min || n > max) throw new UnsupportedRecurrenceError(rule);
  return n;
}

export function buildRule(r: ParsedRule): string {
  const interval = r.interval ?? 1;
  const parts = [`FREQ=${r.freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (r.freq === 'WEEKLY') {
    const wds = r.weekdays;
    if (!wds || wds.length === 0) throw new Error('WEEKLY rule requires at least one weekday');
    const sorted = [...new Set(wds)].sort((a, b) => a - b);
    parts.push(`BYDAY=${sorted.map((w) => ISO_TO_BYDAY[w]).join(',')}`);
  }
  parts.push(`BYHOUR=${r.hour}`, `BYMINUTE=${r.minute}`);
  if (r.count !== undefined && r.until !== undefined) {
    throw new Error('COUNT and UNTIL are mutually exclusive');
  }
  if (r.count !== undefined) parts.push(`COUNT=${r.count}`);
  if (r.until !== undefined) parts.push(`UNTIL=${formatUntil(r.until)}`);
  return parts.join(';');
}

export function parseRule(rule: string): ParsedRule {
  const map: Record<string, string> = {};
  for (const seg of rule.split(';')) {
    const eq = seg.indexOf('=');
    if (eq <= 0) throw new UnsupportedRecurrenceError(rule);
    const key = seg.slice(0, eq);
    if (!ALLOWED_KEYS.has(key) || key in map) throw new UnsupportedRecurrenceError(rule);
    map[key] = seg.slice(eq + 1);
  }

  const freq = map.FREQ as Freq;
  if (!FREQS.has(freq)) throw new UnsupportedRecurrenceError(rule);

  const hour = intInRange(map.BYHOUR, 0, 23, rule);
  const minute = intInRange(map.BYMINUTE, 0, 59, rule);
  const interval = map.INTERVAL !== undefined ? intInRange(map.INTERVAL, 1, 1000, rule) : 1;

  const out: ParsedRule = { freq, interval, hour, minute };

  if (freq === 'WEEKLY') {
    if (map.BYDAY === undefined) throw new UnsupportedRecurrenceError(rule);
    const weekdays = map.BYDAY.split(',').map((tok) => {
      const iso = BYDAY_TO_ISO[tok];
      if (iso === undefined) throw new UnsupportedRecurrenceError(rule);
      return iso;
    });
    out.weekdays = [...new Set(weekdays)].sort((a, b) => a - b);
  } else if (map.BYDAY !== undefined) {
    // BYDAY is only meaningful for WEEKLY in this grammar.
    throw new UnsupportedRecurrenceError(rule);
  }

  if (map.COUNT !== undefined && map.UNTIL !== undefined) throw new UnsupportedRecurrenceError(rule);
  if (map.COUNT !== undefined) out.count = intInRange(map.COUNT, 1, 100000, rule);
  if (map.UNTIL !== undefined) out.until = parseUntil(map.UNTIL, rule);

  return out;
}

/** True if the string is a recurrence rule this app can compute. Cheap boundary check. */
export function isSupportedRule(rule: string): boolean {
  try {
    parseRule(rule);
    return true;
  } catch {
    return false;
  }
}
