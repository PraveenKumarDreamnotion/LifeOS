import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LauncherApp } from './LauncherApp';
import '../styles/global.css';
import './launcher.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof window !== 'undefined' && !(window as any).lifeosLauncher) {
  let mockPhase = 'idle';
  const mockSessionId = '00000000-0000-0000-0000-000000000000';
  let stateListeners: ((state: any) => void)[] = [];

  const notifyListeners = () => {
    const state = { phase: mockPhase, sessionId: mockSessionId, activeTurnId: null, startedAt: null, searching: false, error: null };
    stateListeners.forEach((cb) => cb(state));
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).lifeosLauncher = {
    getState: () => Promise.resolve({ ok: true, data: { phase: mockPhase, sessionId: mockSessionId } }),
    onStateChanged: (cb: any) => {
      stateListeners.push(cb);
      return () => {
        stateListeners = stateListeners.filter((l) => l !== cb);
      };
    },
    onBeginListening: () => () => {},
    onStopListening: () => () => {},
    sendTranscript: (_payload: { sessionId: string; text: string }) => {
      mockPhase = 'sending';
      notifyListeners();
      return new Promise((resolve) => {
        setTimeout(() => {
          mockPhase = 'complete';
          notifyListeners();
          resolve({ ok: true, data: { turnId: 'mock-turn' } });
          const reply = 'Hello! This is a mock Yogi response in your web browser.';
          // Also trigger chat:done event first to add response to the UI
          (window as any).lifeosLauncher.chat._triggerDone({ turnId: 'mock-turn', reply });
          if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(reply);
            window.speechSynthesis.speak(utterance);
          }
        }, 1500);
      });
    },
    discardTranscript: () => {
      mockPhase = 'idle';
      notifyListeners();
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      return Promise.resolve({ ok: true });
    },
    reviewReady: () => {
      mockPhase = 'review';
      notifyListeners();
      return Promise.resolve({ ok: true });
    },
    hoverChanged: () => Promise.resolve({ ok: true }),
    positionChanged: () => Promise.resolve({ ok: true }),
    setInteractive: () => Promise.resolve({ ok: true }),
    setError: () => Promise.resolve({ ok: true }),
    speech: {
      start: () => Promise.resolve({ ok: true, data: { started: true, supportsPartials: true } }),
      stop: () => {
        setTimeout(() => {
          mockPhase = 'review';
          notifyListeners();
        }, 500);
        return Promise.resolve({ ok: true, data: { text: 'Mock user voice input' } });
      },
      pushAudio: () => {},
      onPartial: () => () => {},
      onError: () => () => {},
    },
    tts: {
      stop: () => {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        return Promise.resolve({ ok: true });
      },
      onSpeaking: () => () => {},
    },
    chat: {
      _doneListeners: [] as any[],
      onDone: (cb: any) => {
        (window as any).lifeosLauncher.chat._doneListeners.push(cb);
        return () => {
          (window as any).lifeosLauncher.chat._doneListeners = (window as any).lifeosLauncher.chat._doneListeners.filter((l: any) => l !== cb);
        };
      },
      _triggerDone: (payload: any) => {
        (window as any).lifeosLauncher.chat._doneListeners.forEach((cb: any) => cb(payload));
      },
      onSearching: () => () => {},
    },
  };
}

createRoot(document.getElementById('launcher-root')!).render(
  <StrictMode>
    <LauncherApp />
  </StrictMode>,
);
