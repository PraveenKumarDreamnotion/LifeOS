export type DesktopVoicePhase =
  | 'idle'
  | 'hover'
  | 'listening'
  | 'processing'
  | 'review'
  | 'sending'
  | 'speaking'
  | 'complete'
  | 'error';

export interface DesktopVoiceState {
  phase: DesktopVoicePhase;
  sessionId: string | null;
  activeTurnId: string | null;
  startedAt: number | null;
  registeredAccelerator: string | null;
  searching: boolean;
  error: string | null;
  /** True when the effective STT provider is cloud OpenAI (selected + keyed + consented). The
   *  launcher reads this to skip Review and submit a recognized transcript hands-free; offline STT
   *  (false) keeps the editable draft + Send button. Recomputed from settings on every snapshot. */
  sttAutoSubmit: boolean;
}

export const DESKTOP_VOICE_IDLE_STATE: DesktopVoiceState = {
  phase: 'idle',
  sessionId: null,
  activeTurnId: null,
  startedAt: null,
  registeredAccelerator: null,
  searching: false,
  error: null,
  sttAutoSubmit: false,
};
