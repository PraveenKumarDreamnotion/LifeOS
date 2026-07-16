/**
 * TextToSpeechProvider interface — the seam for swapping the voice engine (33 §3). Pure.
 *
 * `kind` decides the playback path (33 §3.1): 'in-window' providers (Windows speechSynthesis)
 * speak directly in the hidden audio window; 'audio-bytes' providers (OpenAI TTS) return audio
 * bytes the app must play via the audio:playBytes path (built in EP-4). EP-1 ships only the
 * offline in-window provider (WebSpeechTtsProvider); the audio-bytes field exists now so the
 * interface is stable when EP-4 fills the cloud branch.
 */

export type TtsProviderId = 'web-speech' | 'windows-sapi' | 'openai' | 'elevenlabs';

export interface TtsVoice {
  id: string;
  name: string;
  lang: string;
  isDefault: boolean;
}

export interface TtsOptions {
  voiceId?: string;
  rate?: number;
}

export type TtsSpeakResult =
  | { kind: 'in-window' } // already spoken via the in-window engine
  | { kind: 'audio-bytes'; mime: string; bytes: ArrayBuffer }; // caller must play the bytes

export interface TextToSpeechProvider {
  readonly id: TtsProviderId;
  readonly isOffline: boolean;
  readonly kind: 'in-window' | 'audio-bytes';

  init(): Promise<void>;
  listVoices(): Promise<TtsVoice[]>;
  speak(text: string, opts?: TtsOptions): Promise<TtsSpeakResult>;
  cancel(): void;
  dispose(): Promise<void>;

  /**
   * Optional (55 §TTS latency): stream the audio as it generates, so playback can start on the
   * FIRST bytes instead of after the whole clip. Returns the response body stream + its mime; the
   * coordinator forwards chunks to the audio window (MediaSource). Absent → the full-blob path.
   */
  speakStream?(text: string, opts: TtsOptions, signal: AbortSignal): Promise<{ mime: string; body: ReadableStream<Uint8Array> }>;
}
