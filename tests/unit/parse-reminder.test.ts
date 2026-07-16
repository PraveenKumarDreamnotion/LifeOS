import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import fixtures from '../fixtures/commands.json';
import { parseReminder } from '../../core/parsing/parse-reminder';

const ZONE = 'Asia/Kolkata';

interface Expect {
  ok: boolean;
  kind?: 'clarification' | 'refusal';
  intent?: string;
  title?: string;
  local?: string; // wall-clock "YYYY-MM-DDTHH:mm" in Asia/Kolkata
  recurrenceRule?: string | null;
  actionType?: string;
  ambiguity?: string;
  reason?: string;
  confidenceAtLeast?: number;
}

describe.each(fixtures as Array<{ input: string; refDate: string; expect: Expect }>)(
  '$input',
  ({ input, refDate, expect: want }) => {
    it('parses as expected', () => {
      const ref = new Date(refDate);
      const got = parseReminder(input, ref, ZONE);

      if (want.ok) {
        expect(got.ok, JSON.stringify(got)).toBe(true);
        if (!got.ok) return;
        const r = got.reminder;
        if (want.intent) expect(r.intent).toBe(want.intent);
        if (want.title) expect(r.title).toBe(want.title);
        if ('recurrenceRule' in want) expect(r.recurrenceRule).toBe(want.recurrenceRule);
        if (want.actionType) expect(r.actionType).toBe(want.actionType);
        if (want.local) {
          const local = DateTime.fromMillis(r.scheduledAtUtcMs, { zone: ZONE }).toFormat("yyyy-LL-dd'T'HH:mm");
          expect(local).toBe(want.local);
        }
        if (want.confidenceAtLeast !== undefined) {
          expect(r.confidence).toBeGreaterThanOrEqual(want.confidenceAtLeast);
        }
        // Invariant: a produced reminder is always in the future relative to refDate.
        expect(r.scheduledAtUtcMs).toBeGreaterThan(ref.getTime());
      } else {
        expect(got.ok, JSON.stringify(got)).toBe(false);
        if (got.ok) return;
        expect(got.kind).toBe(want.kind);
        if (want.kind === 'clarification' && got.kind === 'clarification') {
          expect(got.clarification.ambiguity.kind).toBe(want.ambiguity);
        }
        if (want.kind === 'refusal' && got.kind === 'refusal') {
          expect(got.refusal.reason).toBe(want.reason);
        }
      }
    });
  },
);
