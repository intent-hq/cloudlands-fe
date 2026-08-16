import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await createServer({
    configFile: false,
    root: process.cwd(),
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
      const header = scenario.querySelector<HTMLElement>('[data-panel-tabless-header]')!;
      const leading = header.querySelector<HTMLElement>('[data-panel-header-leading-surface]')!;
      const tile = header.querySelector<HTMLElement>('[data-resource-icon-tile]')!;
      const glyph = tile.querySelector<HTMLElement>('[data-resource-icon-glyph]')!;
      const stripTile = scenario.querySelector<HTMLElement>(
        '[data-panel-tab-bar] [data-resource-icon-tile]',
      )!;
      const probe = scenario.querySelector<HTMLElement>('[data-resource-semantic-probe]')!;
      const listGlyph = scenario.querySelector<HTMLElement>(
        '[data-testid="chat-message-navigator-trigger"] svg',
      )!;
      const arrowGlyph = scenario.querySelector<HTMLElement>(
        '[data-testid="chat-scroll-to-bottom-button"] svg',
      )!;
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
        listWidth: getComputedStyle(listGlyph).width,
        listHeight: getComputedStyle(listGlyph).height,
        arrowWidth: getComputedStyle(arrowGlyph).width,
        arrowHeight: getComputedStyle(arrowGlyph).height,
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
    expect(result.tileWidth, result.scenario).toBe('20px');
    expect(result.tileHeight, result.scenario).toBe('20px');
    expect(result.radius, result.scenario).toBe('6px');
    expect(result.glyphWidth, result.scenario).toBe('12px');
    expect(result.glyphHeight, result.scenario).toBe('12px');
    expect(result.listWidth, result.scenario).toBe('12px');
    expect(result.listHeight, result.scenario).toBe('12px');
    expect(result.arrowWidth, result.scenario).toBe('11px');
    expect(result.arrowHeight, result.scenario).toBe('11px');
    expect(result.kebabWidth, result.scenario).toBe('12px');
    expect(result.kebabHeight, result.scenario).toBe('12px');
    expect(result.closeWidth, result.scenario).toBe('12px');
    expect(result.closeHeight, result.scenario).toBe('12px');
    expect(result.background, result.scenario).toBe(result.expectedBackground);
    expect(result.foreground, result.scenario).toBe(result.expectedForeground);
    expect(result.background, result.scenario).not.toBe('rgba(0, 0, 0, 0)');
    expect(result.stripWidth, result.scenario).toBe('20px');
    expect(result.stripHeight, result.scenario).toBe('20px');
    expect(result.centerX, result.scenario).toBeLessThanOrEqual(0.5);
    expect(result.centerY, result.scenario).toBeLessThanOrEqual(0.5);
    expect(Math.abs(result.leftInset - result.topInset), result.scenario).toBeLessThanOrEqual(0.5);
    expect(Math.abs(result.leftInset - result.bottomInset), result.scenario).toBeLessThanOrEqual(
      0.5,
    );
  }
});

test('keeps sidebar card paint and visible-surface label alignment exact', async ({ page }) => {
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

    if (scenario.count > 0) {
      for (const tabId of ['agents', 'context']) {
        const card = page.locator(`[data-sidebar-launcher="${tabId}"]`);
        const delta = await card.evaluate((element) => {
          const visible = element.querySelector<HTMLElement>('[data-sidebar-launcher-glyph]')!;
          const label = element.querySelector<HTMLElement>('[data-sidebar-launcher-label]')!;
          return Math.abs(
            visible.getBoundingClientRect().left - label.getBoundingClientRect().left,
          );
        });
        expect(
          delta,
          `${scenario.theme}-${scenario.width}-${scenario.zoom}-${scenario.count}`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
    if (scenario.count > 6) {
      await expect(page.locator('[data-sidebar-agent-overflow]')).toContainText(
        `+${scenario.count - 6}`,
      );
      await expect(page.locator('[data-sidebar-context-overflow]')).toContainText(
        `+${scenario.count - 6}`,
      );
    }

    await page.locator('[data-sidebar-launcher="agents"] .launcher-tile-action').click();
    await expect(page.locator('.sidebar-expanded-card')).toBeVisible();
    await expectSidebarPaint();
  }
});
