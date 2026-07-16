import type { MicState } from '../../hooks/useSpeech';

const LABEL: Record<MicState, string> = {
  idle: 'Microphone. Press to speak.',
  initializing: 'Preparing microphone',
  listening: 'Listening — press to stop',
  processing: 'Processing what you said',
  error: 'Microphone unavailable. Type instead.',
};

export function MicButton({ state, onToggle }: { state: MicState; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`mic mic-${state}`}
      onClick={onToggle}
      disabled={state === 'processing'}
      aria-label={LABEL[state]}
      title={LABEL[state]}
    >
      {state === 'initializing' || state === 'processing' ? '…' : state === 'error' ? '⊘' : '🎤'}
    </button>
  );
}
