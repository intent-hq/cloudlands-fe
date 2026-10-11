import { defineConfig } from 'vite';

// Exercise the deployable files without Start's server preview middleware.
// At Electron cutover, copy dist/client into dist/renderer: the existing app://
// handler serves real assets and falls back to index.html for navigation.
export default defineConfig({
  appType: 'spa',
  build: { outDir: 'dist/client' },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
});
