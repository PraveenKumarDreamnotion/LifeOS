import { describe, it, expect } from 'vitest';
import {
  DeepgramSpeechProvider,
  buildDeepgramUrl,
  parseDeepgramMessage,
  type DeepgramSocket,
  type DeepgramSocketHandlers,
} from '../../electron/providers/deepgram-speech-provider';

/** A controllable fake Deepgram socket: capture sends, drive lifecycle callbacks from the test. */
function fakeSocket() {
  let handlers!: DeepgramSocketHandlers;
  const sent: (ArrayBuffer | string)[] = [];
  let closed = false;
  const socket: DeepgramSocket = {
    send: (d) => sent.push(d),
    close: () => {
      closed = true;
    },
  };
  const factory = (_url: string, _key: string, h: DeepgramSocketHandlers) => {
    handlers = h;
    return socket;
  };
  const result = (transcript: string, isFinal: boolean) =>
    JSON.stringify({ type: 'Results', is_final: isFinal, channel: { alternatives: [{ transcript }] } });
  return {
    factory,
    sent,
    isClosed: () => closed,
    open: () => handlers.onOpen(),
    message: (transcript: string, isFinal: boolean) => handlers.onMessage(result(transcript, isFinal)),
    raw: (data: string) => handlers.onMessage(data),
    error: (e: unknown) => handlers.onError(e),
    close: () => handlers.onClose(),
  };
}

describe('buildDeepgramUrl', () => {
  it('encodes linear16 mono + interim results + the sample rate', () => {
    const url = buildDeepgramUrl(48000, 'nova-3', 'en');
    expect(url).toContain('wss://api.deepgram.com/v1/listen');
    expect(url).toContain('encoding=linear16');
    expect(url).toContain('sample_rate=48000');
    expect(url).toContain('interim_results=true');
    expect(url).toContain('model=nova-3');
    expect(url).toContain('language=en');
  });
});

describe('parseDeepgramMessage', () => {
  it('extracts the transcript + is_final flag; tolerates non-Results frames', () => {
    expect(parseDeepgramMessage(JSON.stringify({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'hi' }] } }))).toEqual({ transcript: 'hi', isFinal: true });
    expect(parseDeepgramMessage(JSON.stringify({ type: 'Metadata' }))).toBeNull();
    expect(parseDeepgramMessage('not json')).toBeNull();
  });
});

describe('DeepgramSpeechProvider (streaming)', () => {
  it('advertises streaming / partials / cloud', () => {
    const p = new DeepgramSpeechProvider(() => 'dg', fakeSocket().factory);
    expect(p.id).toBe('deepgram');
    expect(p.supportsPartials).toBe(true);
    expect(p.transport).toBe('streaming');
    expect(p.isOffline).toBe(false);
  });

  it('rejects start() without a key (→ withFallback to sherpa)', async () => {
    const p = new DeepgramSpeechProvider(() => null, fakeSocket().factory);
    await expect(p.start('s', 16000)).rejects.toThrow();
  });

  it('buffers frames sent before open, then flushes them on open', async () => {
    const fake = fakeSocket();
    const p = new DeepgramSpeechProvider(() => 'dg', fake.factory);
    const startP = p.start('s', 16000);
    p.pushAudio('s', new Int16Array([1, 2, 3]).buffer); // before open → queued
    fake.open();
    await startP;
    p.pushAudio('s', new Int16Array([4, 5]).buffer); // after open → immediate
    // 2 binary frames flushed/sent (CloseStream string not yet sent).
    expect(fake.sent.filter((d) => d instanceof ArrayBuffer)).toHaveLength(2);
  });

  it('emits interim results as partials and accumulates finals into the transcript', async () => {
    const fake = fakeSocket();
    const p = new DeepgramSpeechProvider(() => 'dg', fake.factory);
    const partials: string[] = [];
    p.on('partial', (r) => partials.push(r.text));
    const startP = p.start('s', 16000);
    fake.open();
    await startP;

    fake.message('call', false); // interim
    fake.message('call mom', true); // final segment 1
    fake.message('tomorrow', false); // interim
    fake.message('tomorrow at nine', true); // final segment 2

    expect(partials).toContain('call'); // interim surfaced
    expect(partials[partials.length - 1]).toBe('call mom tomorrow at nine');

    // stop() sends CloseStream then resolves on the socket close; final = the joined finals.
    const stopP = p.stop('s');
    fake.close(); // server closes after flushing
    const res = await stopP;
    expect(res.text).toBe('call mom tomorrow at nine');
    expect(fake.sent.some((d) => typeof d === 'string' && d.includes('CloseStream'))).toBe(true);
    expect(fake.isClosed()).toBe(true);
  });

  it('surfaces a socket error via the error hook and rejects start', async () => {
    const fake = fakeSocket();
    const p = new DeepgramSpeechProvider(() => 'dg', fake.factory);
    const errors: string[] = [];
    p.on('error', (e) => errors.push(e.code));
    const startP = p.start('s', 16000);
    fake.error(new Error('boom'));
    await expect(startP).rejects.toThrow();
    expect(errors).toContain('engine_error');
  });
});
