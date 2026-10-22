import { expect } from '@playwright/test';
import { test } from './root-browser-fixtures';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: viteHarnessCacheDir('resource-icon-tile'),
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
  await page.goto(`${baseUrl}src/app.html`);
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
    for (const testId of ['chat-message-navigator-trigger', 'chat-scroll-to-bottom-button']) {
      const icon = menu.getByTestId(testId).locator('svg');
      await expect(icon).toHaveCount(1);
    }
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
  }
});

test('keeps sidebar overflow counts accurate when cards expand', async ({ page }) => {
  // Measure settled card geometry, not the staggered entrance animation.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1800, height: 1400 });
  const scenarios = [
    { theme: 'light', width: 280, zoom: 1, count: 0 },
    { theme: 'dark', width: 360, zoom: 1, count: 0 },
    { theme: 'light', width: 360, zoom: 2, count: 1 },
    { theme: 'dark', width: 280, zoom: 2, count: 1 },
    { theme: 'light', width: 280, zoom: 1, count: 8 },
    { theme: 'dark', width: 360, zoom: 1, count: 8 },
    { theme: 'light', width: 360, zoom: 2, count: 26 },
    { theme: 'dark', width: 280, zoom: 2, count: 26 },
  ] as const;

  for (const scenario of scenarios) {
    await page.goto(`${baseUrl}src/app.html`);
    await page.addStyleTag({ url: `${baseUrl}src/app.css` });
    await page.addStyleTag({ content: 'body { margin: 0; }' });
    await page.evaluate(async (props) => {
      Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
      const [{ mount, tick }, { default: Host }] = await Promise.all([
        import('/@id/svelte'),
        import('/test/fixtures/SidebarLauncherHost.svelte'),
      ]);
      document.body.replaceChildren();
      mount(Host, {
        target: document.body,
        props: {
          width: props.width,
          zoom: props.zoom,
          theme: props.theme,
          selectedTab: 'overview',
          agentCount: props.count,
          noteCount: props.count,
        },
      });
      await tick();
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    }, scenario);

    const expectedBackground = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'bg-sidebar';
      document.body.append(probe);
      const background = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return background;
    });
    const expectSidebarPaint = async () => {
      const styles = await page.locator('[data-sidebar-card-surface]').evaluateAll((surfaces) =>
        surfaces.map((surface) => {
          const style = getComputedStyle(surface);
          return { background: style.backgroundColor, opacity: style.opacity };
        }),
      );
      expect(
        styles.every(({ background }) => background === expectedBackground),
        scenario,
      ).toBe(true);
      expect(
        styles.every(({ opacity }) => opacity === '1'),
        scenario,
      ).toBe(true);
    };
    await expectSidebarPaint();

    for (const [visibleSelector, overflowSelector] of [
      // Upstream avatar stack (0519bd81) exposes overflow through its shared test id.
      ['[data-sidebar-agent]', '[data-testid="sidebar-agent-overflow"]'],
      ['[data-sidebar-context]', '[data-sidebar-context-overflow]'],
    ] as const) {
      const visibleCount = await page.locator(visibleSelector).count();
      const expectedOverflow = scenario.count - visibleCount;
      const overflow = page.locator(overflowSelector);
      if (expectedOverflow > 0) {
        await expect(overflow).toBeVisible();
        await expect(overflow).toContainText(`+${expectedOverflow}`);
      } else {
        await expect(overflow).toHaveCount(0);
      }
    }

    await page.locator('[data-sidebar-launcher="agents"] .launcher-tile-action').click();
    await expect(page.locator('.sidebar-expanded-card')).toBeVisible();
    await expectSidebarPaint();
  }
});
