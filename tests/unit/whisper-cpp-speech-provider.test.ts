import { describe, it, expect, vi } from 'vitest';
import { WhisperCppSpeechProvider } from '../../electron/providers/whisper-cpp-speech-provider';

const frame = (samples: number[]) => new Int16Array(samples).buffer;

describe('WhisperCppSpeechProvider (offline batch)', () => {
  it('advertises offline / batch / no-partials', () => {
    const p = new WhisperCppSpeechProvider('model.bin', async () => 'x');
    expect(p.id).toBe('whisper-cpp');
    expect(p.isOffline).toBe(true);
    expect(p.transport).toBe('batch');
    expect(p.supportsPartials).toBe(false);
  });

  it('empty utterance → no decode, empty transcript', async () => {
    const transcribe = vi.fn(async () => 'should not run');
    const p = new WhisperCppSpeechProvider('model.bin', transcribe);
    await p.start('s', 16000);
    const r = await p.stop('s');
    expect(r.text).toBe('');
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('buffers frames, decodes once at stop(), returns the trimmed transcript', async () => {
    const transcribe = vi.fn(async (pcm: Float32Array) => {
      expect(pcm).toBeInstanceOf(Float32Array);
      expect(pcm.length).toBe(5); // 16k passthrough (no resample) → same length
      return '  drink water  ';
    });
    const p = new WhisperCppSpeechProvider('model.bin', transcribe);
    await p.start('s', 16000);
    p.pushAudio('s', frame([1, 2, 3]));
    p.pushAudio('s', frame([4, 5]));
    const r = await p.stop('s');
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(r.text).toBe('drink water');
  });

  it('passes the language hint from StartOptions', async () => {
    const transcribe = vi.fn(async (_pcm: Float32Array, lang: string) => lang);
    const p = new WhisperCppSpeechProvider('model.bin', transcribe);
    await p.start('s', 16000, { language: 'hi' });
    p.pushAudio('s', frame([1, 2, 3]));
    const r = await p.stop('s');
    expect(r.text).toBe('hi');
  });

  it('a decode failure throws (→ withFallback to sherpa)', async () => {
    const p = new WhisperCppSpeechProvider('model.bin', async () => {
      throw new Error('native boom');
    });
    await p.start('s', 16000);
    p.pushAudio('s', frame([1, 2, 3]));
    await expect(p.stop('s')).rejects.toThrow();
  });
});
