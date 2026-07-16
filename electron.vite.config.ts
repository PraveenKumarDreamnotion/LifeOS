import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') },
        // Native modules must never be bundled by Rollup.
        // `sherpa-onnx-node` is the native N-API addon; `sherpa-onnx` (unused) is the
        // WebAssembly build. See SPIKE-2 in 25-risk-register.md §2.
        external: ['sherpa-onnx-node', 'better-sqlite3'],
      },
    },
    resolve: {
      alias: { '@core': resolve(__dirname, 'core') },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          audio: resolve(__dirname, 'electron/preload/audio.ts'),
          popup: resolve(__dirname, 'electron/preload/popup.ts'),
          launcher: resolve(__dirname, 'electron/preload/launcher.ts'),
        },
        // CommonJS, one file per entry. A sandboxed preload cannot use ESM imports
        // and cannot require() across files, so nothing may be code-split out.
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },

  renderer: {
    root: resolve(__dirname, 'src'),
    // Serve project-root public/ (the AudioWorklet) at the renderer root. A worklet must be
    // a real fetchable file — it cannot be bundled into the main chunk (06 §6.3).
    publicDir: resolve(__dirname, 'public'),
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/index.html'),
          'audio-host': resolve(__dirname, 'src/audio-host.html'),
          popup: resolve(__dirname, 'src/popup.html'),
          launcher: resolve(__dirname, 'src/launcher.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@core': resolve(__dirname, 'core'),
      },
    },
  },
});
