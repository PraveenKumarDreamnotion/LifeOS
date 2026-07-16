/**
 * AudioWorklet: capture mic audio (Float32 at the device's native rate, e.g. 48kHz),
 * convert to Int16 PCM, and post ~100ms frames. Runs on the audio thread.
 *
 * It does NOT downsample. sherpa-onnx resamples internally from the input rate to the model's
 * 16kHz using a proper continuous-stream resampler — cleaner than a per-128-block resample in
 * the worklet, which introduced boundary artifacts and hurt recognition. The renderer passes
 * the actual sample rate to the main process so the recogniser knows the input rate.
 */
class Pcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~100ms frame at the native rate → responsive partials, small IPC payloads.
    this.frameSamples = Math.round(sampleRate * 0.1); // `sampleRate` is a worklet global
    this.acc = new Int16Array(this.frameSamples);
    this.fill = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0]; // mono, first channel
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      let s = input[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      this.acc[this.fill++] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      if (this.fill === this.frameSamples) {
        const frame = this.acc.slice(0); // copy; keep this.acc for reuse
        this.port.postMessage(frame.buffer, [frame.buffer]);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm16-downsampler', Pcm16Capture);
