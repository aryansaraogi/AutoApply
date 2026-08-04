import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Content scripts declared in an MV3 manifest are classic scripts — no ESM, no
 * code splitting. Library mode with the IIFE format gives us exactly one self-
 * contained dist/content.js.
 *
 * emptyOutDir is off because this build runs after the main one and must not
 * delete its output.
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { '@': dir('./src') },
  },
  build: {
    outDir: dir('./dist'),
    emptyOutDir: false,
    target: 'chrome116',
    // See vite.config.ts — the store build drops sourcemaps.
    sourcemap: mode !== 'release',
    lib: {
      entry: dir('./src/content/index.ts'),
      formats: ['iife'],
      name: 'AutoApply',
      fileName: () => 'content.js',
    },
  },
}));
