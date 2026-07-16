/**
 * Downloads the offline speech-to-text model into resources/models/stt/.
 *
 * The model (~68MB int8) is not committed to git. Run this once before building from source
 * or packaging a release:  node scripts/fetch-stt-model.mjs
 *
 * Model: sherpa-onnx-streaming-zipformer-en-2023-06-26 (k2-fsa / sherpa-onnx, Apache 2.0).
 */
import { existsSync, mkdirSync, createWriteStream, renameSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const DEST = join(process.cwd(), 'resources', 'models', 'stt');
const NAME = 'sherpa-onnx-streaming-zipformer-en-2023-06-26';
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${NAME}.tar.bz2`;

if (existsSync(join(DEST, 'encoder.onnx'))) {
  console.log('STT model already present — nothing to do.');
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });
const archive = join(DEST, 'model.tar.bz2');

console.log(`Downloading ${NAME} …`);
const res = await fetch(MODEL_URL);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));

console.log('Extracting …');
// Extract with cwd=DEST and a RELATIVE archive name: passing an absolute Windows path
// (C:\…) makes tar misread the drive-colon as a remote host. `-xf` auto-detects bzip2 on
// both git-bash GNU tar and the bsdtar shipped on Windows/CI runners.
execFileSync('tar', ['-xf', 'model.tar.bz2'], { cwd: DEST, stdio: 'inherit' });
rmSync(archive);

// Flatten: keep the int8 variants under simple names + tokens; discard the rest.
const dir = join(DEST, NAME);
const pick = (glob) => readdirSync(dir).find((f) => f.includes(glob) && f.endsWith('.int8.onnx'));
renameSync(join(dir, pick('encoder')), join(DEST, 'encoder.onnx'));
renameSync(join(dir, pick('decoder')), join(DEST, 'decoder.onnx'));
renameSync(join(dir, pick('joiner')), join(DEST, 'joiner.onnx'));
renameSync(join(dir, 'tokens.txt'), join(DEST, 'tokens.txt'));
rmSync(dir, { recursive: true, force: true });

console.log('✅ STT model ready in resources/models/stt/');
