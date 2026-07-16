// Remove regenerable build output to shrink the working tree.
// Everything deleted here is produced by `npm run build` / `build:win` and is gitignored —
// nothing here is source of truth. Safe to run any time; rebuild restores it.
//
//   npm run clean         → delete out/, release/, *.tsbuildinfo
//   npm run clean -- --all → also delete node_modules (a full reset; needs `npm install` after)
import { rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const all = process.argv.includes('--all');

const targets = ['out', 'release'];
if (all) targets.push('node_modules');

for (const t of targets) {
  const p = join(root, t);
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    console.log(`removed ${t}/`);
  }
}

// *.tsbuildinfo (TypeScript incremental caches) live at the repo root.
for (const f of readdirSync(root)) {
  if (f.endsWith('.tsbuildinfo')) {
    rmSync(join(root, f), { force: true });
    console.log(`removed ${f}`);
  }
}

console.log('clean complete.');
