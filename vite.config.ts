import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    // three.js is a single 500 kB chunk by design and is split out already;
    // the default 500 kB warning is pure noise on every build.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          // Camera controls has no Three import and stays in the lazy replay
          // chunk. three-mesh-bvh is built as a self-contained local module by
          // replay:camera:vendor so BVH-only Three exports never inflate this
          // eager vendor chunk.
          'replay-camera-vendor': ['camera-controls'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
