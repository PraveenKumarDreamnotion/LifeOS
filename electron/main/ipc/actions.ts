/**
 * Action IPC (36 §6) — confirm/cancel a pending dispatcher proposal, guard()-wrapped. Neither
 * accepts an action payload: `action:confirm(turnId)` executes the STORED proposal for that turn,
 * so a compromised renderer cannot execute an action it wasn't shown (36 §4.3). Unknown/expired
 * ids are rejected by the dispatcher.
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import { guard } from './guard';
import { CH } from '../../../core/types/channels';
import type { ActionDispatcher } from '../../actions/dispatcher';

const TurnIdInput = z.string().uuid();

export interface ActionIpcDeps {
  dispatcher: ActionDispatcher;
  /** Settle the persisted chat turn so a reopened chat renders the settled card (CONV). */
  settle: (turnId: string, status: 'executed' | 'cancelled', reminderId: string | null) => void;
  /** Logs the confirm RESULT CODE only (never the reminder title) so a silent failure at the
   *  action:confirm → store.take → execute round-trip is diagnosable in the dev log. */
  onOutcome?: (outcome: string) => void;
}

export function registerActionHandlers(deps: ActionIpcDeps): void {
  ipcMain.handle(CH.ACTION_CONFIRM, (event, raw) =>
    guard(event, () => {
      const turnId = TurnIdInput.parse(raw);
      const result = deps.dispatcher.confirm(turnId);
      deps.settle(turnId, result.ok ? 'executed' : 'cancelled', result.ok ? result.reminderId ?? null : null);
      deps.onOutcome?.(result.ok ? 'confirmed' : `rejected:${result.code}`);
      return result;
    }),
  );

  ipcMain.handle(CH.ACTION_CANCEL, (event, raw) =>
    guard(event, () => {
      const turnId = TurnIdInput.parse(raw);
      deps.dispatcher.cancel(turnId);
      deps.settle(turnId, 'cancelled', null);
      return { cancelled: true };
    }),
  );
}
