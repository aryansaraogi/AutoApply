import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Builds everything that MV3 allows to be an ES module: the service worker and
 * the two extension pages. The content script cannot be an ES module when it is
 * declared in the manifest, so it gets its own IIFE build (vite.content.config.ts).
 *
 * `root: 'src'` keeps the HTML entries from landing in dist/src/... — with it,
 * src/options.html emits as dist/options.html, which is what manifest.json expects.
 */
export default defineConfig({
  root: dir('./src'),
  publicDir: dir('./public'),
  // Extension pages load from chrome-extension://<id>/, so relative asset URLs
  // resolve correctly regardless of where a page ends up in the bundle.
  base: './',
  resolve: {
    alias: { '@': dir('./src') },
  },
  build: {
    outDir: dir('./dist'),
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: true,
    rollupOptions: {
      input: {
        'service-worker': dir('./src/background/service-worker.ts'),
        options: dir('./src/options.html'),
        sidepanel: dir('./src/sidepanel.html'),
        tracker: dir('./src/tracker.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
