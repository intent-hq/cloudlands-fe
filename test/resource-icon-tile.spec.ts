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

test('keeps resource tiles and compact header insets exact across the geometry matrix', async ({
  page,
}) => {
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

  const results = await page.locator('[data-resource-geometry-case]').evaluateAll((cases) =>
    cases.map((scenario) => {
      for (const selector of [
        '[data-panel-tabless-header]',
        '[data-panel-header-leading-surface]',
        '[data-resource-icon-tile]',
        '[data-resource-icon-glyph]',
        '[data-panel-tab-bar] [data-resource-icon-tile]',
        '[data-testid="panel-actions-trigger"] svg',
        '[data-testid="panel-close-button"] svg',
      ]) {
        if (!scenario.querySelector(selector))
          throw new Error(`Missing geometry element: ${selector}`);
      }
      const header = scenario.querySelector<HTMLElement>('[data-panel-tabless-header]')!;
      const leading = header.querySelector<HTMLElement>('[data-panel-header-leading-surface]')!;
      const tile = header.querySelector<HTMLElement>('[data-resource-icon-tile]')!;
      const glyph = tile.querySelector<HTMLElement>('[data-resource-icon-glyph]')!;
      const stripTile = scenario.querySelector<HTMLElement>(
        '[data-panel-tab-bar] [data-resource-icon-tile]',
      )!;
      const probe = scenario.querySelector<HTMLElement>('[data-resource-semantic-probe]')!;
      const kebabGlyph = scenario.querySelector<HTMLElement>(
        '[data-testid="panel-actions-trigger"] svg',
      )!;
      const closeGlyph = scenario.querySelector<HTMLElement>(
        '[data-testid="panel-close-button"] svg',
      )!;
      const headerRect = header.getBoundingClientRect();
      const leadingRect = leading.getBoundingClientRect();
      const tileRect = tile.getBoundingClientRect();
      const glyphRect = glyph.getBoundingClientRect();
      const tileStyle = getComputedStyle(tile);
      const glyphStyle = getComputedStyle(glyph);
      const probeStyle = getComputedStyle(probe);
      return {
        scenario: (scenario as HTMLElement).dataset.resourceGeometryCase,
        scale: Number((scenario as HTMLElement).dataset.zoom),
        width: Number((scenario as HTMLElement).dataset.width),
        kind: tile.dataset.resourceKind,
        tileWidth: tileStyle.width,
        tileHeight: tileStyle.height,
        radius: tileStyle.borderRadius,
        glyphWidth: glyphStyle.width,
        glyphHeight: glyphStyle.height,
        background: tileStyle.backgroundColor,
        foreground: tileStyle.color,
        expectedBackground: probeStyle.backgroundColor,
        expectedForeground: probeStyle.color,
        kebabWidth: getComputedStyle(kebabGlyph).width,
        kebabHeight: getComputedStyle(kebabGlyph).height,
        closeWidth: getComputedStyle(closeGlyph).width,
        closeHeight: getComputedStyle(closeGlyph).height,
        stripWidth: getComputedStyle(stripTile).width,
        stripHeight: getComputedStyle(stripTile).height,
        centerX: Math.abs(
          tileRect.left + tileRect.width / 2 - (glyphRect.left + glyphRect.width / 2),
        ),
        centerY: Math.abs(
          tileRect.top + tileRect.height / 2 - (glyphRect.top + glyphRect.height / 2),
        ),
        leftInset: leadingRect.left - headerRect.left,
        topInset: leadingRect.top - headerRect.top,
        bottomInset: headerRect.bottom - leadingRect.bottom,
      };
    }),
  );

  expect(results).toHaveLength(48);
  for (const result of results) {
    // Panel actions mount in a portal only while their owning menu is open.
    // Bind each measurement to this scenario's trigger, not another panel's menu.
    const scenario = page.locator(`[data-resource-geometry-case="${result.scenario}"]`);
    const trigger = scenario
      .locator('[data-panel-tabless-header]')
      .getByTestId('panel-actions-trigger');
    await trigger.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menuId = await trigger.getAttribute('aria-controls');
    expect(menuId, result.scenario).toBeTruthy();
    const menu = page.locator(`[id="${menuId}"]`);
    await expect(menu).toBeVisible();
    for (const testId of ['chat-message-navigator-trigger', 'chat-scroll-to-bottom-button']) {
      const icon = menu.getByTestId(testId).locator('svg');
      await expect(icon, result.scenario).toHaveCount(1);
      await expect(icon, result.scenario).toHaveCSS('width', '16px');
      await expect(icon, result.scenario).toHaveCSS('height', '16px');
    }
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
    expect(result.tileWidth, result.scenario).toBe('26px');
    expect(result.tileHeight, result.scenario).toBe('26px');
    expect(result.radius, result.scenario).toBe('5px');
    expect(result.glyphWidth, result.scenario).toBe('16px');
    expect(result.glyphHeight, result.scenario).toBe('16px');
    expect(result.kebabWidth, result.scenario).toBe('16px');
    expect(result.kebabHeight, result.scenario).toBe('16px');
    expect(result.closeWidth, result.scenario).toBe('16px');
    expect(result.closeHeight, result.scenario).toBe('16px');
    expect(result.background, result.scenario).toBe(result.expectedBackground);
    expect(result.foreground, result.scenario).toBe(result.expectedForeground);
    expect(result.background, result.scenario).not.toBe('rgba(0, 0, 0, 0)');
    expect(result.stripWidth, result.scenario).toBe('20px');
    expect(result.stripHeight, result.scenario).toBe('20px');
    expect(result.centerX, result.scenario).toBeLessThanOrEqual(0.5);
    expect(result.centerY, result.scenario).toBeLessThanOrEqual(0.5);
    // Header simplification (#2973) uses a centered 26px tile in a 52px header.
    // Its 8px outer inset + 1px selector border + 4px padding is 13px;
    // compact selectors (<=420px) use 6px padding, increasing that inset to 15px.
    expect(result.leftInset / result.scale, result.scenario).toBeCloseTo(
      result.width <= 420 ? 15 : 13,
      1,
    );
    expect(result.topInset / result.scale, result.scenario).toBeCloseTo(13, 1);
    expect(result.bottomInset / result.scale, result.scenario).toBeCloseTo(13, 1);
  }
});
