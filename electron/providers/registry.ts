/**
 * Provider registry (33 §5) — the factory that decides, from settings, which concrete provider
 * backs each seam. The rest of the app asks for "the speech/tts/llm provider" and never sees a
 * concrete class. Factories are pure functions re-run when the relevant setting changes (the
 * same live-rebind that fixes D1); they are cheap and not long-lived objects.
 *
 * EP-1 ships only the OFFLINE concrete providers. Every seam resolves offline because no cloud
 * provider is enabled — the cloud branches are documented stubs the later phases fill:
 *   EP-3 → OpenAiSpeechProvider, EP-4 → OpenAiTtsProvider, EP-5 → OpenAiLlmProvider.
 * The `withFallback` decorator is real and unit-tested now so those phases wrap their cloud
 * provider with the offline provider as the always-present backup.
 */
import { WebSpeechTtsProvider } from './web-speech-tts-provider';
import { OpenAiSpeechProvider } from './openai-speech-provider';
import { OpenAiTtsProvider } from './openai-tts-provider';
import { OpenAiLlmProvider } from './openai-llm-provider';
import { OpenAiSearchProvider } from './openai-search-provider';
import { OpenAiTranscriptCleaner } from './openai-transcript-cleaner';
import { DeepgramSpeechProvider, type DeepgramSocketFactory } from './deepgram-speech-provider';
import type {
  SpeechProvider,
  SpeechSessionId,
  SpeechFinalResult,
  SpeechPartialResult,
  SpeechError,
  SpeechStartOptions,
} from '../../core/speech/speech-provider';
import type { TextToSpeechProvider } from '../../core/tts/tts-provider';
import type { LlmProvider } from '../../core/llm/llm-provider';
import type { SearchProvider } from '../../core/search/search-provider';
import type { TranscriptCleaner } from '../../core/speech/transcript-cleanup';

/** A snapshot of the settings the factories key on — decoupled from the repo for testability. */
export interface ProviderConfig {
  sttProvider: string; // 'sherpa-onnx' | 'openai'
  ttsProvider: string; // 'web-speech' | 'openai'
  aiProvider: string; // 'openai' | 'ollama' | ...
  aiEnabled: boolean;
  hasApiKey: boolean;
  sttConsented: boolean;
  ttsConsented: boolean;
  sttModel: string; // e.g. 'gpt-4o-mini-transcribe'
  aiConsented: boolean;
  aiModel: string; // e.g. 'gpt-4o-mini'
  webSearchEnabled: boolean;
  searchModel: string; // e.g. 'gpt-4o-mini-search-preview'
  /** Track A: run the post-STT LLM cleanup pass on dictation (online-only, reuses AI consent). */
  sttCleanupEnabled: boolean;
}

/** Main-only dependencies the cloud providers need: the key (read at call time) and the cached
 *  offline provider used both as the offline primary and the withFallback backup. */
export interface SpeechProviderDeps {
  getKey: () => string | null;
  sherpa: () => SpeechProvider;
  /** Optional offline whisper.cpp provider (N-API). Present once the native module + model exist;
   *  absent → selecting 'whisper-cpp' falls back to sherpa. */
  whisperCpp?: () => SpeechProvider;
  /** Optional Deepgram wiring: a dedicated Deepgram key + a WebSocket transport adapter. Present
   *  once a Deepgram key store + `ws` adapter are wired; absent → selecting 'deepgram' falls back to
   *  sherpa. Kept optional so the streaming-cloud seam ships tested without a second secret store. */
  deepgram?: { getKey: () => string | null; socketFactory: DeepgramSocketFactory; model?: string };
}

/** A speech-provider factory: resolves the concrete provider for one setting value. A cloud entry
 *  self-gates on key+consent and wraps itself in withFallback(sherpa); adding a provider is exactly
 *  one entry here — no call site changes (33 §5). Unknown/off → the offline default (sherpa). */
type SpeechFactory = (cfg: ProviderConfig, deps: SpeechProviderDeps) => SpeechProvider;

const SPEECH_PROVIDERS: Record<string, SpeechFactory> = {
  'sherpa-onnx': (_cfg, deps) => deps.sherpa(),
  openai: (cfg, deps) => {
    // Cloud preferred only when keyed + consented; otherwise stay offline. sherpa is the
    // ALWAYS-present backup so a bad key/network at init/start/stop degrades transparently.
    if (!(cfg.hasApiKey && cfg.sttConsented)) return deps.sherpa();
    return withFallback(new OpenAiSpeechProvider(deps.getKey, cfg.sttModel), deps.sherpa);
  },
  // Offline batch whisper.cpp (N-API). Present once the native module + model are installed; the
  // provider itself degrades to sherpa on any load/decode failure, and if not wired at all we stay
  // on sherpa here. No consent gate — it's on-device, like sherpa.
  'whisper-cpp': (_cfg, deps) => (deps.whisperCpp ? withFallback(deps.whisperCpp(), deps.sherpa) : deps.sherpa()),
  // Streaming cloud (Deepgram). Needs its own key + consent + a socket transport; when unwired or
  // unconsented, stay offline. Always behind the sherpa fallback.
  deepgram: (cfg, deps) => {
    if (!deps.deepgram || !cfg.sttConsented || !deps.deepgram.getKey()) return deps.sherpa();
    return withFallback(
      new DeepgramSpeechProvider(deps.deepgram.getKey, deps.deepgram.socketFactory, deps.deepgram.model),
      deps.sherpa,
    );
  },
};

/** Register a provider factory (used by the engine phase to add whisper-cpp / deepgram without
 *  editing this function). Idempotent overwrite by id. */
export function registerSpeechProvider(id: string, factory: SpeechFactory): void {
  SPEECH_PROVIDERS[id] = factory;
}

export function makeSpeechProvider(cfg: ProviderConfig, deps: SpeechProviderDeps): SpeechProvider {
  const factory = SPEECH_PROVIDERS[cfg.sttProvider];
  return factory ? factory(cfg, deps) : deps.sherpa();
}

/** TTS cloud dep: the key, read in main at call time for the /audio/speech POST. */
export interface TtsProviderDeps {
  getKey: () => string | null;
}

export function makeTtsProvider(cfg: ProviderConfig, deps: TtsProviderDeps): TextToSpeechProvider {
  const wantsCloud = cfg.ttsProvider === 'openai' && cfg.hasApiKey && cfg.ttsConsented;
  // Cloud TTS is preferred; the trigger-sink / preview coordinator degrades to the Windows
  // (in-window) voice on any failure — the fallback needs the audio-window reference, so it lives
  // there rather than in a provider wrapper (33 §3.2).
  if (wantsCloud) return new OpenAiTtsProvider(deps.getKey);
  return new WebSpeechTtsProvider();
}

/** LLM cloud dep: the key, read in main at call time for the /chat/completions POST. */
export interface LlmProviderDeps {
  getKey: () => string | null;
}

export function makeLlmProvider(cfg: ProviderConfig, deps: LlmProviderDeps): LlmProvider | null {
  const wantsCloud = cfg.aiEnabled && cfg.hasApiKey && cfg.aiConsented && cfg.aiProvider === 'openai';
  // EP-5: the conversation LLM. null = "no conversation" → the engine degrades to the local
  // parser (reminders) / the offline placeholder (chat) — exactly the pre-EP-5 behaviour.
  if (wantsCloud) return new OpenAiLlmProvider(deps.getKey, cfg.aiModel);
  return null;
}

/** The web_search backend (57) — present when AI assist is on+keyed+consented and web search isn't
 *  turned off. Provider-agnostic seam; today's backend is OpenAI (Brave/Tavily drop in later). */
export function makeSearchProvider(cfg: ProviderConfig, deps: LlmProviderDeps): SearchProvider | null {
  const wantsCloud = cfg.webSearchEnabled && cfg.aiEnabled && cfg.hasApiKey && cfg.aiConsented && cfg.aiProvider === 'openai';
  if (wantsCloud) return new OpenAiSearchProvider(deps.getKey, cfg.searchModel);
  return null;
}

/** The post-STT cleanup pass backend (Track A). Present when AI assist is on+keyed+consented and the
 *  cleanup kill switch is on; null → dictation is returned raw. Reuses the conversation key/model. */
export function makeTranscriptCleaner(cfg: ProviderConfig, deps: LlmProviderDeps): TranscriptCleaner | null {
  const wants = cfg.sttCleanupEnabled && cfg.aiEnabled && cfg.hasApiKey && cfg.aiConsented && cfg.aiProvider === 'openai';
  if (wants) return new OpenAiTranscriptCleaner(deps.getKey, cfg.aiModel);
  return null;
}

/**
 * withFallback — wraps a streaming SpeechProvider so that if the primary's init()/start()/stop()
 * rejects, it transparently swaps to a lazily-created backup for the rest of its lifetime. Used
 * by the cloud STT phase (EP-3) to make OpenAI degrade to sherpa on any error. Unit-tested now.
 */
export function withFallback(primary: SpeechProvider, makeBackup: () => SpeechProvider): SpeechProvider {
  return new FallbackSpeechProvider(primary, makeBackup);
}

class FallbackSpeechProvider implements SpeechProvider {
  private active: SpeechProvider;
  private swapped = false;
  private readonly handlers: Array<
    ['partial', (r: SpeechPartialResult) => void] | ['error', (e: SpeechError) => void]
  > = [];

  constructor(
    private readonly primary: SpeechProvider,
    private readonly makeBackup: () => SpeechProvider,
  ) {
    this.active = primary;
  }

  get id() {
    return this.active.id;
  }
  get supportsPartials() {
    return this.active.supportsPartials;
  }
  get isOffline() {
    return this.active.isOffline;
  }
  get transport() {
    return this.active.transport;
  }

  private swapToBackup(): void {
    if (this.swapped) return;
    this.swapped = true;
    this.active = this.makeBackup();
    // Re-attach any handlers registered before the swap.
    for (const h of this.handlers) {
      if (h[0] === 'partial') this.active.on('partial', h[1]);
      else this.active.on('error', h[1]);
    }
  }

  async init(): Promise<void> {
    try {
      await this.active.init();
    } catch {
      this.swapToBackup();
      await this.active.init();
    }
  }

  async start(session: SpeechSessionId, sampleRate: number, options?: SpeechStartOptions): Promise<void> {
    try {
      await this.active.start(session, sampleRate, options);
    } catch {
      this.swapToBackup();
      await this.active.start(session, sampleRate, options);
    }
  }

  pushAudio(session: SpeechSessionId, pcm16: ArrayBuffer): void {
    this.active.pushAudio(session, pcm16);
  }

  async stop(session: SpeechSessionId): Promise<SpeechFinalResult> {
    try {
      return await this.active.stop(session);
    } catch {
      this.swapToBackup();
      return this.active.stop(session);
    }
  }

  dispose(): Promise<void> {
    return this.active.dispose();
  }

  on(event: 'partial', cb: (r: SpeechPartialResult) => void): void;
  on(event: 'error', cb: (e: SpeechError) => void): void;
  on(event: 'partial' | 'error', cb: (arg: never) => void): void {
    if (event === 'partial') this.handlers.push(['partial', cb as unknown as (r: SpeechPartialResult) => void]);
    else this.handlers.push(['error', cb as unknown as (e: SpeechError) => void]);
    (this.active.on as (e: typeof event, c: typeof cb) => void)(event, cb);
  }
}
