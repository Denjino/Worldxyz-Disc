import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js lands in a single chunk on purpose; the default warning is noise.
    chunkSizeWarningLimit: 700,
  },
});
