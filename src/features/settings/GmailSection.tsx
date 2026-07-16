import { useEffect, useState } from 'react';
import { ipc, AppError } from '../../lib/ipc';
import { Modal } from '../../components/Modal';
import type { SettingsDto, GmailStatusDto } from '../../../core/types/ipc';
import type { SettingsUpdate } from '../../lib/ipc';

/**
 * Integrations → Google Gmail (docs/lifeos-planning/gmail-integration.md §5). Phase 1: connect /
 * reconnect / disconnect, secure credential entry, test, feature toggles, sync policy, cache
 * delete, and a live status snapshot. Credentials are write-only from here — the secret goes to
 * main once and is never re-displayed; only a safe status (connected + email + counts) comes back.
 *
 * Feature toggles and sync-mode become behaviorally live in Phase 2+; they are clearly gated here
 * (persisted, honestly labeled), never faked.
 */
export function GmailSection({
  settings,
  onUpdate,
}: {
  settings: SettingsDto;
  onUpdate: (patch: SettingsUpdate) => void;
}) {
  const [status, setStatus] = useState<GmailStatusDto | null>(null);
  const [clientId, setClientId] = useState(settings.gmailClientId);
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void ipc.gmailStatus().then(setStatus).catch(() => setStatus(null));
    return ipc.onGmailStatusChanged(setStatus);
  }, []);

  const connected = status?.connected ?? false;
  const hasCredentials = (status?.hasClientId ?? false) && (status?.hasClientSecret ?? false);
  const reconnectNeeded = status?.syncStatus === 'reconnect_needed';

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    setTest(null);
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof AppError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const saveCredentials = () =>
    run(async () => {
      await ipc.gmailSetCredentials(clientId.trim(), clientSecret.trim());
      setClientSecret('');
      setMessage('Credentials saved.');
    });

  const connect = () =>
    run(async () => {
      const r = await ipc.gmailConnect();
      setMessage(`Connected as ${r.emailAddress}.`);
    });

  const disconnect = () =>
    run(async () => {
      await ipc.gmailDisconnect();
      setMessage('Disconnected. Access was revoked with Google.');
    });

  const runTest = () =>
    run(async () => {
      const r = await ipc.gmailTest();
      setTest(r.ok ? `Reachable as ${r.emailAddress}.` : `Not connected (${r.reason ?? 'unknown'}).`);
    });

  const deleteCache = () =>
    run(async () => {
      const r = await ipc.gmailDeleteCache();
      setConfirmDelete(false);
      setMessage(`Deleted ${r.deleted} stored email${r.deleted === 1 ? '' : 's'}.`);
    });

  const syncNow = () =>
    run(async () => {
      const r = await ipc.gmailSyncNow();
      setMessage(
        r.ok
          ? `Sync complete — ${r.fetched} fetched, ${r.newCount} new.`
          : `Sync did not run (${r.reason ?? 'unknown'}).`,
      );
    });

  return (
    <section className="settings-group">
      <h3>Gmail (optional)</h3>

      <div className="gmail-status">
        <span className={`gmail-dot${connected ? ' on' : ''}`} aria-hidden />
        <span>
          {connected ? (
            <>
              <strong>Connected</strong>
              {status?.emailAddress ? ` · ${status.emailAddress}` : ''}
            </>
          ) : reconnectNeeded ? (
            <strong>Reconnect needed</strong>
          ) : (
            'Not connected'
          )}
        </span>
      </div>
      <p className="dim">
        🔒 Your email stays on your device — LifeOS never uploads it anywhere. You connect with your
        own Google Cloud (Desktop) credentials, and your sign-in tokens are encrypted with Windows
        secure storage so they never leave your device. Setup steps are in the LifeOS docs.
      </p>

      {/* Credentials */}
      <div className="gmail-field">
        <label htmlFor="gmail-client-id">Client ID</label>
        <input
          id="gmail-client-id"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="xxxxxxxx.apps.googleusercontent.com"
          value={clientId}
          disabled={busy}
          onChange={(e) => setClientId(e.target.value)}
        />
      </div>
      <div className="gmail-field">
        <label htmlFor="gmail-client-secret">Client Secret</label>
        <div className="gmail-secret-row">
          <input
            id="gmail-client-secret"
            type={showSecret ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder={status?.hasClientSecret ? '•••••••• (saved — enter to replace)' : 'Client secret'}
            value={clientSecret}
            disabled={busy}
            onChange={(e) => setClientSecret(e.target.value)}
          />
          <button className="ghost" type="button" disabled={busy} onClick={() => setShowSecret((s) => !s)}>
            {showSecret ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      <div className="gmail-btn-row">
        <button
          className="ghost"
          disabled={busy || clientId.trim().length < 10 || clientSecret.trim().length < 6}
          onClick={() => void saveCredentials()}
        >
          Save credentials
        </button>
      </div>

      {/* Connection actions */}
      <div className="gmail-btn-row">
        {!connected ? (
          <button className="gmail-primary" disabled={busy || !hasCredentials} onClick={() => void connect()}>
            {reconnectNeeded ? 'Reconnect Gmail' : 'Connect Gmail'}
          </button>
        ) : (
          <>
            <button className="ghost" disabled={busy} onClick={() => void connect()}>
              Reconnect
            </button>
            <button className="ghost" disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </button>
          </>
        )}
        <button className="ghost" disabled={busy || !connected} onClick={() => void runTest()}>
          Test Connection
        </button>
        <button className="ghost" disabled={busy || !connected} onClick={() => void syncNow()}>
          Sync now
        </button>
      </div>
      {!hasCredentials && !connected && (
        <p className="dim">Save your Client ID and Client Secret above to enable Connect.</p>
      )}
      {message && <p className="dim">{message}</p>}
      {test && <p className={test.startsWith('Reachable') ? 'ok' : 'bad'}>{test}</p>}

      {/* Email features */}
      <h4 className="gmail-subhead">Email features</h4>
      <label className="setting-row">
        <span>Enable Gmail sync</span>
        <input
          type="checkbox"
          checked={settings.gmailEnabled}
          onChange={(e) => onUpdate({ gmailEnabled: e.target.checked })}
        />
      </label>
      <label className="setting-row">
        <span>Desktop notifications</span>
        <input
          type="checkbox"
          checked={settings.gmailNotifications}
          onChange={(e) => onUpdate({ gmailNotifications: e.target.checked })}
        />
      </label>
      <label className="setting-row">
        <span>AI email summaries</span>
        <input
          type="checkbox"
          disabled={!settings.hasApiKey}
          checked={settings.gmailAiSummaries}
          onChange={(e) => onUpdate({ gmailAiSummaries: e.target.checked })}
        />
      </label>
      <label className="setting-row">
        <span>Store email context</span>
        <input
          type="checkbox"
          checked={settings.gmailStoreContext}
          onChange={(e) => onUpdate({ gmailStoreContext: e.target.checked })}
        />
      </label>
      <label className="setting-row">
        <span>Automatic web research</span>
        <input
          type="checkbox"
          disabled={!settings.hasApiKey || !settings.gmailAiSummaries || !settings.gmailStoreContext}
          checked={settings.gmailAutoResearch}
          onChange={(e) => onUpdate({ gmailAutoResearch: e.target.checked })}
        />
      </label>
      {settings.hasApiKey && settings.gmailAutoResearch && (!settings.gmailAiSummaries || !settings.gmailStoreContext) && (
        <p className="dim">
          Web research needs <strong>AI email summaries</strong> and <strong>Store email context</strong> on — Yogi
          uses the summary to decide when a lookup helps.
        </p>
      )}
      <label className="setting-row">
        <span>Download attachments</span>
        <input
          type="checkbox"
          checked={settings.gmailDownloadAttachments}
          onChange={(e) => onUpdate({ gmailDownloadAttachments: e.target.checked })}
        />
      </label>
      <label className="setting-row">
        <span>Include thread history</span>
        <input
          type="checkbox"
          checked={settings.gmailIncludeThreads}
          onChange={(e) => onUpdate({ gmailIncludeThreads: e.target.checked })}
        />
      </label>
      {settings.hasApiKey && settings.gmailAiSummaries && (
        <p className="dim">
          Summaries are created by OpenAI from your email, using your own API key. You can turn this
          off anytime.
        </p>
      )}
      {!settings.hasApiKey && (
        <p className="dim">AI summaries and web research need your OpenAI key (see AI features above).</p>
      )}

      {/* Sync mode */}
      <h4 className="gmail-subhead">Sync mode</h4>
      <label className="setting-row">
        <span>How LifeOS checks for new mail</span>
        <select
          value={settings.gmailSyncMode}
          onChange={(e) => onUpdate({ gmailSyncMode: e.target.value as SettingsDto['gmailSyncMode'] })}
        >
          <option value="push" disabled>
            Push — coming soon
          </option>
          <option value="5min">Every 5 minutes</option>
          <option value="15min">Every 15 minutes</option>
          <option value="manual">Manual</option>
        </select>
      </label>

      {/* Max stored */}
      <label className="setting-row">
        <span>Maximum stored emails</span>
        <select
          value={settings.gmailMaxStored}
          onChange={(e) => onUpdate({ gmailMaxStored: e.target.value as SettingsDto['gmailMaxStored'] })}
        >
          <option value="1000">1000</option>
          <option value="5000">5000</option>
          <option value="unlimited">Unlimited</option>
        </select>
      </label>

      {/* Status detail */}
      <h4 className="gmail-subhead">Status</h4>
      <div className="gmail-meta">
        <span>Connected account</span>
        <span>{status?.emailAddress ?? '—'}</span>
      </div>
      <div className="gmail-meta">
        <span>Last sync</span>
        <span>{status?.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'Never'}</span>
      </div>
      <div className="gmail-meta">
        <span>Storage used</span>
        <span>{formatBytes(status?.storageBytes ?? 0)}</span>
      </div>
      <div className="gmail-meta">
        <span>Connection status</span>
        <span>{describeStatus(status)}</span>
      </div>

      <div className="gmail-btn-row">
        <button className="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
          Delete local email cache…
        </button>
      </div>

      {confirmDelete && (
        <Modal onEscape={() => setConfirmDelete(false)} labelledBy="gmail-del-title">
          <div className="reset-modal">
            <h2 id="gmail-del-title" className="plain">
              Delete local email cache?
            </h2>
            <p>This removes every email LifeOS has stored on your device. Your Gmail account is untouched.</p>
            <p className="dim">You stay connected; the next sync will re-download from Gmail.</p>
            <div className="actions">
              <button className="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Cancel
              </button>
              <button className="danger-btn" disabled={busy} onClick={() => void deleteCache()}>
                {busy ? 'Deleting…' : 'Delete cache'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function formatBytes(n: number): string {
  if (n <= 0) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function describeStatus(s: GmailStatusDto | null): string {
  if (!s || s.syncStatus === 'not_connected') return 'Not connected';
  switch (s.syncStatus) {
    case 'reconnect_needed':
      return 'Reconnect needed';
    case 'syncing':
      return 'Syncing…';
    case 'error':
      return 'Error';
    default:
      return s.connected ? 'Connected' : 'Idle';
  }
}
