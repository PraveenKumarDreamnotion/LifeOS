import { describe, it, expect } from 'vitest';
import { makeSpeechProvider, makeTtsProvider, makeLlmProvider, makeSearchProvider, makeTranscriptCleaner, withFallback, registerSpeechProvider, type ProviderConfig } from '../../electron/providers/registry';
import type {
  SpeechProvider,
  SpeechSessionId,
  SpeechFinalResult,
  SpeechPartialResult,
  SpeechError,
} from '../../core/speech/speech-provider';

const OFFLINE_CFG: ProviderConfig = {
  sttProvider: 'sherpa-onnx',
  ttsProvider: 'web-speech',
  aiProvider: 'openai',
  aiEnabled: false,
  hasApiKey: false,
  sttConsented: false,
  ttsConsented: false,
  sttModel: 'gpt-4o-mini-transcribe',
  aiConsented: false,
  aiModel: 'gpt-4o-mini',
  webSearchEnabled: false,
  searchModel: 'gpt-4o-mini-search-preview',
  sttCleanupEnabled: false,
};

// Offline deps: a fake sherpa factory (avoids constructing the real native provider) and no key.
const offlineDeps = { getKey: () => null as string | null, sherpa: () => fakeProvider('sherpa-onnx') };

describe('provider registry — speech', () => {
  it('makeSpeechProvider returns the offline (sherpa) provider by default', () => {
    const p = makeSpeechProvider(OFFLINE_CFG, offlineDeps);
    expect(p.id).toBe('sherpa-onnx');
    expect(p.isOffline).toBe(true);
    expect(p.transport).toBe('streaming');
    expect(p.supportsPartials).toBe(true);
  });

  it('stays offline when OpenAI is selected but not keyed/consented', () => {
    const p1 = makeSpeechProvider({ ...OFFLINE_CFG, sttProvider: 'openai', hasApiKey: false, sttConsented: true }, offlineDeps);
    expect(p1.id).toBe('sherpa-onnx');
    const p2 = makeSpeechProvider({ ...OFFLINE_CFG, sttProvider: 'openai', hasApiKey: true, sttConsented: false }, offlineDeps);
    expect(p2.id).toBe('sherpa-onnx');
  });

  it('EP-3: returns OpenAI batch (behind a sherpa fallback) when enabled + keyed + consented', () => {
    const p = makeSpeechProvider(
      { ...OFFLINE_CFG, sttProvider: 'openai', hasApiKey: true, sttConsented: true },
      { getKey: () => 'sk-test-key', sherpa: () => fakeProvider('sherpa-onnx') },
    );
    expect(p.id).toBe('openai'); // fallback delegates to the active (OpenAI) provider
    expect(p.isOffline).toBe(false);
    expect(p.supportsPartials).toBe(false); // batch → no live partials
    expect(p.transport).toBe('batch');
  });

  it('an unknown/unregistered stt_provider value falls back to the offline default', () => {
    const p = makeSpeechProvider({ ...OFFLINE_CFG, sttProvider: 'does-not-exist' }, offlineDeps);
    expect(p.id).toBe('sherpa-onnx');
  });

  it('registerSpeechProvider adds a new provider as one map entry (no factory edit)', () => {
    registerSpeechProvider('fake-engine', () => fakeProvider('whisper-cpp'));
    const p = makeSpeechProvider({ ...OFFLINE_CFG, sttProvider: 'fake-engine' }, offlineDeps);
    expect(p.id).toBe('whisper-cpp');
  });

  it('makeTtsProvider returns the offline in-window provider by default', () => {
    const p = makeTtsProvider(OFFLINE_CFG, { getKey: () => null });
    expect(p.id).toBe('web-speech');
    expect(p.isOffline).toBe(true);
    expect(p.kind).toBe('in-window');
  });

  it('EP-4: makeTtsProvider returns OpenAI (audio-bytes) when enabled + keyed + consented', () => {
    const p = makeTtsProvider(
      { ...OFFLINE_CFG, ttsProvider: 'openai', hasApiKey: true, ttsConsented: true },
      { getKey: () => 'sk-test-key' },
    );
    expect(p.id).toBe('openai');
    expect(p.isOffline).toBe(false);
    expect(p.kind).toBe('audio-bytes');
  });

  it('stays on Windows when OpenAI TTS is selected but not keyed/consented', () => {
    const p = makeTtsProvider({ ...OFFLINE_CFG, ttsProvider: 'openai', hasApiKey: false, ttsConsented: true }, { getKey: () => null });
    expect(p.id).toBe('web-speech');
  });

  it('makeLlmProvider returns null when AI assist is disabled / unkeyed / unconsented', () => {
    const deps = { getKey: () => null as string | null };
    expect(makeLlmProvider(OFFLINE_CFG, deps)).toBeNull();
    // enabled + keyed but NOT consented → still null (consent is a hard gate)
    expect(makeLlmProvider({ ...OFFLINE_CFG, aiEnabled: true, hasApiKey: true, aiConsented: false }, deps)).toBeNull();
    // consented + keyed but NOT enabled → null
    expect(makeLlmProvider({ ...OFFLINE_CFG, aiEnabled: false, hasApiKey: true, aiConsented: true }, deps)).toBeNull();
  });

  it('HYBRID "cloud voice recognition only": OpenAI STT while LLM/TTS/search stay LOCAL', () => {
    // The desired mode = cloud STT + everything-else-local. The provider gates are independent, so
    // this is achievable with no new architecture: STT→openai (keyed+consented), AI Assist OFF,
    // Voice→Windows, web search OFF. Prove each seam resolves the intended provider.
    const cfg: ProviderConfig = {
      ...OFFLINE_CFG,
      hasApiKey: true,
      sttProvider: 'openai',
      sttConsented: true, // cloud STT on
      aiEnabled: false, // NO cloud LLM
      aiConsented: false,
      ttsProvider: 'web-speech', // local voice
      webSearchEnabled: false, // no web search
      sttCleanupEnabled: false, // no cloud cleanup pass
    };
    const speech = makeSpeechProvider(cfg, { getKey: () => 'sk', sherpa: () => fakeProvider('sherpa-onnx') });
    expect(speech.id).toBe('openai'); // cloud STT (behind the always-present sherpa fallback)
    expect(speech.isOffline).toBe(false);
    expect(makeLlmProvider(cfg, { getKey: () => 'sk' })).toBeNull(); // no OpenAI text generation
    expect(makeSearchProvider(cfg, { getKey: () => 'sk' })).toBeNull(); // no web search
    expect(makeTranscriptCleaner(cfg, { getKey: () => 'sk' })).toBeNull(); // no cloud cleanup
    expect(makeTtsProvider(cfg, { getKey: () => 'sk' }).id).toBe('web-speech'); // local voice
  });

  it('makeTranscriptCleaner is null unless AI on + keyed + consented + kill switch on', () => {
    const deps = { getKey: () => 'sk' as string | null };
    expect(makeTranscriptCleaner(OFFLINE_CFG, deps)).toBeNull();
    // AI fully on but cleanup kill switch off → null
    expect(makeTranscriptCleaner({ ...OFFLINE_CFG, aiEnabled: true, hasApiKey: true, aiConsented: true, sttCleanupEnabled: false }, deps)).toBeNull();
    // everything on → a cleaner
    const c = makeTranscriptCleaner({ ...OFFLINE_CFG, aiEnabled: true, hasApiKey: true, aiConsented: true, sttCleanupEnabled: true }, deps);
    expect(c?.id).toBe('openai');
  });

  it('EP-5: makeLlmProvider returns OpenAiLlmProvider when enabled + keyed + consented', () => {
    const p = makeLlmProvider(
      { ...OFFLINE_CFG, aiEnabled: true, hasApiKey: true, aiConsented: true },
      { getKey: () => 'sk-test-key' },
    );
    expect(p).not.toBeNull();
    expect(p?.id).toBe('openai');
    expect(p?.isLocal).toBe(false);
    expect(p?.supportsStreaming).toBe(false);
  });
});

// A controllable fake SpeechProvider for the fallback decorator.
function fakeProvider(id: SpeechProvider['id'], opts: { failStart?: boolean } = {}): SpeechProvider & { started: string[] } {
  const started: string[] = [];
  return {
    started,
    id,
    supportsPartials: true,
    isOffline: id === 'sherpa-onnx',
    transport: 'streaming',
    init: () => Promise.resolve(),
    start: (session: SpeechSessionId) => {
      if (opts.failStart) return Promise.reject(new Error('start failed'));
      started.push(session);
      return Promise.resolve();
    },
    pushAudio: () => {},
    stop: (session: SpeechSessionId): Promise<SpeechFinalResult> =>
      Promise.resolve({ sessionId: session, text: id, durationMs: 1 }),
    dispose: () => Promise.resolve(),
    on: (_e: 'partial' | 'error', _cb: (a: SpeechPartialResult | SpeechError) => void) => {},
  } as SpeechProvider & { started: string[] };
}

describe('withFallback', () => {
  it('uses the primary when it succeeds', async () => {
    const primary = fakeProvider('openai');
    const wrapped = withFallback(primary, () => fakeProvider('sherpa-onnx'));
    await wrapped.start('s1', 16000);
    const final = await wrapped.stop('s1');
    expect(final.text).toBe('openai');
    expect(primary.started).toEqual(['s1']);
  });

  it('transparently swaps to the backup when the primary start() fails', async () => {
    const backup = fakeProvider('sherpa-onnx');
    const wrapped = withFallback(fakeProvider('openai', { failStart: true }), () => backup);
    await wrapped.start('s1', 16000); // primary rejects → backup runs
    const final = await wrapped.stop('s1');
    expect(final.text).toBe('sherpa-onnx');
    expect(backup.started).toEqual(['s1']);
  });
});
