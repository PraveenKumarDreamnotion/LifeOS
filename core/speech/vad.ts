/**
 * VadGate (Track A) — the pure voice-activity / endpointing decision core. It turns a stream of
 * per-frame speech probabilities into `speech_start` / `speech_end` (endpoint) events, with
 * hysteresis (separate on/off thresholds), a minimum-speech guard (ignore blips), and a
 * trailing-silence hangover (declare the end only after a real pause).
 *
 * This is the piece that lets the app gate non-speech BEFORE it reaches the recognizer — the single
 * biggest lever against Whisper "thanks for watching" hallucinations on silence, and cleaner
 * endpointing for every provider. It is engine-agnostic on purpose: a Silero VAD ONNX model (the
 * intended source) produces the per-frame probability, but a simple RMS→probability mapping (the
 * energy gate already shipped in the renderer) feeds the exact same state machine. Only the scorer
 * differs; this decision logic is shared, deterministic, and unit-tested.
 *
 * Pure: no DOM, no ONNX, no timers — the caller drives it frame by frame.
 */
export interface VadConfig {
  /** prob ≥ this → the frame is speech. */
  onThreshold: number;
  /** prob < this → the frame is (potential) silence. Between the two = hold (hysteresis). */
  offThreshold: number;
  /** Trailing silence needed to declare speech_end (endpoint). ~500–700ms is typical. */
  minSilenceMs: number;
  /** Minimum contiguous speech before speech_start — drops sub-word blips of noise. */
  minSpeechMs: number;
  /** Duration each pushed frame represents (Silero commonly uses 30ms frames). */
  frameMs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  onThreshold: 0.5,
  offThreshold: 0.35,
  minSilenceMs: 600,
  minSpeechMs: 120,
  frameMs: 30,
};

export type VadEvent = 'speech_start' | 'speech_end';

export class VadGate {
  private readonly cfg: VadConfig;
  private speakingState = false;
  private heardSpeechState = false;
  private speechMs = 0;
  private silenceMs = 0;

  constructor(cfg: Partial<VadConfig> = {}) {
    this.cfg = { ...DEFAULT_VAD_CONFIG, ...cfg };
  }

  /** Feed one frame's speech probability in [0,1]. Returns an event at a transition, else null. */
  push(prob: number): VadEvent | null {
    const { onThreshold, offThreshold, minSilenceMs, minSpeechMs, frameMs } = this.cfg;

    if (prob >= onThreshold) {
      // Clear speech.
      this.silenceMs = 0;
      this.speechMs += frameMs;
      if (!this.speakingState && this.speechMs >= minSpeechMs) {
        this.speakingState = true;
        this.heardSpeechState = true;
        return 'speech_start';
      }
      return null;
    }

    if (prob < offThreshold) {
      // Clear silence.
      if (this.speakingState) {
        this.silenceMs += frameMs;
        if (this.silenceMs >= minSilenceMs) {
          this.speakingState = false;
          this.speechMs = 0;
          return 'speech_end';
        }
      } else {
        // Not yet speaking — decay any accumulated pre-speech blip so noise can't add up.
        this.speechMs = 0;
      }
      return null;
    }

    // In the hysteresis band [offThreshold, onThreshold): hold current state, no counters change.
    return null;
  }

  /** True between speech_start and speech_end. */
  get speaking(): boolean {
    return this.speakingState;
  }

  /** True once any speech_start has fired — used to gate an auto-stop so the initial pre-speech
   *  pause never ends the session. */
  get heardSpeech(): boolean {
    return this.heardSpeechState;
  }

  reset(): void {
    this.speakingState = false;
    this.heardSpeechState = false;
    this.speechMs = 0;
    this.silenceMs = 0;
  }
}

/**
 * Map a frame's RMS energy (normalised [-1,1] PCM) to a pseudo speech-probability, so the same
 * VadGate can run off the energy meter the renderer already computes until the Silero ONNX scorer is
 * wired. Not as robust as Silero in noise, but a strict improvement over no VAD, and it lets the
 * decision logic be shared and tested now.
 */
export function rmsToSpeechProbability(rms: number, floor = 0.006, ceil = 0.05): number {
  if (rms <= floor) return 0;
  if (rms >= ceil) return 1;
  return (rms - floor) / (ceil - floor);
}
