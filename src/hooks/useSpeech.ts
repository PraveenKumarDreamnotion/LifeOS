import { useCallback, useEffect, useRef, useState } from 'react';
import type { Result } from '../../core/types/channels';

/**
 * The renderer half of the audio pipe (06 §6): getUserMedia → AudioWorklet (48k→16k PCM16)
 * → speech.pushAudio. Partial/final transcripts arrive over IPC. The speech BRIDGE is injected so
 * the same hook drives the main window (window.lifeos.speech) AND the reminder popup
 * (window.lifeosPopup.speech) — 55 P2-C.
 *
 * Every failure degrades to typed input — the composer is never blocked by speech.
 */
export type MicState = 'idle' | 'initializing' | 'listening' | 'processing' | 'error';

/** The speech IPC surface each window exposes (main + popup both conform). */
export interface SpeechBridge {
  start(sampleRate: number): Promise<Result<{ started: boolean; supportsPartials: boolean }>>;
  stop(): Promise<Result<{ text: string }>>;
  pushAudio(pcm: ArrayBuffer): void;
  onPartial(cb: (t: string) => void): () => void;
  onError(cb: (e: unknown) => void): () => void;
}

const SILENCE_STOP_MS = 2000;
const HARD_CAP_MS = 30000;
/**
 * Energy-gated endpointing (06 §endpointing): a frame whose RMS clears this threshold counts as
 * speech and (re)arms the trailing-silence auto-stop. Crucially this runs for BOTH transports —
 * the old code only bumped the silence timer inside the partial handler, which BATCH providers
 * (OpenAI/whisper.cpp) never emit, so an online dictation ran all the way to HARD_CAP_MS capturing
 * seconds of trailing silence. On normalised [-1,1] PCM, quiet room noise (with getUserMedia
 * noiseSuppression) sits well under this; conversational speech is comfortably above it. A real
 * Silero VAD stage augments this later, but this alone closes the batch endpointing gap.
 */
const SPEECH_RMS_THRESHOLD = 0.01;

export function useSpeech(
  onFinalTranscript: (text: string) => void,
  bridge: SpeechBridge = window.lifeos.speech,
  /** Called right before capture starts — used to STOP Yogi speaking so the mic interrupts it (55 §2). */
  beforeStart?: () => void,
) {
  const [state, setState] = useState<MicState>('idle');
  const [partial, setPartial] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [supportsPartials, setSupportsPartials] = useState(true);
  const [volume, setVolume] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const capTimer = useRef<number | null>(null);
  const silenceTimer = useRef<number | null>(null);
  const activeRef = useRef(false);

  // Refs to prevent stale closures and avoid unnecessary re-subscription churn
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const beforeStartRef = useRef(beforeStart);
  const bridgeRef = useRef(bridge);
  const wantsStopRef = useRef(false);
  const stateRef = useRef(state);

  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
    beforeStartRef.current = beforeStart;
    bridgeRef.current = bridge;
  });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const teardown = useCallback(async () => {
    activeRef.current = false;
    setVolume(0);
    if (capTimer.current) window.clearTimeout(capTimer.current);
    if (silenceTimer.current) window.clearTimeout(silenceTimer.current);
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== 'closed') await ctxRef.current.close();
    ctxRef.current = null;
  }, []);

  const stop = useCallback(async () => {
    wantsStopRef.current = true;
    if (!activeRef.current) {
      setState('idle');
      await teardown();
      return;
    }
    activeRef.current = false;
    setState('processing');
    await teardown();
    const res = await bridgeRef.current.stop();
    setPartial('');
    setState('idle');
    if (res.ok && res.data.text.trim()) onFinalTranscriptRef.current(res.data.text.trim());
  }, [teardown]);

  const bumpSilence = useCallback(() => {
    if (silenceTimer.current) window.clearTimeout(silenceTimer.current);
    silenceTimer.current = window.setTimeout(() => void stop(), SILENCE_STOP_MS);
  }, [stop]);

  // Partial/final subscriptions live for the component's lifetime.
  useEffect(() => {
    const offP = bridge.onPartial((t) => {
      setPartial(t);
      bumpSilence();
    });
    // The final transcript comes solely from stop()'s resolved value — main does not also
    // broadcast it, so there is no double-apply.
    const offE = bridge.onError((e) => {
      const err = e as { code?: string; message?: string };
      setErrorMsg(err.message ?? 'Speech error');
      setState('error');
      void teardown();
    });
    return () => {
      offP();
      offE();
    };
  }, [bridge, bumpSilence, teardown]);

  const start = useCallback(async () => {
    wantsStopRef.current = false;
    beforeStartRef.current?.(); // interrupt any current speech immediately, before we start listening
    setErrorMsg(null);
    setPartial('');
    setState('initializing');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      if (wantsStopRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const ctx = new AudioContext();
      if (wantsStopRef.current) {
        await ctx.close();
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      ctxRef.current = ctx;

      // Tell main the actual capture rate; sherpa resamples it to 16kHz internally.
      const started = await bridgeRef.current.start(ctx.sampleRate);
      if (wantsStopRef.current) {
        await teardown();
        return;
      }
      if (!started.ok) {
        setErrorMsg(started.error.message);
        setState('error');
        await teardown();
        return;
      }
      setSupportsPartials(started.data.supportsPartials);

      await ctx.audioWorklet.addModule(new URL('worklets/pcm16-downsampler.js', window.location.href).toString());
      if (wantsStopRef.current) {
        await teardown();
        return;
      }

      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'pcm16-downsampler');
      node.port.onmessage = (e) => {
        if (!wantsStopRef.current) {
          const buffer = e.data as ArrayBuffer;
          bridgeRef.current.pushAudio(buffer);

          const int16 = new Int16Array(buffer);
          let sum = 0;
          for (let i = 0; i < int16.length; i++) {
            const sample = (int16[i] ?? 0) / 32768.0;
            sum += sample * sample;
          }
          const rms = Math.sqrt(sum / int16.length);
          setVolume(rms);

          // Energy-gated endpointing — transport-agnostic, so BATCH providers also auto-stop on
          // trailing silence instead of running to the 30 s hard cap. The auto-stop timer is armed
          // ONLY by speech frames, so the initial pre-speech pause never triggers a premature stop.
          if (rms >= SPEECH_RMS_THRESHOLD) bumpSilence();
        }
      };
      src.connect(node);
      // The worklet needs to be in the graph, but we don't want to hear the mic.
      node.connect(ctx.destination);
      nodeRef.current = node;

      activeRef.current = true;
      setState('listening');
      capTimer.current = window.setTimeout(() => void stop(), HARD_CAP_MS);
    } catch (e) {
      if (wantsStopRef.current) {
        await teardown();
        return;
      }
      const name = (e as { name?: string }).name;
      setErrorMsg(
        name === 'NotAllowedError'
          ? 'Microphone permission denied. You can still type.'
          : name === 'NotFoundError'
            ? 'No microphone found. You can still type.'
            : 'Microphone unavailable. You can still type.',
      );
      setState('error');
      await teardown();
    }
  }, [teardown, stop, bumpSilence]);

  const toggle = useCallback(() => {
    if (stateRef.current === 'listening' || stateRef.current === 'initializing') void stop();
    else void start();
  }, [start, stop]);

  useEffect(() => () => void teardown(), [teardown]);

  return { state, partial, errorMsg, toggle, supportsPartials, volume };
}
