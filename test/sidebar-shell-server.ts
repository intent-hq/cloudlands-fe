import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type Plugin } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

export function createSidebarShellServer(
  workerIndex: number,
  name = 'sidebar-shell-background',
  controls: Plugin[] = [],
) {
  const cacheDir = viteHarnessCacheDir(name, { workerIndex });
  console.log(
    'HARNESS_CACHE ' +
      JSON.stringify({
        name,
        worker: workerIndex,
        cacheDir,
        populated: existsSync(resolve(cacheDir, 'deps/_metadata.json')),
      }),
  );
  const chiefStub = resolve(process.cwd(), 'test/fixtures/SidebarShellChiefStub.svelte');
  return createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir,
    plugins: [
      ...controls,
      {
        name: 'sidebar-shell-test-stubs',
        enforce: 'pre',
        resolveId(id) {
          return id.endsWith('/cards/ChiefCard.svelte') ? chiefStub : null;
        },
      },
      svelte({ configFile: resolve(process.cwd(), 'svelte.config.js') }),
    ],
    optimizeDeps: { entries: [] },
    resolve: {
      alias: [
        { find: '$lib', replacement: resolve(process.cwd(), 'src/lib') },
        { find: '$store', replacement: resolve(process.cwd(), 'src/store') },
        { find: '$features', replacement: resolve(process.cwd(), 'src/features') },
        { find: '$shared', replacement: resolve(process.cwd(), 'src/shared') },
        { find: '$app', replacement: resolve(process.cwd(), 'playwright/app-stubs') },
        {
          find: /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
          replacement: resolve(process.cwd(), 'src/lib/icons/phosphor-icons.ts'),
        },
        {
          find: /^svelte-fa$/,
          replacement: resolve(process.cwd(), 'src/lib/components/shared/icons/fa-proxy.ts'),
        },
      ],
    },
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
}
