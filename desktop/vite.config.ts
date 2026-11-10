import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The shell is the only network client (AD-10): the bundle carries no remote URL, and no asset is inlined as data.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: ['..'] } },
  build: { outDir: 'dist', assetsInlineLimit: 0, target: 'es2022' },
  test: { environment: 'jsdom', globals: true, css: false },
});
