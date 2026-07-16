import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAiTtsProvider, MAX_TTS_BYTES } from '../../electron/providers/openai-tts-provider';

describe('OpenAiTtsProvider (audio-bytes)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('advertises cloud / audio-bytes', () => {
    const p = new OpenAiTtsProvider(() => 'sk-x');
    expect(p.id).toBe('openai');
    expect(p.kind).toBe('audio-bytes');
    expect(p.isOffline).toBe(false);
  });

  it('POSTs to /audio/speech and returns mp3 bytes', async () => {
    const audio = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(audio, { status: 200 }));
    const p = new OpenAiTtsProvider(() => 'sk-x');
    const r = await p.speak('hello', { voiceId: 'nova', rate: 1.2 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/v1/audio/speech');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer sk-x');
    const body = JSON.parse(opts.body as string);
    expect(body.voice).toBe('nova');
    expect(body.speed).toBeCloseTo(1.2);
    expect(r.kind).toBe('audio-bytes');
    if (r.kind === 'audio-bytes') {
      expect(r.mime).toBe('audio/mpeg');
      expect(r.bytes.byteLength).toBe(4);
    }
  });

  it('an unknown voice id → alloy; an out-of-range rate is clamped', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([0]).buffer, { status: 200 }));
    const p = new OpenAiTtsProvider(() => 'sk-x');
    await p.speak('x', { voiceId: 'bogus', rate: 99 });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.voice).toBe('alloy');
    expect(body.speed).toBe(4.0);
  });

  it('throws without a key (→ Windows fallback in the coordinator)', async () => {
    const p = new OpenAiTtsProvider(() => null);
    await expect(p.speak('x')).rejects.toThrow();
  });

  it('rejects an oversize response instead of returning it (→ fallback)', async () => {
    const big = new Uint8Array(MAX_TTS_BYTES + 1).buffer;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(big, { status: 200 }));
    const p = new OpenAiTtsProvider(() => 'sk-x');
    await expect(p.speak('x')).rejects.toThrow();
  });

  it('a non-ok API response rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const p = new OpenAiTtsProvider(() => 'sk-x');
    await expect(p.speak('x')).rejects.toThrow();
  });
});
