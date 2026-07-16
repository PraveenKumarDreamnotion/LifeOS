import { useState } from 'react';
import { ipc } from '../../lib/ipc';
import { Modal } from '../../components/Modal';
import { OpenAiKeySection } from './OpenAiKeySection';
import { VoiceSection } from './VoiceSection';
import { GmailSection } from './GmailSection';
import type { SettingsDto } from '../../../core/types/ipc';
import type { SettingsUpdate } from '../../lib/ipc';

export function SettingsScreen({
  settings,
  onUpdate,
  version,
}: {
  settings: SettingsDto;
  onUpdate: (patch: SettingsUpdate) => void;
  version: string;
}) {
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <div className="screen">
      <h1 className="screen-title">Settings</h1>

      <section className="settings-group">
        <h3>Privacy</h3>
        <p className="dim">
          🔒 Everything stays on your device. No account, no server, no sync, and no tracking.
        </p>
        <button className="ghost" onClick={() => void ipc.openDataFolder()}>
          Open data folder
        </button>
      </section>

      <OpenAiKeySection settings={settings} onUpdate={onUpdate} />

      <VoiceSection settings={settings} onUpdate={onUpdate} />

      <GmailSection settings={settings} onUpdate={onUpdate} />

      <section className="settings-group">
        <h3>Speech</h3>
        <label className="setting-row">
          <span>Speak reminders aloud</span>
          <input
            type="checkbox"
            checked={settings.ttsEnabled}
            onChange={(e) => onUpdate({ ttsEnabled: e.target.checked })}
          />
        </label>
        <p className="dim">
          {settings.sttProvider === 'openai' || settings.ttsProvider === 'openai'
            ? 'Some speech features use OpenAI — see the AI features and Voice sections above. Anything you haven’t turned on stays on your device.'
            : 'Speech-to-text and voices run entirely on your device, no internet needed.'}
        </p>
      </section>

      <section className="settings-group">
        <h3>Desktop Voice Launcher</h3>
        <label className="setting-row">
          <span>Enable floating voice launcher</span>
          <input
            type="checkbox"
            checked={settings.desktopVoiceLauncherEnabled}
            onChange={(e) => onUpdate({ desktopVoiceLauncherEnabled: e.target.checked })}
          />
        </label>
        <p className="dim">A small always-on-top window for talking to Yogi from anywhere.</p>
        <label className="setting-row">
          <span>Enable global shortcut (Shift+Alt+Space)</span>
          <input
            type="checkbox"
            disabled={!settings.desktopVoiceLauncherEnabled}
            checked={settings.desktopVoiceShortcutEnabled}
            onChange={(e) => onUpdate({ desktopVoiceShortcutEnabled: e.target.checked })}
          />
        </label>
        <label className="setting-row">
          <span>Resume conversations after a reminder</span>
          <input
            type="checkbox"
            checked={settings.conversationAutoResume}
            onChange={(e) => onUpdate({ conversationAutoResume: e.target.checked })}
          />
        </label>
        <p className="dim">
          When a reminder interrupts you mid-conversation, Yogi re-reads the reply that was cut off
          and starts listening again. Turn this off to simply re-open the launcher and pick up
          yourself.
        </p>
      </section>

      <section className="settings-group">
        <h3>Reminders</h3>
        <label className="setting-row">
          <span>Pause all reminders</span>
          <input
            type="checkbox"
            checked={settings.remindersPaused}
            onChange={(e) => onUpdate({ remindersPaused: e.target.checked })}
          />
        </label>
      </section>

      <section className="settings-group">
        <h3>Window &amp; tray</h3>
        <label className="setting-row">
          <span>Closing the window</span>
          <select
            value={settings.closeAction}
            onChange={(e) => onUpdate({ closeAction: e.target.value as 'tray' | 'quit' })}
          >
            <option value="tray">Keep Yogi running in the tray</option>
            <option value="quit">Quit LifeOS completely</option>
          </select>
        </label>
        <p className="dim">⚠ Reminders can only arrive while LifeOS is running.</p>
        <label className="setting-row">
          <span>Start LifeOS at login</span>
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) => onUpdate({ launchAtLogin: e.target.checked })}
          />
        </label>
        <p className="dim">
          Opens LifeOS quietly in the tray when you sign in, so reminders keep arriving and fewer are
          missed. (While your PC is fully off, anything missed is summarized for you the next time you
          open LifeOS.)
        </p>
        <label className="setting-row">
          <span>Theme</span>
          <select
            value={settings.theme}
            onChange={(e) => onUpdate({ theme: e.target.value as SettingsDto['theme'] })}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <section className="settings-group danger">
        <h3>Danger zone</h3>
        <p className="dim">
          Resetting permanently deletes the reminders, history, and settings in your LifeOS data
          folder. Nothing else on your device is touched.
        </p>
        <button className="danger-btn" onClick={() => setResetOpen(true)}>
          Reset local data…
        </button>
      </section>

      <section className="settings-group">
        <h3>About</h3>
        <p className="dim">LifeOS {version} · Yogi · MIT License</p>
      </section>

      {resetOpen && <ResetModal onClose={() => setResetOpen(false)} />}
    </div>
  );
}

function ResetModal({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const canReset = typed === 'RESET';

  return (
    <Modal onEscape={onClose} labelledBy="reset-title">
      <div className="reset-modal">
        <h2 id="reset-title" className="plain">
          Reset LifeOS local data
        </h2>
        <p>This permanently deletes your reminders, history, and settings.</p>
        <p className="dim">Nothing outside your LifeOS data folder is touched. This can’t be undone.</p>
        <label className="reset-confirm">
          Type <strong>RESET</strong> to confirm:
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
        <div className="actions">
          <button className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="danger-btn"
            disabled={!canReset || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await ipc.resetLocalData(); // relaunches the app
              } catch {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Resetting…' : 'Reset local data'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
