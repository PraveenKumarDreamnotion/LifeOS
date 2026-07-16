import { useState } from 'react';
import { ipc, AppError } from '../../lib/ipc';
import { Modal } from '../../components/Modal';
import type { SettingsDto } from '../../../core/types/ipc';
import type { SettingsUpdate } from '../../lib/ipc';

/**
 * EP-1's single new UI surface (42 §UI): the MINIMAL OpenAI section — enable toggle, masked key
 * entry, Validate, Remove, and honest consent copy. The full Settings redesign (provider
 * selection, voice picker, per-feature consent management) is EP-8. The key is write-only from
 * here: it goes to main once and is never re-displayed (the DTO exposes only `hasApiKey`).
 */
export function OpenAiKeySection({
  settings,
  onUpdate,
}: {
  settings: SettingsDto;
  onUpdate: (patch: SettingsUpdate) => void;
}) {
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [validity, setValidity] = useState<'valid' | 'invalid' | 'unreachable' | null>(null);
  const [sttConsentOpen, setSttConsentOpen] = useState(false);
  const [aiConsentOpen, setAiConsentOpen] = useState(false);

  async function saveKey() {
    const key = keyInput.trim();
    if (key.length < 20) {
      setStatus('That key looks too short.');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await ipc.setApiKey(key);
      setKeyInput('');
      setStatus('Key saved.');
    } catch (e) {
      setStatus(e instanceof AppError ? e.message : 'Could not save the key.');
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    setBusy(true);
    setStatus(null);
    setValidity(null);
    try {
      await ipc.clearApiKey();
      setStatus('Key removed.');
    } catch (e) {
      setStatus(e instanceof AppError ? e.message : 'Could not remove the key.');
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    setBusy(true);
    setStatus(null);
    setValidity(null);
    try {
      const r = await ipc.validateApiKey();
      setValidity(r.valid ? 'valid' : r.reason === 'invalid' ? 'invalid' : 'unreachable');
    } catch {
      setValidity('unreachable');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-group">
      <h3>AI features (OpenAI)</h3>
      <p className="dim">
        Optional. Add your own OpenAI API key to turn on smarter chat and voice features. LifeOS
        works fully offline without one &mdash; nothing reaches OpenAI until you switch on a feature
        below and confirm.
      </p>

      <label className="setting-row">
        <span>AI chat &amp; answers</span>
        <input
          type="checkbox"
          checked={settings.aiEnabled}
          disabled={busy || (!settings.aiEnabled && !settings.hasApiKey)}
          onChange={(e) => {
            if (e.target.checked) setAiConsentOpen(true); // gate ON behind the consent modal
            else onUpdate({ aiEnabled: false }); // OFF → revokes chat consent in main
          }}
        />
      </label>
      {!settings.hasApiKey && <p className="dim">Add your key above to turn on AI chat &amp; answers.</p>}

      {settings.hasApiKey ? (
        <div className="setting-row">
          <span>API key &bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull; (saved)</span>
          <span>
            <button className="ghost" disabled={busy} onClick={() => void validate()}>
              Validate
            </button>{' '}
            <button className="ghost" disabled={busy} onClick={() => void removeKey()}>
              Remove
            </button>
          </span>
        </div>
      ) : (
        <div className="setting-row">
          <input
            type="password"
            placeholder="sk-…"
            value={keyInput}
            disabled={busy}
            aria-label="OpenAI API key"
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <button className="ghost" disabled={busy || !keyInput.trim()} onClick={() => void saveKey()}>
            Save
          </button>
        </div>
      )}

      {validity === 'valid' && <p className="ok">Key valid ✓</p>}
      {validity === 'invalid' && <p className="bad">Your API key was rejected.</p>}
      {validity === 'unreachable' && <p className="bad">Couldn&rsquo;t reach OpenAI.</p>}
      {status && <p className="dim">{status}</p>}

      <label className="setting-row">
        <span>Speech-to-text</span>
        <select
          value={settings.sttProvider}
          disabled={busy || !settings.hasApiKey}
          onChange={(e) => {
            const v = e.target.value as 'sherpa-onnx' | 'openai';
            if (v === 'openai') setSttConsentOpen(true); // gate on the consent modal first
            else onUpdate({ sttProvider: 'sherpa-onnx' }); // revert → revokes STT consent in main
          }}
        >
          <option value="sherpa-onnx">On your device (default)</option>
          <option value="openai">OpenAI — more accurate</option>
        </select>
      </label>
      {!settings.hasApiKey && <p className="dim">Add your key above to use OpenAI transcription.</p>}
      {settings.sttProvider === 'openai' && !settings.aiEnabled && (
        <p className="dim">
          🔒 <strong>Speech recognition only.</strong> OpenAI turns your speech into text &mdash;
          your reminders, commands, and replies still run entirely on your device.
        </p>
      )}

      {aiConsentOpen && (
        <Modal onEscape={() => setAiConsentOpen(false)} labelledBy="ai-consent-title">
          <div className="reset-modal">
            <h2 id="ai-consent-title" className="plain">
              Turn on AI chat &amp; answers?
            </h2>
            <p>
              <strong>Your messages are answered by OpenAI, using your own API key.</strong>
            </p>
            <p className="dim">
              When you chat or ask a question, your message goes to OpenAI &mdash; along with a short
              summary of your reminders (their <em>titles</em> and roughly when they&rsquo;re due,
              never exact dates, times, or ids). It&rsquo;s handled with your own key and billed to
              your OpenAI account. Your reminders keep working offline, and this doesn&rsquo;t turn
              on OpenAI speech or voices. You can turn it off anytime.
            </p>
            <div className="actions">
              <button className="ghost" onClick={() => setAiConsentOpen(false)}>
                Cancel
              </button>
              <button
                onClick={() => {
                  onUpdate({ aiEnabled: true }); // main records ai_consent_accepted_at
                  setAiConsentOpen(false);
                }}
              >
                Turn on OpenAI chat
              </button>
            </div>
          </div>
        </Modal>
      )}

      {sttConsentOpen && (
        <Modal onEscape={() => setSttConsentOpen(false)} labelledBy="stt-consent-title">
          <div className="reset-modal">
            <h2 id="stt-consent-title" className="plain">
              Turn on OpenAI speech-to-text?
            </h2>
            <p>
              <strong>OpenAI turns your speech into text, using your own API key.</strong>
            </p>
            <p className="dim">
              Only the audio from each dictation is sent, and only while you&rsquo;re speaking &mdash;
              handled with your own key and billed to your OpenAI account. Your recordings aren&rsquo;t
              saved to disk, and everything else stays on your device. You can switch back anytime.
            </p>
            <div className="actions">
              <button className="ghost" onClick={() => setSttConsentOpen(false)}>
                Cancel
              </button>
              <button
                onClick={() => {
                  onUpdate({ sttProvider: 'openai' });
                  setSttConsentOpen(false);
                }}
              >
                Turn on OpenAI transcription
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
