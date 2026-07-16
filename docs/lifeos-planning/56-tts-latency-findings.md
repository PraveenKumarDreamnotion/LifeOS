# 56 — TTS Latency: findings & the streaming fix

> **Symptom (reported):** Yogi shows the text reply instantly, then there's a **several-second
> pause** before it starts speaking. Only with **OpenAI voice** (the offline Windows voice speaks
> immediately). **Fix:** stream the audio and play it as it arrives.

---

## 1. Where the delay was

Traced the whole pipeline (renderer → engine → TTS → audio window):

```
LLM reply ready ─▶ chat:done (text shown) ─▶ engine.onSpeak(reply)
   ─▶ speakText() ─▶ speakThroughAudioWindow()
        └─ provider.speak(text)  ◀── THE BOTTLENECK
              await fetch('/v1/audio/speech')          (OpenAI generates the audio)
              await res.arrayBuffer()                  (wait for the WHOLE mp3 to download)
        ─▶ audio window: new Blob(bytes) ─▶ <audio>.play()
```

**The bottleneck is `await provider.speak()`** (`openai-tts-provider.ts`): it waited for the
**entire** clip to be generated *and* fully downloaded before returning a single blob — and only
then did playback start. For a multi-sentence reply, `gpt-4o-mini-tts` generating the full clip is
the several seconds. Everything *after* the bytes arrive (blob → `<audio>`) was already fast; IPC,
decode, and playback init were **not** the problem. The Windows voice felt instant because it
generates locally, sentence-by-sentence, with no network round-trip.

`RULED OUT`: OpenAI *chat* latency (the text was already shown), audio buffering, IPC size, renderer
init. The single cause was **full-clip-generate-then-play**.

---

## 2. The fix — stream the audio (play on first bytes)

`RECOMMENDATION (implemented)` — OpenAI's `/v1/audio/speech` returns a **chunked** response; we now
read the body **as a stream** and forward chunks to the audio window, which plays them incrementally
via **MediaSource Extensions (MSE)**. Time-to-first-audio drops from "whole clip generated" to
"first chunk arrives" (~a network round-trip).

```
provider.speakStream(text)  ─▶ returns res.body (ReadableStream), no full-download await
   coordinator reads chunks ─▶ audio:ttsStart{mime} ─▶ audio:ttsChunk × N ─▶ audio:ttsEnd
   audio window: MediaSource + SourceBuffer.appendBuffer(chunk)  ─▶ <audio> plays as it fills
```

**Files:** `core/tts/tts-provider.ts` (optional `speakStream`), `openai-tts-provider.ts` (the
streaming fetch), `electron/main/tts/speak.ts` (`streamToWindow` forwards chunks),
`electron/preload/audio.ts` (`onTtsStart/Chunk/End/Abort`), `src/audio-host.ts` (MSE player).

### Safety / no-regression guarantees
- **Blob fallback:** if `MediaSource.isTypeSupported('audio/mpeg')` is false, or `addSourceBuffer`
  throws, the audio window **accumulates chunks and plays one blob on end** — i.e. exactly the old
  behaviour, never worse.
- **Failure handling:** a fetch failure **before** any audio played falls back to the Windows voice
  (as before); a **mid-stream** failure has already started speaking, so we **don't** double-speak.
- **Reminders / Preview unchanged:** they still use the full-blob `speak()` path (a short reminder
  title has no perceivable benefit from streaming; the streaming path is used for chat replies).
- **CSP unchanged:** MSE uses a `blob:` object URL for `<audio>.src`, already allowed by
  `media-src 'self' blob:`.

### Considered & rejected
- `Sentence-chunking` (speak sentence 1, generate the rest in parallel): simpler playback but N
  requests + splitting heuristics, and still slower first-audio than true streaming. Rejected.
- `Windows voice by default`: instant but lower quality; the user chose OpenAI voice. Not a fix.

---

## 3. Manual test (Test 1)

Ask **"Tell me a joke."** with OpenAI voice on → text appears instantly, and Yogi **starts speaking
within ~a second** (no multi-second pause). On a build/OS where MSE mp3 is unsupported, it still
works via the blob fallback (as before). `FUTURE OPTION`: `opus`/`pcm` formats or a lower-latency
voice model if further tuning is wanted.
