import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const FORBIDDEN_SHELL = [
  {
    name: 'child_process',
    message: 'Forbidden. See docs/lifeos-planning/11-electron-security-architecture.md §7.',
  },
  {
    name: 'node:child_process',
    message: 'Forbidden. See docs/lifeos-planning/11-electron-security-architecture.md §7.',
  },
];

const NODE_GLOBALS = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  require: 'readonly',
  module: 'writable',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly',
  NodeJS: 'readonly',
};

export default tseslint.config(
  { ignores: ['out/**', 'release/**', 'node_modules/**', 'dist/**', 'resources/**', 'public/worklets/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Node-side code: main process, spikes, build scripts, config.
  {
    files: ['electron/**/*.{ts,cjs}', 'scripts/**/*.{mjs,cjs}', '*.config.{ts,js}', 'tests/**/*.ts'],
    languageOptions: { globals: NODE_GLOBALS, sourceType: 'commonjs' },
  },

  // ── Global prohibitions (11 §7) ────────────────────────────────────────────
  {
    rules: {
      'no-restricted-imports': ['error', { paths: FORBIDDEN_SHELL }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Build/dev scripts (not app code, never shipped): may use require, console, and
  // child_process (e.g. `tar` to extract the model). MUST come after the global
  // prohibitions block so this override wins. The child_process ban targets the APP
  // executing shell from user/LLM input — not build tooling.
  {
    files: ['scripts/**/*.{cjs,mjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // ── core/ must stay pure TypeScript (14 §4) ────────────────────────────────
  // This single rule is what keeps the framework decision reversible and lets
  // the parser fixtures run without an Electron harness.
  {
    files: ['core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'electron',
                'electron/*',
                'node:*',
                'fs',
                'path',
                'os',
                'child_process',
                '../electron/*',
                '../src/*',
              ],
              message: 'core/ must stay pure. Only luxon, chrono-node and zod are allowed. See 14 §4.',
            },
          ],
        },
      ],
    },
  },

  // ── The single allowlisted exception (07 §3.2, 11 §7) ──────────────────────
  // Only reachable if SPIKE-3 fails and the SAPI TTS fallback is taken.
  // The command must be a module constant; text is passed on stdin, never interpolated.
  {
    files: ['electron/tts/sapi-tts-service.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // The reset service is the ONLY file permitted to import fs for deletion (10 §10).
  {
    files: ['electron/services/reset-service.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // The STT service lazily require()s the native addon so it isn't loaded for typed-only
  // sessions. The main build externalizes sherpa-onnx-node.
  {
    files: ['electron/speech/sherpa-speech-service.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // Spike code is throwaway CommonJS runners; require() and console are expected.
  {
    files: ['electron/spikes/**/*.{ts,cjs}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
