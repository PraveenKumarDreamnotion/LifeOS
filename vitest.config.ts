import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  // The React plugin transforms JSX/TSX for the renderer (jsdom) tests; node tests are .ts and
  // are unaffected by it.
  plugins: [react()],
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/renderer/**/*.test.tsx', // NEW (EP-2): renderer/hook tests run under jsdom
    ],
    globals: false,
    environment: 'node',
    // Renderer tests need a DOM; everything else stays on the fast node environment (38 §1).
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
  },
  resolve: {
    alias: { '@core': resolve(__dirname, 'core') },
  },
});
