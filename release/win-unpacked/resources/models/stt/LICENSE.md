# Speech-to-text model attribution

LifeOS bundles a streaming speech recognition model for offline, on-device transcription.

- **Model:** `sherpa-onnx-streaming-zipformer-en-2023-06-26` (int8 encoder/decoder/joiner + tokens)
- **Source:** k2-fsa / sherpa-onnx project — model release assets
  https://github.com/k2-fsa/sherpa-onnx/releases (tag `asr-models`)
- **Project license:** Apache License 2.0 (https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE)
- **Training data (per the model's upstream README):** English read/narrated speech corpora
  (LibriSpeech and GigaSpeech lineage). Refer to the upstream model card for exact corpora
  and their individual terms.

The model files here (`encoder.onnx`, `decoder.onnx`, `joiner.onnx`, `tokens.txt`) are the
int8-quantized variants, redistributed unmodified.

> ⚠️ Before publishing a public release, re-confirm this specific model's redistribution
> terms against its upstream model card. This file records attribution in good faith based
> on the k2-fsa/sherpa-onnx project license; verify the exact model's terms have not changed.
