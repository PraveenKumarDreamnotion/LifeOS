import { describe, it, expect } from 'vitest';
import { VadGate, rmsToSpeechProbability } from '../../core/speech/vad';

const cfg = { onThreshold: 0.5, offThreshold: 0.35, minSilenceMs: 600, minSpeechMs: 120, frameMs: 30 };

/** Push n frames of a constant probability, collecting any events. */
function pushN(gate: VadGate, prob: number, n: number): (string | null)[] {
  return Array.from({ length: n }, () => gate.push(prob));
}

describe('VadGate', () => {
  it('does not start on a sub-minSpeech blip of speech', () => {
    const g = new VadGate(cfg);
    // 3 frames = 90ms < minSpeechMs 120ms → no start yet.
    expect(pushN(g, 0.9, 3).filter(Boolean)).toEqual([]);
    expect(g.speaking).toBe(false);
    expect(g.heardSpeech).toBe(false);
  });

  it('fires speech_start once minSpeechMs of speech accrues', () => {
    const g = new VadGate(cfg);
    const events = pushN(g, 0.9, 5).filter(Boolean); // 150ms ≥ 120ms
    expect(events).toEqual(['speech_start']);
    expect(g.speaking).toBe(true);
    expect(g.heardSpeech).toBe(true);
  });

  it('fires speech_end only after minSilenceMs of trailing silence', () => {
    const g = new VadGate(cfg);
    pushN(g, 0.9, 5); // start speaking
    // 600ms of silence needed → 20 frames of 30ms. 19 frames = 570ms: no end yet.
    expect(pushN(g, 0.0, 19).filter(Boolean)).toEqual([]);
    expect(g.speaking).toBe(true);
    // The 20th frame reaches 600ms → endpoint.
    expect(g.push(0.0)).toBe('speech_end');
    expect(g.speaking).toBe(false);
  });

  it('a brief silence dip below minSilenceMs does not end speech, and resets the silence timer', () => {
    const g = new VadGate(cfg);
    pushN(g, 0.9, 5); // speaking
    pushN(g, 0.0, 10); // 300ms silence (< 600ms)
    expect(g.speaking).toBe(true);
    pushN(g, 0.9, 2); // speech again → resets silence
    // Now needs a full 600ms again.
    expect(pushN(g, 0.0, 19).filter(Boolean)).toEqual([]);
    expect(g.push(0.0)).toBe('speech_end');
  });

  it('the hysteresis band holds state (no flapping between thresholds)', () => {
    const g = new VadGate(cfg);
    pushN(g, 0.9, 5); // speaking
    // prob 0.4 is between off(0.35) and on(0.5) → hold, never ends.
    expect(pushN(g, 0.4, 100).filter(Boolean)).toEqual([]);
    expect(g.speaking).toBe(true);
  });

  it('heardSpeech stays false through pure silence/noise (gates a premature auto-stop)', () => {
    const g = new VadGate(cfg);
    pushN(g, 0.1, 50);
    expect(g.heardSpeech).toBe(false);
    expect(g.speaking).toBe(false);
  });

  it('reset() clears all state', () => {
    const g = new VadGate(cfg);
    pushN(g, 0.9, 5);
    g.reset();
    expect(g.speaking).toBe(false);
    expect(g.heardSpeech).toBe(false);
  });
});

describe('rmsToSpeechProbability', () => {
  it('maps quiet→0, loud→1, and interpolates between', () => {
    expect(rmsToSpeechProbability(0.001)).toBe(0);
    expect(rmsToSpeechProbability(0.2)).toBe(1);
    const mid = rmsToSpeechProbability(0.028, 0.006, 0.05);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
