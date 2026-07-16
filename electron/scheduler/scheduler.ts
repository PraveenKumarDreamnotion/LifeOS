/**
 * The wall-clock-authoritative scheduler (08 §10, 13 §3.2). The persisted next_fire_at is
 * the source of truth; timers are only an optimisation. The clock is an INJECTED dependency
 * so the DST and 24.8-day-trap cases are unit-testable — never call Date.now() directly here.
 *
 * NEVER setTimeout to a reminder's due time: delays above 2^31-1 ms (~24.8 days) fire
 * IMMEDIATELY. A periodic reconcile querying "what's due" sidesteps that and system sleep.
 */
import { nextFireAfterFromString } from '../../core/scheduling/next-occurrence';
import type { Reminder } from '../../core/types/reminder';

export type ReconcileCause = 'startup' | 'tick' | 'resume' | 'unlock' | 'mutation';

export interface TriggerSink {
  fire(reminder: Reminder): void;
}

export interface SchedulerRepo {
  findDue(nowMs: number): Reminder[];
  /** `firedAtMs` is passed only when the reminder fired this cycle (30 D3). */
  setNextFireAt(id: string, nextMs: number, firedAtMs?: number): void;
  markTriggered(id: string, atMs: number): void;
  markMissed(id: string, atMs: number): void;
  /** A recurring reminder whose COUNT/UNTIL is exhausted has no next fire → it's done. */
  markCompleted(id: string): void;
}

export interface SchedulerDeps {
  now: () => number;
  repo: SchedulerRepo;
  sink: TriggerSink;
  tickMs?: number;
  isPaused?: () => boolean;
  onOverdue?: (missed: Reminder[]) => void;
  onError?: (e: unknown) => void;
}

export interface Scheduler {
  reconcile(cause: ReconcileCause): { fired: number; missed: number };
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const tickMs = deps.tickMs ?? 30_000;

  function reconcile(cause: ReconcileCause): { fired: number; missed: number } {
    if (deps.isPaused?.()) return { fired: 0, missed: 0 };

    const now = deps.now();
    let due: Reminder[];
    try {
      due = deps.repo.findDue(now);
    } catch (e) {
      deps.onError?.(e);
      return { fired: 0, missed: 0 };
    }

    let fired = 0;
    const overdue: Reminder[] = [];

    for (const r of due) {
      try {
        const lateBy = now - r.nextFireAt;
        // "Missed while the app was CLOSED" is detectable only at startup, and only when
        // the reminder is late by more than a couple of ticks (08 §11).
        const missedWhileClosed = cause === 'startup' && lateBy > tickMs * 2;

        if (r.recurrenceRule) {
          // Recurring: fire only if not missed-while-closed; ALWAYS roll forward past now.
          // Firing four missed "Exercise" alarms at once is hostile. Roll-forward is anchored on
          // scheduledAt (occurrence #1) so a bounded rule's COUNT lines up; `null` = the recurrence
          // has ended (COUNT exhausted / past UNTIL) → this was the final occurrence.
          const next = nextFireAfterFromString(r.recurrenceRule, r.scheduledAt, now, r.timezone);
          if (!missedWhileClosed) {
            deps.sink.fire(r);
            fired++;
            // Fired this cycle → stamp last_triggered_at, unless it was the last one.
            if (next === null) deps.repo.markCompleted(r.id);
            else deps.repo.setNextFireAt(r.id, next, now);
          } else {
            // Rolled forward WITHOUT firing (missed while closed) → do NOT stamp a fire (D3).
            overdue.push(r);
            if (next === null) deps.repo.markCompleted(r.id);
            else deps.repo.setNextFireAt(r.id, next);
          }
        } else if (missedWhileClosed) {
          // One-time missed while closed: honest, not a fake alarm hours late.
          deps.repo.markMissed(r.id, now);
          overdue.push(r);
        } else {
          deps.sink.fire(r);
          deps.repo.markTriggered(r.id, now);
          fired++;
        }
      } catch (e) {
        deps.onError?.(e);
      }
    }

    if (cause === 'startup' && overdue.length) deps.onOverdue?.(overdue);
    return { fired, missed: overdue.length };
  }

  return { reconcile };
}
