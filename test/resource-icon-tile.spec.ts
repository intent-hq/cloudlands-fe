import { expect } from '@playwright/test';
import { test } from './root-browser-fixtures';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';
import { prepareRootHarnessModules } from './root-harness-import';

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async ({}, workerInfo) => {
  test.setTimeout(120_000);
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: viteHarnessCacheDir('resource-icon-tile', { workerIndex: workerInfo.workerIndex }),
    plugins: [svelte({ configFile: resolve(process.cwd(), 'svelte.config.js') })],
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
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
});

test.afterAll(async () => server?.close());

test('opens and dismisses resource panel action menus', async ({ page }) => {
  test.setTimeout(120_000);
  await prepareRootHarnessModules(page, baseUrl, [
    '/@id/svelte',
    '/test/fixtures/ResourceIconGeometryHost.svelte',
  ]);
  await page.addStyleTag({ url: `${baseUrl}src/app.css` });
  await page.evaluate(async () => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    const [{ mount, tick }, { default: Host }] = await Promise.all([
      import('/@id/svelte'),
      import('/test/fixtures/ResourceIconGeometryHost.svelte'),
    ]);
    document.body.replaceChildren();
    mount(Host, { target: document.body });
    await tick();
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
  });

  for (const scenario of await page.locator('[data-resource-geometry-case]').all()) {
    const trigger = scenario
      .locator('[data-panel-tabless-header]')
      .getByTestId('panel-actions-trigger');
    await trigger.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menuId = await trigger.getAttribute('aria-controls');
    expect(menuId).toBeTruthy();
    const menu = page.locator(`[id="${menuId}"]`);
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
  }
});
