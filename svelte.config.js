import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Web profile: `INTENT_BUILD_TARGET=web` (set by dev:web / build:web) builds
// the renderer for a plain browser. Output goes to dist/web so it never
// clobbers the Electron renderer bundle in dist/renderer.
const isWebBuild = process.env.INTENT_BUILD_TARGET === 'web';
const outputDir = isWebBuild ? 'dist/web' : 'dist/renderer';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://kit.svelte.dev/docs/integrations#preprocessors
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  // Svelte 5 requires this compatibility setting when used with SvelteKit 2.x
  // because SvelteKit's client.js uses `new app.root({...})` to instantiate components,
  // but Svelte 5 components are no longer classes.
  // See: https://svelte.dev/docs/svelte/v5-migration-guide#Components-are-no-longer-classes
  compilerOptions: {
    compatibility: {
      componentApi: 4,
    },
  },

  kit: {
    // adapter-static for SPA mode (no SSR)
    adapter: adapter({
      // dist/renderer for Electron, dist/web for the browser profile
      pages: outputDir,
      assets: outputDir,
      fallback: 'index.html',
      precompress: false,
      strict: true,
    }),

    // Override the default app template
    appDir: 'app',

    // Prerender settings
    prerender: {
      entries: [],
    },

    // Configure paths for Electron using app:// protocol
    // Use absolute paths since the protocol handler serves from a consistent root
    // This prevents refresh issues on nested routes like /workspace/abc123
    paths: {
      base: '',
      assets: '',
      relative: false,
    },

    // Alias configuration
    alias: {
      $lib: './src/lib',
      $store: './src/store',
      $features: './src/features',
      $shared: './src/shared',
    },
  },

  // Note: Vite configuration is in vite.config.mjs
  // Do NOT add a vite: block here - it conflicts with vite.config.mjs
};

export default config;
