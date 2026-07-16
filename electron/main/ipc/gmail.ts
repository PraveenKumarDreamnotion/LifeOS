/**
 * Gmail IPC handlers (docs §5). Same discipline as the other handlers: origin check → Zod .strict()
 * → act → return a plain object, all inside guard() so nothing throws across IPC. Credentials go in
 * write-only (the secret is encrypted in main); the renderer only ever gets back a safe
 * GmailStatusDto (connected + email + counts), never a token or the secret.
 */
import { ipcMain, BrowserWindow } from 'electron';
import { guard, ValidationError } from './guard';
import { CH } from '../../../core/types/channels';
import { GmailCredentialsInput, type GmailStatusDto, type GmailSyncResultDto } from '../../../core/types/ipc';
import { EncryptionUnavailableError } from '../../services/gmail-token-store';
import { GmailAuthError, type GmailAuthService } from '../../gmail/gmail-auth';
import type { GmailTokenStore } from '../../services/gmail-token-store';
import type { GmailRepository } from '../../database/gmail-repository';
import type { SettingsRepository } from '../../database/settings-repository';

export interface GmailIpcDeps {
  auth: GmailAuthService;
  repo: GmailRepository;
  tokenStore: GmailTokenStore;
  settings: SettingsRepository;
  onSettingsChanged: () => void;
  /** Phase 2: run a sync (manual button + post-connect kick). Returns null if not connected. */
  syncNow?: () => Promise<GmailSyncResultDto | null>;
}

/** Build the safe connection snapshot for the Settings section. No secrets. */
export function buildGmailStatus(deps: Pick<GmailIpcDeps, 'repo' | 'tokenStore' | 'settings'>): GmailStatusDto {
  const { repo, tokenStore, settings } = deps;
  const account = repo.getAccount();
  const hasClientId = settings.get('gmail_client_id').length > 0;
  const hasClientSecret = tokenStore.hasClientSecret();
  if (!account) {
    return {
      connected: false,
      emailAddress: null,
      hasClientId,
      hasClientSecret,
      lastSyncAt: null,
      messageCount: 0,
      storageBytes: 0,
      syncStatus: 'not_connected',
    };
  }
  const sync = repo.getSyncState(account.id);
  return {
    connected: tokenStore.hasTokens(),
    emailAddress: account.emailAddress,
    hasClientId,
    hasClientSecret,
    lastSyncAt: sync?.lastSyncAt ?? null,
    messageCount: repo.messageCount(account.id),
    storageBytes: repo.storageBytes(account.id),
    syncStatus: sync?.status ?? 'idle',
  };
}

/** Broadcast the fresh status to every window (connect/disconnect/sync are async). */
export function broadcastGmailStatus(deps: Pick<GmailIpcDeps, 'repo' | 'tokenStore' | 'settings'>): void {
  const status = buildGmailStatus(deps);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(CH.GMAIL_STATUS_CHANGED, status);
  }
}

/** Map a GmailAuthError to a renderer-safe ValidationError (friendly message, no internals). */
function asValidation(e: unknown): never {
  if (e instanceof GmailAuthError) throw new ValidationError(e.code, e.message);
  throw e;
}

export function registerGmailHandlers(deps: GmailIpcDeps): void {
  const { auth, repo, tokenStore, settings, onSettingsChanged } = deps;

  ipcMain.handle(CH.GMAIL_SET_CREDENTIALS, (event, raw) =>
    guard(event, () => {
      const { clientId, clientSecret } = GmailCredentialsInput.parse(raw);
      settings.set('gmail_client_id', clientId); // non-secret
      try {
        tokenStore.setClientSecret(clientSecret); // encrypted at rest, never re-displayed
      } catch (e) {
        if (e instanceof EncryptionUnavailableError) {
          throw new ValidationError('encryption_unavailable', 'Secure storage is unavailable on this device.');
        }
        throw e;
      }
      onSettingsChanged();
      broadcastGmailStatus(deps);
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.GMAIL_CONNECT, (event) =>
    guard(event, async () => {
      const result = await auth.connect().catch((e) => asValidation(e));
      settings.set('gmail_enabled', 'true');
      onSettingsChanged();
      broadcastGmailStatus(deps);
      // Kick an initial sync in the background (don't block the connect response on a full sync).
      void deps.syncNow?.().then(() => broadcastGmailStatus(deps)).catch(() => {});
      return result;
    }),
  );

  ipcMain.handle(CH.GMAIL_DISCONNECT, (event) =>
    guard(event, async () => {
      await auth.disconnect();
      settings.set('gmail_enabled', 'false');
      onSettingsChanged();
      broadcastGmailStatus(deps);
      return { ok: true };
    }),
  );

  ipcMain.handle(CH.GMAIL_TEST, (event) =>
    guard(event, async () => auth.testConnection()),
  );

  ipcMain.handle(CH.GMAIL_DELETE_CACHE, (event) =>
    guard(event, () => {
      const account = repo.getAccount();
      const deleted = account ? repo.messageCount(account.id) : 0;
      if (account) repo.deleteEmailCache(account.id);
      broadcastGmailStatus(deps);
      return { ok: true, deleted };
    }),
  );

  ipcMain.handle(CH.GMAIL_STATUS_GET, (event) =>
    guard(event, () => buildGmailStatus(deps)),
  );

  ipcMain.handle(CH.GMAIL_SYNC_NOW, (event) =>
    guard(event, async () => {
      const result = (await deps.syncNow?.()) ?? { ok: false, mode: 'skipped' as const, fetched: 0, newCount: 0, reason: 'not_connected' };
      broadcastGmailStatus(deps);
      return result;
    }),
  );
}
