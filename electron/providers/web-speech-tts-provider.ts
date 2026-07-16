/**
 * WebSpeechTtsProvider — the offline TextToSpeechProvider (33 §3), a thin adapter over the
 * existing hidden-audio-window `speechSynthesis` path.
 *
 * EP-1 scope: this provider is INSTALLED and unit-tested but DORMANT — the actual spoken
 * reminder still flows through `trigger-sink.ts`'s existing `tts:speak` send (unchanged in
 * EP-1). `speak()` returns `{kind:'in-window'}` to signal the in-window engine owns playback;
 * the real routing of trigger-sink through this provider, voice enumeration, and the
 * audio:playBytes path all land in EP-4. Keeping it minimal here avoids touching the reliability
 * fan-out before its phase.
 */
import type {
  TextToSpeechProvider,
  TtsOptions,
  TtsSpeakResult,
  TtsVoice,
} from '../../core/tts/tts-provider';

export class WebSpeechTtsProvider implements TextToSpeechProvider {
  readonly id = 'web-speech' as const;
  readonly isOffline = true;
  readonly kind = 'in-window' as const;

  init(): Promise<void> {
    return Promise.resolve();
  }

  /** EP-4 fills this via a `tts:listVoices` round-trip to the audio window; empty in EP-1. */
  listVoices(): Promise<TtsVoice[]> {
    return Promise.resolve([]);
  }

  speak(_text: string, _opts?: TtsOptions): Promise<TtsSpeakResult> {
    return Promise.resolve({ kind: 'in-window' });
  }

  cancel(): void {
    // in-window cancellation is handled in the audio window; no-op here in EP-1.
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
