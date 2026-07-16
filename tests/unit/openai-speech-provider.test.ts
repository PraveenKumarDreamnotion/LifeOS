import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  OpenAiSpeechProvider,
  pcm16ToWav,
  resampleTo16kMono,
} from '../../electron/providers/openai-speech-provider';

describe('resampleTo16kMono', () => {
  it('is a no-op at 16 kHz or for empty input', () => {
    const pcm = new Int16Array([1, 2, 3]);
    expect(resampleTo16kMono(pcm, 16000)).toBe(pcm);
    expect(resampleTo16kMono(new Int16Array(0), 48000).length).toBe(0);
  });

  it('downsamples 48 kHz → 16 kHz by ~1/3 length (box-filter average)', () => {
    const pcm = new Int16Array(48000).map((_, i) => (i % 2 === 0 ? 1000 : -1000));
    const out = resampleTo16kMono(pcm, 48000);
    expect(out.length).toBe(16000);
    // Averaging a symmetric ±1000 window collapses toward ~0 (proves it's not raw decimation).
    expect(Math.abs(out[100]!)).toBeLessThan(500);
  });

  it('downsamples 44.1 kHz → 16 kHz to the expected length', () => {
    const pcm = new Int16Array(44100).fill(500);
    const out = resampleTo16kMono(pcm, 44100);
    expect(out.length).toBe(16000);
    expect(out[0]).toBe(500); // constant signal stays constant through the average
  });

  it('never produces samples outside Int16 range', () => {
    const pcm = new Int16Array(96000).map((_, i) => (i % 3 === 0 ? 32767 : -32768));
    const out = resampleTo16kMono(pcm, 48000);
    for (const s of out) {
      expect(s).toBeGreaterThanOrEqual(-32768);
      expect(s).toBeLessThanOrEqual(32767);
    }
  });
});

describe('pcm16ToWav', () => {
  it('writes a valid 44-byte WAV header + PCM data for the given sample rate', () => {
    const pcm = new Int16Array([0, 100, -100, 32767, -32768]);
    const wav = pcm16ToWav(pcm, 16000);
    expect(wav.length).toBe(44 + pcm.length * 2);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt16LE(20)).toBe(1); // audioFormat = PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(pcm.length * 2);
    expect(wav.readInt16LE(44)).toBe(0);
    expect(wav.readInt16LE(46)).toBe(100);
    expect(wav.readInt16LE(48)).toBe(-100);
  });

  it('reflects a different capture sample rate in the header', () => {
    expect(pcm16ToWav(new Int16Array([1]), 48000).readUInt32LE(24)).toBe(48000);
  });
});

describe('OpenAiSpeechProvider (batch)', () => {
  const frame = (samples: number[]) => new Int16Array(samples).buffer;
  afterEach(() => vi.restoreAllMocks());

  it('advertises batch / no-partials / cloud', () => {
    const p = new OpenAiSpeechProvider(() => 'sk-x');
    expect(p.id).toBe('openai');
    expect(p.supportsPartials).toBe(false);
    expect(p.transport).toBe('batch');
    expect(p.isOffline).toBe(false);
  });

  it('empty utterance → no POST, empty transcript', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(''));
    const p = new OpenAiSpeechProvider(() => 'sk-x');
    await p.start('s', 16000);
    const r = await p.stop('s');
    expect(r.text).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('buffers frames and POSTs once at stop(), returning the trimmed transcript', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('  drink water  ', { status: 200 }));
    const p = new OpenAiSpeechProvider(() => 'sk-x');
    await p.start('s', 16000);
    p.pushAudio('s', frame([1, 2, 3]));
    p.pushAudio('s', frame([4, 5]));
    const r = await p.stop('s');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/v1/audio/transcriptions');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer sk-x');
    expect(r.text).toBe('drink water');
    // The buffer is dropped after stop() — a second stop yields empty (no re-POST).
    const r2 = await p.stop('s');
    expect(r2.text).toBe('');
  });

  it('throws when the key is missing (so withFallback degrades to sherpa)', async () => {
    const p = new OpenAiSpeechProvider(() => null);
    await p.start('s', 16000);
    p.pushAudio('s', frame([1, 2, 3]));
    await expect(p.stop('s')).rejects.toThrow();
  });

  it('a non-ok API response rejects (→ fallback)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const p = new OpenAiSpeechProvider(() => 'sk-x');
    await p.start('s', 16000);
    p.pushAudio('s', frame([1, 2, 3]));
    await expect(p.stop('s')).rejects.toThrow();
  });
});
