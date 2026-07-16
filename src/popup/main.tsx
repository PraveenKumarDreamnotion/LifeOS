import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from './PopupApp';
import '../styles/global.css';
import './popup.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof window !== 'undefined' && !(window as any).lifeosPopup) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).lifeosPopup = {
    onShow: () => () => {},
    onSearching: () => () => {},
    action: () => Promise.resolve({ ok: true }),
    message: () => Promise.resolve({ ok: true, data: { turnId: '1' } }),
    chat: {
      createSession: () => Promise.resolve({ ok: true, data: 'session-id' }),
      send: () => Promise.resolve({ ok: true, data: { turnId: '1' } }),
      onDone: () => () => {},
    },
    speech: {
      start: () => Promise.resolve({ ok: true, data: { started: true, supportsPartials: true } }),
      stop: () => Promise.resolve({ ok: true, data: { text: '' } }),
      pushAudio: () => {},
      onPartial: () => () => {},
      onError: () => () => {},
    },
    tts: {
      stop: () => Promise.resolve({ ok: true }),
      onSpeaking: () => () => {},
    },
  };
}

createRoot(document.getElementById('popup-root')!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);
