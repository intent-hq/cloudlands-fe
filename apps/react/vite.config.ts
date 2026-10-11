import { fileURLToPath, URL } from 'node:url';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tanstackStart({
      spa: {
        enabled: true,
        // app://workspaces serves index.html for navigation. Ship dist/client
        // with the same asset-first, index fallback contract at desktop cutover.
        prerender: { outputPath: '/index.html' },
      },
    }),
    react(),
    babel({ include: /\.tsx?$/, plugins: ['module:@preact/signals-react-transform'] }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      $shared: fileURLToPath(new URL('../../src/shared', import.meta.url)),
      $lib: fileURLToPath(new URL('../../src/lib', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', '@preact/signals-react'],
  },
  // The reference app's PostCSS configuration must not run in this renderer.
  css: { postcss: { plugins: [] } },
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
});
