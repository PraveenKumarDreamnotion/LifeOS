/**
 * OpenAiTranscriptCleaner (Track A) — the cloud backend for the post-STT cleanup pass. A single
 * cheap /chat/completions call with the hardened cleanup prompt and temperature 0 (deterministic,
 * format-only). Reuses the app's existing OpenAI key + consent (read in main at call time, never
 * over IPC). Bounded by a tight timeout; any failure throws so the caller keeps the raw transcript.
 */
import type { TranscriptCleaner } from '../../core/speech/transcript-cleanup';
import { CLEANUP_SYSTEM_PROMPT, acceptCleanup } from '../../core/speech/transcript-cleanup';

const CLEANUP_TIMEOUT_MS = 8_000;
/** A small, fast, cheap model is plenty for formatting — this is not a reasoning task. */
const DEFAULT_MODEL = 'gpt-4o-mini';

interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
}

export class OpenAiTranscriptCleaner implements TranscriptCleaner {
  readonly id = 'openai';

  constructor(
    private readonly getKey: () => string | null,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async clean(raw: string, signal?: AbortSignal): Promise<string> {
    const key = this.getKey();
    if (!key) throw new Error('no_key');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLEANUP_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 400,
          messages: [
            { role: 'system', content: CLEANUP_SYSTEM_PROMPT },
            // The transcript is untrusted input — the system prompt already forbids obeying it.
            { role: 'user', content: raw },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`openai_cleanup_${res.status}`);
      const data = (await res.json()) as ChatCompletion;
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('empty_response');
      // Distrust an output that ballooned (a sign it answered instead of cleaning) → raw.
      return acceptCleanup(raw, content);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
}
