import { useState } from 'react';
import { ipc, AppError } from '../../lib/ipc';
import { Modal } from '../../components/Modal';
import { VOICE_CATALOG } from '../../../core/tts/voice-catalog';
import type { SettingsDto } from '../../../core/types/ipc';
import type { SettingsUpdate } from '../../lib/ipc';

/**
 * EP-4 functional Voice section (45 §UI; full polish → EP-8): choose the voice-output provider
 * (Windows / OpenAI, with a consent gate), pick a friendly voice, set the speed, and Preview —
 * which speaks "This is Yogi. Nice to meet you." through the SAME path reminders use (35 §4).
 */
export function VoiceSection({
  settings,
  onUpdate,
}: {
  settings: SettingsDto;
  onUpdate: (patch: SettingsUpdate) => void;
}) {
  const [consentOpen, setConsentOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const usingCloud = settings.ttsProvider === 'openai';
  const voiceHint = VOICE_CATALOG.find((v) => v.key === settings.ttsVoice)?.hint;

  async function preview() {
    if (usingCloud && !settings.hasApiKey) {
      setNote('Add your OpenAI key above to use OpenAI voices.');
      return;
    }
    setPreviewing(true);
    setNote(usingCloud ? 'Playing sample… (uses your OpenAI key)' : 'Playing sample…');
    try {
      await ipc.ttsPreview();
    } catch (e) {
      setNote(e instanceof AppError ? e.message : 'Preview failed.');
    } finally {
      // Simple debounce so mashing Preview can't rack up cost / overlap audio.
      window.setTimeout(() => setPreviewing(false), 900);
      window.setTimeout(() => setNote(null), 3500);
    }
  }

  return (
    <section className="settings-group">
      <h3>Voice</h3>

      <label className="setting-row">
        <span>Voice output</span>
        <select
          value={settings.ttsProvider}
          disabled={!settings.hasApiKey}
          onChange={(e) => {
            const v = e.target.value as 'web-speech' | 'openai';
            if (v === 'openai') setConsentOpen(true); // gate on consent first
            else onUpdate({ ttsProvider: 'web-speech' }); // revert → revokes TTS consent in main
          }}
        >
          <option value="web-speech">Windows voices — on your device (default)</option>
          <option value="openai">OpenAI — more natural</option>
        </select>
      </label>
      {!settings.hasApiKey && <p className="dim">Add your key above to use OpenAI voices.</p>}

      <label className="setting-row">
        <span>Voice</span>
        <select value={settings.ttsVoice} onChange={(e) => onUpdate({ ttsVoice: e.target.value })}>
          {VOICE_CATALOG.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      {voiceHint && <p className="dim setting-hint">{voiceHint}</p>}

      <label className="setting-row">
        <span>Speed</span>
        <span className="range-wrap">
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={settings.ttsRate}
            aria-label="Voice speed"
            onChange={(e) => onUpdate({ ttsRate: Number(e.target.value) })}
          />
          <span className="range-val">{settings.ttsRate.toFixed(1)}×</span>
        </span>
      </label>

      <div className="setting-row">
        <span>Preview</span>
        <button className="ghost" disabled={previewing} onClick={() => void preview()}>
          {previewing ? 'Playing…' : 'Play sample'}
        </button>
      </div>
      {note && <p className="dim">{note}</p>}

      {consentOpen && (
        <Modal onEscape={() => setConsentOpen(false)} labelledBy="tts-consent-title">
          <div className="reset-modal">
            <h2 id="tts-consent-title" className="plain">
              Turn on OpenAI voices?
            </h2>
            <p>
              <strong>OpenAI creates Yogi&rsquo;s natural voice, using your own API key.</strong>
            </p>
            <p className="dim">
              Only the words Yogi speaks (usually a reminder title) are sent &mdash; handled with your
              own key and billed to your OpenAI account. The audio isn&rsquo;t saved to disk. You can
              switch back to Windows voices anytime.
            </p>
            <div className="actions">
              <button className="ghost" onClick={() => setConsentOpen(false)}>
                Cancel
              </button>
              <button
                onClick={() => {
                  onUpdate({ ttsProvider: 'openai' });
                  setConsentOpen(false);
                }}
              >
                Turn on OpenAI voices
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
