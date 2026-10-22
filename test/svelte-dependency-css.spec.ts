import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';
import { svelteDependencyCss } from './vite-svelte-dependency-css.mjs';

let server: ViteDevServer | undefined;
let baseUrl: string;

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: viteHarnessCacheDir('svelte-dependency-css'),
    plugins: [svelteDependencyCss(), svelte({ configFile: resolve('svelte.config.js') })],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, watch: null },
  });
  await server.listen();
  baseUrl = server.resolvedUrls!.local[0];
});

test.afterAll(async () => server?.close());

test('applies the unbundled dependency stylesheet to a visible toast', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const failedStyles: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('type=style') && !response.ok()) {
      failedStyles.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(`${baseUrl}src/app.html`);
  await page.evaluate(async () => {
    const [{ mount, tick }, { Toaster, toast }] = await Promise.all([
      import('/@id/svelte'),
      import('/node_modules/svelte-sonner/dist/index.js'),
    ]);
    document.body.replaceChildren();
    mount(Toaster, { target: document.body, props: { position: 'bottom-right' } });
    toast('Dependency stylesheet loaded', { duration: Infinity });
    await tick();
  });
  await expect(page.getByText('Dependency stylesheet loaded')).toBeVisible();
  await expect(page.locator('[data-sonner-toaster]')).toHaveCSS('position', 'fixed');
  await expect(page.locator('[data-sonner-toast]')).toHaveCSS('position', 'absolute');
  await expect(page.locator('[data-sonner-toast]')).toHaveCSS('opacity', '1');
  await expect(page.locator('[data-sonner-toast]')).toBeInViewport({ ratio: 1 });
  expect(failedStyles).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('dependency-css.png') });
});
