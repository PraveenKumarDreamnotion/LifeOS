/**
 * Generates placeholder PNG icons so Day-1 spikes can run.
 * Real branding assets replace these before Day 7.
 *
 * Writes a filled ring in the LifeOS orange brand colour (#F97316) with a transparent centre.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function makePng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r = size / 2 - 0.5;
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const dx = x - r, dy = y - r;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const inside = dist <= r * 0.95;
      const dot = dist <= r * 0.32;
      if (dot) {
        raw[p++] = 0xff; raw[p++] = 0xff; raw[p++] = 0xff; raw[p++] = 0xff;
      } else if (inside) {
        raw[p++] = 0xf9; raw[p++] = 0x73; raw[p++] = 0x16; raw[p++] = 0xff; // LifeOS orange #F97316
      } else {
        raw[p++] = 0; raw[p++] = 0; raw[p++] = 0; raw[p++] = 0;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['assets/icons/tray.png', 32],
  ['assets/icons/tray@2x.png', 64],
  ['assets/icons/icon.png', 512],
  ['build/icon.png', 512],
];

for (const [rel, size] of targets) {
  const abs = join(process.cwd(), rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, makePng(size));
  console.log(`wrote ${rel} (${size}x${size})`);
}
