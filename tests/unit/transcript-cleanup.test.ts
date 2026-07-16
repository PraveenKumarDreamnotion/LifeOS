import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldCleanTranscript, acceptCleanup } from '../../core/speech/transcript-cleanup';
import { OpenAiTranscriptCleaner } from '../../electron/providers/openai-transcript-cleaner';

describe('shouldCleanTranscript', () => {
  it('skips empty, trivial, and single-word transcripts', () => {
    expect(shouldCleanTranscript('')).toBe(false);
    expect(shouldCleanTranscript('   ')).toBe(false);
    expect(shouldCleanTranscript('yes')).toBe(false); // single token
    expect(shouldCleanTranscript('okay')).toBe(false);
  });
  it('cleans real multi-word dictation', () => {
    expect(shouldCleanTranscript('remind me to call mom tomorrow')).toBe(true);
  });
});

describe('acceptCleanup', () => {
  it('strips wrapping quotes the model sometimes adds', () => {
    expect(acceptCleanup('hello world', '"Hello world."')).toBe('Hello world.');
  });
  it('falls back to raw when cleanup is empty', () => {
    expect(acceptCleanup('hello world', '   ')).toBe('hello world');
  });
  it('falls back to raw when the output ballooned (it answered instead of cleaning)', () => {
    const raw = 'what is the capital of france';
    const rambled =
      'The capital of France is Paris, a city with a long and storied history spanning many ' +
      'centuries, world-famous for its art, cuisine, museums, and the iconic Eiffel Tower.';
    expect(acceptCleanup(raw, rambled)).toBe(raw);
  });
});

describe('OpenAiTranscriptCleaner', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to chat completions and returns the cleaned text', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'Call mom tomorrow.' } }] }), { status: 200 }),
    );
    const cleaner = new OpenAiTranscriptCleaner(() => 'sk-x');
    const out = await cleaner.clean('call mom tomorrow um');
    expect(out).toBe('Call mom tomorrow.');
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/v1/chat/completions');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer sk-x');
  });

  it('throws without a key (so the caller keeps the raw transcript)', async () => {
    const cleaner = new OpenAiTranscriptCleaner(() => null);
    await expect(cleaner.clean('some text here')).rejects.toThrow();
  });

  it('throws on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 429 }));
    const cleaner = new OpenAiTranscriptCleaner(() => 'sk-x');
    await expect(cleaner.clean('some text here')).rejects.toThrow();
  });
});
