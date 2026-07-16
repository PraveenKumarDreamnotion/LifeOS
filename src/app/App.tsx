import { useState, useEffect, useCallback } from 'react';
import { useSettings } from '../hooks/useSettings';
import { ipc } from '../lib/ipc';
import { OnboardingFlow } from '../features/onboarding/OnboardingFlow';
import { ChatScreen } from '../features/chat/ChatScreen';
import { LegacyChatScreen } from '../features/chat/LegacyChatScreen';
import { SchedulesScreen } from '../features/schedules/SchedulesScreen';
import { HistoryScreen } from '../features/history/HistoryScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { TriggerModal } from '../features/reminders/TriggerModal';
import { OverdueModal, type OverdueItem } from '../features/reminders/OverdueModal';
import type { ReminderDto } from '../../core/types/ipc';

type View = 'chat' | 'schedules' | 'history' | 'settings';

const NAV: Array<{ id: View; label: string; icon: string }> = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'schedules', label: 'Schedules', icon: '📅' },
  { id: 'history', label: 'History', icon: '🕘' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export default function App() {
  const { settings, update } = useSettings();
  const [view, setView] = useState<View>('chat');
  const [queue, setQueue] = useState<ReminderDto[]>([]);
  const [overdue, setOverdue] = useState<OverdueItem[] | null>(null);
  const [version, setVersion] = useState('0.1.0');
  // The email chat to open when a new-email notification is clicked (Phase 3). Held here (not in
  // ChatScreen) so it's race-free: it's set before/at ChatScreen mount and passed as a prop.
  const [openChatId, setOpenChatId] = useState<string | null>(null);
  // Stable so ChatScreen's one-shot effect fires only on a NEW open-chat id, not every App render.
  const clearOpenChat = useCallback(() => setOpenChatId(null), []);

  useEffect(() => {
    void ipc.version().then((v) => setVersion(v.version));
    void ipc.takeOverdue().then((items) => {
      if (items.length) setOverdue(items as OverdueItem[]);
    });
    const unsubT = window.lifeos.app.onReminderTrigger((r) => setQueue((q) => [...q, r as ReminderDto]));
    // A local "open settings" command (offline app-control) asks the main window to switch screens.
    const unsubNav = window.lifeos.app.onNavigate((screen) => {
      if (screen === 'settings' || screen === 'chat' || screen === 'schedules' || screen === 'history') {
        setView(screen);
      }
    });
    // A new-email notification was clicked → switch to Chat and open that email's chat.
    const unsubGmail = ipc.onGmailOpenChat(({ sessionId }) => {
      setView('chat');
      setOpenChatId(sessionId);
    });
    return () => {
      unsubT();
      unsubNav();
      unsubGmail();
    };
  }, []);

  if (!settings) {
    return (
      <div className="app app-loading">
        <div className="app-loading-inner">
          <span className="mark big" aria-hidden>◈</span>
          <span className="spinner" aria-label="Loading" role="status" />
        </div>
      </div>
    );
  }

  if (!settings.onboardingCompleted) {
    return <OnboardingFlow onDone={() => void update({ onboardingCompleted: true })} />;
  }

  const paused = settings.remindersPaused;
  const togglePause = () => void update({ remindersPaused: !paused });
  const current = queue[0];

  return (
    <div className="app">
      <nav className="rail">
        <div className="rail-brand">
          <span className="mark">◈</span> Yogi
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={view === n.id ? 'rail-item on' : 'rail-item'}
            aria-current={view === n.id ? 'page' : undefined}
            onClick={() => setView(n.id)}
          >
            <span className="rail-icon">{n.icon}</span>
            {n.label}
          </button>
        ))}
        <div className="rail-foot">
          {/* Runtime state, not provider SELECTION: with no API key nothing can reach the cloud
              (the zero-outbound-packets guarantee), so the app is genuinely offline regardless of
              which STT/TTS provider is chosen. Only a configured key unlocks any cloud feature. */}
          <span className={settings.hasApiKey ? 'chip' : 'chip chip-offline'} title={settings.hasApiKey ? 'Your OpenAI key is connected — AI features run only when you turn them on.' : 'No key added — everything runs on your device.'}>
            {settings.hasApiKey ? '☁ OpenAI connected' : '🔒 On your device'}
          </span>
        </div>
      </nav>

      <main className="content">
        {paused && (
          <div className="banner-paused" role="status">
            ⏸ Reminders are paused — none will arrive until you resume.
            <button className="ghost" onClick={togglePause}>
              Resume reminders
            </button>
          </div>
        )}

        {view === 'chat' && (settings.conversationUiEnabled ? <ChatScreen offline={!settings.hasApiKey} openSessionId={openChatId} onOpened={clearOpenChat} /> : <LegacyChatScreen />)}
        {view === 'schedules' && <SchedulesScreen paused={paused} onTogglePause={togglePause} />}
        {view === 'history' && <HistoryScreen />}
        {view === 'settings' && <SettingsScreen settings={settings} onUpdate={update} version={version} />}
      </main>

      {current && (
        <TriggerModal
          reminder={current}
          total={queue.length}
          snoozeMinutes={settings.snoozeMinutes}
          onDismiss={() => {
            void ipc.dismissReminder(current.id);
            setQueue((q) => q.slice(1));
          }}
          onComplete={() => {
            void ipc.completeReminder(current.id);
            setQueue((q) => q.slice(1));
          }}
          onSnooze={() => {
            void ipc.snoozeReminder(current.id, settings.snoozeMinutes);
            setQueue((q) => q.slice(1));
          }}
        />
      )}

      {overdue && <OverdueModal items={overdue} onDismiss={() => setOverdue(null)} />}
    </div>
  );
}
