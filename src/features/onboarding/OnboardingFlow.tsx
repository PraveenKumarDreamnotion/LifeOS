import { useState } from 'react';

/**
 * Onboarding (12 §4). Three panes, shown once. Microphone permission is NOT requested here —
 * it's requested lazily on first mic press, so the OS prompt has an obvious cause.
 */
export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const [pane, setPane] = useState(0);
  const panes = [<Welcome key="w" />, <DataPane key="d" />, <MicTrayPane key="m" />];

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        {panes[pane]}
        <div className="onboarding-nav">
          <div className="dots">
            {panes.map((_, i) => (
              <span key={i} className={i === pane ? 'dot on' : 'dot'} />
            ))}
          </div>
          <div className="onboarding-buttons">
            {pane > 0 && (
              <button className="ghost" onClick={() => setPane((p) => p - 1)}>
                Back
              </button>
            )}
            {pane < panes.length - 1 ? (
              <button onClick={() => setPane((p) => p + 1)}>Continue →</button>
            ) : (
              <button onClick={onDone}>Get started</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Welcome() {
  return (
    <div className="pane">
      <div className="mark big">◈</div>
      <h1>Welcome to LifeOS</h1>
      <p>Meet Yogi, your privacy-first companion.</p>
      <p className="dim">
        Yogi listens when you ask, understands what you mean, and reminds you at just the right
        time &mdash; all on your device.
      </p>
    </div>
  );
}

function DataPane() {
  return (
    <div className="pane">
      <h2 className="plain">🔒 Everything stays on your device</h2>
      <ul className="ticks">
        <li>Your reminders, history, and settings live in a local database on your device.</li>
        <li>No account, no server, no sync &mdash; nothing to sign up for.</li>
        <li>Your speech is turned into text right on your device, offline.</li>
        <li>Nothing is uploaded, and there&rsquo;s no tracking of any kind.</li>
      </ul>
    </div>
  );
}

function MicTrayPane() {
  return (
    <div className="pane">
      <h2 className="plain">Two quick things to know</h2>
      <p>
        <strong>🎤 Microphone</strong>
        <br />
        <span className="dim">
          Windows asks for microphone permission the first time you tap the mic. Yogi only listens
          when you ask &mdash; there&rsquo;s no wake word and no background listening.
        </span>
      </p>
      <p>
        <strong>🔔 Reminders need LifeOS running</strong>
        <br />
        <span className="dim">
          Closing the window keeps Yogi running quietly in the system tray, so your reminders still
          arrive. If you choose Quit from the tray, reminders pause until you open LifeOS again.
        </span>
      </p>
    </div>
  );
}
