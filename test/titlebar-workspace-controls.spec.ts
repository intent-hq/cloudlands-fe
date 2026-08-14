import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let baseUrl = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    optimizeDeps: { noDiscovery: true, include: ['bits-ui', 'svelte'] },
    plugins: [svelte({ configFile: resolve(process.cwd(), 'svelte.config.js') })],
    resolve: {
      alias: [
        {
          find: '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors',
          replacement: resolve(process.cwd(), 'test/fixtures/titlebar-control-store.ts'),
        },
        {
          find: '$store/renderer/slices/sidebar-nav/sidebar-nav-slice',
          replacement: resolve(process.cwd(), 'test/fixtures/titlebar-control-store.ts'),
        },
        {
          find: '$store/renderer/slices/tab-state/tab-state-selectors',
          replacement: resolve(process.cwd(), 'test/fixtures/titlebar-control-store.ts'),
        },
        {
          find: '$features/workspace/workspace-view-mode-action',
          replacement: resolve(process.cwd(), 'test/fixtures/titlebar-control-store.ts'),
        },
        {
          find: '$store/renderer/store',
          replacement: resolve(process.cwd(), 'test/fixtures/titlebar-control-store.ts'),
        },
        {
          find: /.*\/sidebar-nav\/SidebarNavHoverCard\.svelte$/,
          replacement: resolve(process.cwd(), 'test/fixtures/EmptyComponent.svelte'),
        },
        { find: '$lib', replacement: resolve(process.cwd(), 'src/lib') },
        { find: '$store', replacement: resolve(process.cwd(), 'src/store') },
        { find: '$features', replacement: resolve(process.cwd(), 'src/features') },
        { find: '$shared', replacement: resolve(process.cwd(), 'src/shared') },
        { find: '$app', replacement: resolve(process.cwd(), 'playwright/app-stubs') },
      ],
    },
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => server?.close());

async function mountControls(page: Page, theme: 'light' | 'dark', zoom: number) {
  await page.goto(baseUrl + 'test/fixtures/titlebar-controls.html');
  await page.addStyleTag({ url: baseUrl + 'src/app.css' });
  await page.evaluate(
    async ({ theme, zoom }) => {
      Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
      const [{ mount, tick }, { default: Harness }] = await Promise.all([
        import('/@id/svelte'),
        import('/test/fixtures/TitlebarWorkspaceControlsHarness.svelte'),
      ]);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.body.replaceChildren();
      const target = document.createElement('div');
      target.style.zoom = String(zoom);
      document.body.append(target);
      mount(Harness, { target });
      await tick();
    },
    { theme, zoom },
  );
}

test('mounts accepted control geometry and shortcut tooltips', async ({ page }, testInfo) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const theme of ['light', 'dark'] as const) {
      for (const zoom of [1, 2]) {
        await mountControls(page, theme, zoom);
        const controls = [
          page.locator('[data-titlebar-spaces-control]'),
          page.locator('[data-fixture-control="layout"] button'),
          page.locator('[data-workspace-repo-launcher] button'),
        ];
        for (const control of controls) {
          const box = await control.boundingBox();
          expect(box?.width).toBeCloseTo(32 * zoom, 0);
          expect(box?.height).toBeCloseTo(32 * zoom, 0);
          await expect(control).not.toHaveAttribute('title', /.+/);
        }
        const glyphs = [
          page.locator('[data-titlebar-spaces-control] svg'),
          page.locator('[data-fixture-control="layout"] svg'),
          page.locator('[data-workspace-repo-launcher] svg'),
        ];
        for (const glyph of glyphs) {
          const box = await glyph.boundingBox();
          expect(box?.width).toBeCloseTo(16 * zoom, 0);
          expect(box?.height).toBeCloseTo(16 * zoom, 0);
          expect(await glyph.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
        }
        await controls[1].hover();
        await expect(page.locator('[data-tooltip-label]')).toBeVisible();
        await expect(page.locator('[data-tooltip-shortcut]')).toContainText(/L/);
        if (reducedMotion === 'no-preference' && zoom === 1) {
          await testInfo.attach(theme + '-titlebar-controls', {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        }
      }
    }
  }
});
