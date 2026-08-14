import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let baseUrl: string;

test.describe.configure({ mode: 'serial' });

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

async function mountSidebar(
  page: Page,
  options: {
    width: number;
    zoom: number;
    selectedTab: string;
    reducedMotion?: boolean;
    theme?: 'light' | 'dark';
  },
) {
  await page.emulateMedia({ reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference' });
  await page.goto(`${baseUrl}src/app.html`);
  await page.addStyleTag({ url: `${baseUrl}src/app.css` });
  await page.addStyleTag({ content: 'body { margin: 0; }' });
  await page.evaluate(async (props) => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    document.documentElement.classList.toggle('dark', props.theme === 'dark');
    const [{ mount, tick }, { default: Host }] = await Promise.all([
      import('/@id/svelte'),
      import('/test/fixtures/SidebarLauncherHost.svelte'),
    ]);
    document.body.replaceChildren();
    const target = document.createElement('div');
    document.body.append(target);
    mount(Host, { target, props: { ...props, theme: props.theme ?? 'light' } });
    await tick();
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
  }, options);
}

async function mountStripMatrix(
  page: Page,
  options: {
    width: number;
    zoom: number;
    theme: 'light' | 'dark';
    reducedMotion?: boolean;
  },
) {
  await page.emulateMedia({ reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference' });
  await page.goto(`${baseUrl}src/app.html`);
  await page.addStyleTag({ url: `${baseUrl}src/app.css` });
  await page.addStyleTag({ content: 'body { margin: 0; }' });
  await page.evaluate(async ({ width, zoom, theme }) => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    const [{ mount, tick }, { default: Strip }] = await Promise.all([
      import('/@id/svelte'),
      import('/src/lib/components/workspace/SidebarExpandedTabStrip.svelte'),
    ]);
    document.body.replaceChildren();
    document.documentElement.classList.toggle('dark', theme === 'dark');
    for (let count = 2; count <= 8; count += 1) {
      const activeIndices = [...new Set([0, Math.floor(count / 2), count - 1])];
      for (const activeIndex of activeIndices) {
        const target = document.createElement('div');
        target.dataset.stripScenario = `${count}-${activeIndex}`;
        target.style.cssText = `width:${width}px; margin:12px; zoom:${zoom};`;
        document.body.append(target);
        const tabs = Array.from({ length: count }, (_, index) => ({
          id: `tab-${index}`,
          label: `Very long workspace tab label ${index + 1}`,
        }));
        mount(Strip, {
          target,
          props: {
            tabs,
            activeTabId: `tab-${activeIndex}`,
            closeLabel: 'Close tab',
            onActivate: () => {},
          },
        });
      }
    }
    await tick();
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
  }, options);
}

async function boxes(locator: Locator) {
  return locator.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      };
    }),
  );
}

async function cardStyles(locator: Locator) {
  return locator.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        opacity: style.opacity,
        zIndex: Number.parseInt(style.zIndex, 10) || 0,
        borderWidth: style.borderWidth,
        borderColor: style.borderColor,
        radii: [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ],
      };
    }),
  );
}

function expectEqual(values: number[], tolerance = 0.75) {
  expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(tolerance);
}

function expectOverlappingDeck(rects: Array<{ x: number; width: number }>) {
  for (let index = 1; index < rects.length; index += 1) {
    expect(rects[index].x).toBeGreaterThan(rects[index - 1].x);
    expect(rects[index].x).toBeLessThan(rects[index - 1].x + rects[index - 1].width);
  }
}

test('compact grid cards keep equal geometry and padding through hover at narrow and zoomed sizes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 1200 });
  let lightSurfaceBackground: string | undefined;
  for (const geometry of [
    { width: 360, zoom: 1, theme: 'light' as const },
    { width: 280, zoom: 1, theme: 'dark' as const },
    { width: 280, zoom: 1.5, theme: 'light' as const },
    { width: 260, zoom: 2, theme: 'dark' as const },
  ]) {
    await mountSidebar(page, { ...geometry, selectedTab: 'overview' });
    const cards = page.locator('[data-sidebar-launcher-grid] [data-sidebar-launcher]');
    const gridLabels = cards.locator('[data-sidebar-launcher-label]');
    const bottomCards = page.locator('[data-sidebar-compact-bottom-row] > *');
    const bottomButtons = bottomCards.locator('button');
    const surfaces = page.locator('[data-sidebar-card-surface]');
    const launcherLabels = page.locator('[data-sidebar-launcher-label]');
    const rows = bottomCards.locator('[data-sidebar-launcher-row]');
    await expect(cards).toHaveCount(4);
    const before = await boxes(cards);
    const labelsBefore = await boxes(gridLabels);
    const bottomBefore = await boxes(bottomCards);
    const bottomButtonBefore = await boxes(bottomButtons);
    expectEqual(before.slice(0, 2).map(({ width }) => width));
    expectEqual(before.slice(2, 4).map(({ width }) => width));
    expect(new Set(before.map(({ padding }) => padding.join('|'))).size).toBe(1);
    expectEqual(bottomBefore.map(({ width }) => width));
    expect(new Set(bottomButtonBefore.map(({ padding }) => padding.join('|'))).size).toBe(1);
    const surfaceStyles = await cardStyles(surfaces);
    expect(new Set(surfaceStyles.map(({ backgroundColor }) => backgroundColor)).size).toBe(1);
    expect(surfaceStyles.every(({ opacity }) => Number(opacity) === 1)).toBe(true);
    if (geometry.theme === 'dark') {
      await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      expect(lightSurfaceBackground).toBeDefined();
      expect(surfaceStyles[0].backgroundColor).not.toBe(lightSurfaceBackground);
    } else {
      await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
      lightSurfaceBackground = surfaceStyles[0].backgroundColor;
    }
    const fontWeights = await launcherLabels.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).fontWeight),
    );
    expect(fontWeights.every((weight) => Number(weight) >= 600)).toBe(true);
    const rowBoxes = await boxes(rows);
    expect(rowBoxes).toHaveLength(2);
    expectEqual(rowBoxes.map(({ height }) => height));

    await cards.nth(0).hover();
    await page.waitForTimeout(300);
    expect(await boxes(cards)).toEqual(before);
    expect(await boxes(gridLabels)).toEqual(labelsBefore);
    expect(await boxes(bottomCards)).toEqual(bottomBefore);
    await cards.nth(1).hover();
    await page.waitForTimeout(300);
    expect(await boxes(cards)).toEqual(before);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    expect(await boxes(cards)).toEqual(before);
  }
});

test('Browser and Shell compact cards expand into tested six-member deck bodies', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await mountSidebar(page, {
    width: 320,
    zoom: 1,
    selectedTab: 'overview',
    reducedMotion: true,
  });

  const bottomCards = page.locator('[data-sidebar-compact-bottom-row] > *');
  await bottomCards.nth(0).locator('button').first().click();
  const strip = page.locator('[data-sidebar-tab-strip]');
  await expect(strip.locator('[data-sidebar-collapsed-tab]')).toHaveCount(6);
  await expect(strip).toHaveAttribute('data-active-tab', 'browser');
  await expect(page.locator('[data-sidebar-browser-list]')).toBeVisible();

  await strip.locator('[data-sidebar-collapsed-tab][data-active="true"] button').click();
  await bottomCards.nth(1).locator('button').first().click();
  await expect(strip).toHaveAttribute('data-active-tab', 'shell');
  await expect(page.locator('[data-workspace-shell-list]')).toBeVisible();
});

test('tab deck previews inactive tabs without changing current content and transfers close on activation', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 1200 });
  for (const geometry of [
    { width: 360, zoom: 1, theme: 'light' as const },
    { width: 280, zoom: 1, theme: 'dark' as const },
    { width: 280, zoom: 2, theme: 'dark' as const },
  ]) {
    await mountSidebar(page, { ...geometry, selectedTab: 'agents' });
    const strip = page.locator('[data-sidebar-tab-strip]');
    const tabs = strip.locator('[data-sidebar-collapsed-tab]');
    const activeTab = strip.locator('[data-sidebar-collapsed-tab][data-active="true"]');
    const inactiveTabs = strip.locator('[data-sidebar-collapsed-tab]:not([data-active="true"])');
    const expandedCard = page.locator('.sidebar-expanded-card');
    const expandedTab = strip.locator('[data-sidebar-collapsed-tab][data-expanded="true"]');
    const labels = strip.locator('[data-sidebar-tab-strip-label]');
    const closes = strip.locator('[data-sidebar-tab-close]');
    await expect(activeTab).toHaveCount(1);
    await expect(tabs).toHaveCount(6);
    await expect(strip.locator('svg')).toHaveCount(0);
    await expect(expandedTab).toHaveCount(1);
    await expect(labels).toHaveCount(1);
    await expect(closes).toHaveCount(1);
    const stripBefore = await strip.boundingBox();
    const cardBefore = await expandedCard.boundingBox();
    const headerBefore = await expandedCard.locator('h6').first().textContent();
    const activeId = await activeTab.getAttribute('data-sidebar-collapsed-tab');
    const activeBefore = (await boxes(activeTab))[0].width;
    const edgeWidths = (await boxes(inactiveTabs)).map(({ width }) => width);
    expectEqual(edgeWidths);
    expect(activeBefore).toBeGreaterThan(Math.max(...edgeWidths) * 3);
    expectOverlappingDeck(await boxes(tabs));
    const cardSurfaceStyles = await cardStyles(
      page.locator('.sidebar-expanded-card, [data-sidebar-tab-strip] [data-sidebar-card-surface]'),
    );
    expect(new Set(cardSurfaceStyles.map(({ backgroundColor }) => backgroundColor)).size).toBe(1);
    expect(cardSurfaceStyles.every(({ opacity }) => Number(opacity) === 1)).toBe(true);
    expect(cardSurfaceStyles.every(({ borderWidth }) => borderWidth === '1px')).toBe(true);
    expect(new Set(cardSurfaceStyles.map(({ borderColor }) => borderColor)).size).toBe(1);
    const tabButtonStyles = await cardStyles(tabs.locator('button'));
    expect(tabButtonStyles[0].radii[0]).not.toBe('0px');
    expect(tabButtonStyles[0].radii[3]).not.toBe('0px');
    expect(tabButtonStyles[0].radii[1]).toBe('0px');
    expect(tabButtonStyles[0].radii[2]).toBe('0px');
    expect(tabButtonStyles.at(-1)!.radii[0]).toBe('0px');
    expect(tabButtonStyles.at(-1)!.radii[3]).toBe('0px');
    expect(tabButtonStyles.at(-1)!.radii[1]).not.toBe('0px');
    expect(tabButtonStyles.at(-1)!.radii[2]).not.toBe('0px');
    expect(
      tabButtonStyles.slice(1, -1).every(({ radii }) => radii.every((radius) => radius === '0px')),
    ).toBe(true);
    const activeLayer = (await cardStyles(activeTab))[0].zIndex;
    expect(activeLayer).toBeGreaterThan(
      Math.max(...(await cardStyles(inactiveTabs)).map(({ zIndex }) => zIndex)),
    );
    await expect(labels).toBeAttached();
    await expect(activeTab.locator('[data-sidebar-tab-strip-label]')).toHaveCount(1);
    await expect(activeTab.locator('[data-sidebar-tab-close][data-visible="true"]')).toHaveCount(1);

    await inactiveTabs.nth(0).hover();
    await page.waitForTimeout(300);
    const previewId = await inactiveTabs.nth(0).getAttribute('data-sidebar-collapsed-tab');
    await expect(strip).toHaveAttribute('data-active-tab', activeId!);
    await expect(strip).toHaveAttribute('data-preview-tab', previewId!);
    await expect(expandedTab).toHaveAttribute('data-sidebar-collapsed-tab', previewId!);
    await expect(labels).toHaveCount(1);
    await expect(inactiveTabs.nth(0).locator('[data-sidebar-tab-strip-label]')).toHaveCount(1);
    await expect(activeTab.locator('[data-sidebar-tab-strip-label]')).toHaveCount(0);
    await expect(activeTab.locator('[data-sidebar-tab-close]')).toHaveCount(1);
    await expect(activeTab.locator('[data-sidebar-tab-close][data-visible="true"]')).toHaveCount(0);
    const previewLayer = (await cardStyles(inactiveTabs.nth(0)))[0].zIndex;
    const previewLayers = (await cardStyles(tabs)).map(({ zIndex }) => zIndex);
    expect(previewLayer).toBe(Math.max(...previewLayers));
    expect(previewLayers.filter((layer) => layer === previewLayer)).toHaveLength(1);
    const previewButtonStyle = await inactiveTabs
      .nth(0)
      .locator('button')
      .evaluate((button) => {
        const style = getComputedStyle(button);
        return {
          cursor: style.cursor,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          radii: [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomRightRadius,
            style.borderBottomLeftRadius,
          ],
        };
      });
    expect(previewButtonStyle.cursor).toBe('pointer');
    expect(previewButtonStyle.paddingLeft).toBe('16px');
    expect(previewButtonStyle.paddingRight).toBe('16px');
    expect(previewButtonStyle.radii.every((radius) => radius !== '0px')).toBe(true);
    expect((await boxes(inactiveTabs.nth(0)))[0].width).toBeGreaterThan(
      (await boxes(activeTab))[0].width * 3,
    );
    expect(await expandedCard.locator('h6').first().textContent()).toBe(headerBefore);
    expect(await strip.boundingBox()).toEqual(stripBefore);
    expect(await expandedCard.boundingBox()).toEqual(cardBefore);

    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    await expect(strip).not.toHaveAttribute('data-preview-tab', /.+/);
    await expect(expandedTab).toHaveAttribute('data-sidebar-collapsed-tab', activeId!);
    await expect(activeTab.locator('[data-sidebar-tab-close][data-visible="true"]')).toHaveCount(1);

    const keyboardPreview = inactiveTabs.nth(1);
    const keyboardPreviewId = await keyboardPreview.getAttribute('data-sidebar-collapsed-tab');
    await keyboardPreview.locator('button').focus();
    await page.waitForTimeout(300);
    await expect(strip).toHaveAttribute('data-active-tab', activeId!);
    await expect(strip).toHaveAttribute('data-preview-tab', keyboardPreviewId!);
    await expect(expandedTab).toHaveAttribute('data-sidebar-collapsed-tab', keyboardPreviewId!);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(300);
    await expect(expandedTab).toHaveAttribute('data-sidebar-collapsed-tab', activeId!);

    await keyboardPreview.locator('button').focus();
    await keyboardPreview.locator('button').press(geometry.zoom === 1 ? 'Enter' : 'Space');
    await expect(strip).toHaveAttribute('data-active-tab', keyboardPreviewId!);
    const transferredActive = strip.locator(
      `[data-sidebar-collapsed-tab="${keyboardPreviewId}"][data-active="true"]`,
    );
    await expect(transferredActive.locator('[data-sidebar-tab-close]')).toHaveCount(1);
    await expect(strip.locator('[data-sidebar-tab-close]')).toHaveCount(1);
    await expect(transferredActive.locator('[data-sidebar-tab-strip-label]')).toHaveCount(1);
    await transferredActive.locator('[data-sidebar-tab-close]').click();
    await expect(page.locator('[data-sidebar-launcher-grid]')).toBeVisible();
  }
});

test('overlapping deck keeps one text card and current-owned close for every 2–8 tab position', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1800 });
  for (const geometry of [
    { width: 360, zoom: 1, theme: 'light' as const, reducedMotion: true },
    { width: 260, zoom: 2, theme: 'dark' as const, reducedMotion: true },
  ]) {
    await mountStripMatrix(page, geometry);
    for (let count = 2; count <= 8; count += 1) {
      for (const activeIndex of [...new Set([0, Math.floor(count / 2), count - 1])]) {
        const scenario = page.locator(`[data-strip-scenario="${count}-${activeIndex}"]`);
        const strip = scenario.locator('[data-sidebar-tab-strip]');
        const tabs = strip.locator('[data-sidebar-collapsed-tab]');
        const active = strip.locator('[data-sidebar-collapsed-tab][data-active="true"]');
        const inactive = strip.locator('[data-sidebar-collapsed-tab]:not([data-active="true"])');
        const expanded = strip.locator('[data-sidebar-collapsed-tab][data-expanded="true"]');
        await expect(tabs).toHaveCount(count);
        await expect(active).toHaveAttribute('data-sidebar-collapsed-tab', `tab-${activeIndex}`);
        await expect(expanded).toHaveAttribute('data-sidebar-collapsed-tab', `tab-${activeIndex}`);
        await expect(strip.locator('[data-sidebar-tab-strip-label]')).toHaveCount(1);
        await expect(strip.locator('[data-sidebar-tab-close]')).toHaveCount(1);
        await expect(active.locator('[data-sidebar-tab-close][data-visible="true"]')).toHaveCount(
          1,
        );
        await expect(
          strip.locator('svg, [data-status], [data-sidebar-tab-strip-icon]'),
        ).toHaveCount(0);
        const stripBox = await strip.boundingBox();
        const activeWidth = (await boxes(active))[0].width;
        const inactiveWidths = (await boxes(inactive)).map(({ width }) => width);
        expect(activeWidth).toBeGreaterThan(Math.max(...inactiveWidths) * 2);
        expectEqual(inactiveWidths);
        expectOverlappingDeck(await boxes(tabs));
        expect((await boxes(tabs)).every(({ height }) => height === stripBox!.height)).toBe(true);
        const restingRadii = await tabs.evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element.querySelector('button')!);
            return [
              style.borderTopLeftRadius,
              style.borderTopRightRadius,
              style.borderBottomRightRadius,
              style.borderBottomLeftRadius,
            ];
          }),
        );
        expect(restingRadii[0][0]).not.toBe('0px');
        expect(restingRadii[0][3]).not.toBe('0px');
        expect(restingRadii.at(-1)?.[1]).not.toBe('0px');
        expect(restingRadii.at(-1)?.[2]).not.toBe('0px');
        const gaps = await tabs
          .locator('button')
          .evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).columnGap));
        expect(new Set(gaps)).toEqual(new Set(['0px']));
        const horizontalPadding = await tabs.locator('button').evaluateAll((buttons) =>
          buttons.map((button) => {
            const style = getComputedStyle(button);
            return [style.paddingLeft, style.paddingRight];
          }),
        );
        expect(
          horizontalPadding.every(([left, right]) => left === '16px' && right === '16px'),
        ).toBe(true);

        await active.hover();
        await expect(active).toHaveAttribute('data-raised', 'true');
        const activeHoverLayers = (await cardStyles(tabs)).map(({ zIndex }) => zIndex);
        expect((await cardStyles(active))[0].zIndex).toBe(Math.max(...activeHoverLayers));
        const activeHoverRadii = await active.locator('button').evaluate((button) => {
          const style = getComputedStyle(button);
          return [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomRightRadius,
            style.borderBottomLeftRadius,
          ];
        });
        expect(activeHoverRadii.every((radius) => radius !== '0px')).toBe(true);
        await page.mouse.move(0, 0);

        for (let inactiveIndex = 0; inactiveIndex < count - 1; inactiveIndex += 1) {
          const preview = inactive.nth(inactiveIndex);
          const previewId = await preview.getAttribute('data-sidebar-collapsed-tab');
          await preview.hover();
          await expect(strip).toHaveAttribute('data-active-tab', `tab-${activeIndex}`);
          await expect(strip).toHaveAttribute('data-preview-tab', previewId!);
          await expect(expanded).toHaveAttribute('data-sidebar-collapsed-tab', previewId!);
          await expect(preview).toHaveAttribute('data-raised', 'true');
          const previewStyle = await preview.locator('button').evaluate((button) => {
            const style = getComputedStyle(button);
            return {
              cursor: style.cursor,
              radii: [
                style.borderTopLeftRadius,
                style.borderTopRightRadius,
                style.borderBottomRightRadius,
                style.borderBottomLeftRadius,
              ],
            };
          });
          expect(previewStyle.cursor).toBe('pointer');
          expect(previewStyle.radii.every((radius) => radius !== '0px')).toBe(true);
          await expect(strip.locator('[data-sidebar-tab-strip-label]')).toHaveCount(1);
          await expect(active.locator('[data-sidebar-tab-close]')).toHaveCount(1);
          await expect(active.locator('[data-sidebar-tab-close][data-visible="true"]')).toHaveCount(
            0,
          );
          const previewStripBox = await strip.boundingBox();
          expect(previewStripBox?.width).toBe(stripBox?.width);
          expect(previewStripBox?.height).toBe(stripBox?.height);
          expectOverlappingDeck(await boxes(tabs));
          await page.mouse.move(0, 0);
          await expect(expanded).toHaveAttribute(
            'data-sidebar-collapsed-tab',
            `tab-${activeIndex}`,
          );

          await preview.locator('button').focus();
          await expect(preview).toHaveAttribute('data-raised', 'true');
          await expect(strip).toHaveAttribute('data-preview-tab', previewId!);
          await expect(expanded).toHaveAttribute('data-sidebar-collapsed-tab', previewId!);
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          await expect(expanded).toHaveAttribute(
            'data-sidebar-collapsed-tab',
            `tab-${activeIndex}`,
          );
        }
      }
    }
  }
});

test('reduced motion settles tab allocation immediately and mode transitions restore the fixed grid', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1200, height: 1000 });
  await mountSidebar(page, {
    width: 320,
    zoom: 1,
    selectedTab: 'overview',
    reducedMotion: true,
  });
  const initialGrid = page.locator('[data-sidebar-launcher-grid] [data-sidebar-launcher]');
  await expect(initialGrid).toHaveCount(4);
  await initialGrid.nth(0).locator('.launcher-tile-action').click();
  const strip = page.locator('[data-sidebar-tab-strip]');
  const tabs = strip.locator('[data-sidebar-collapsed-tab]');
  const active = strip.locator('[data-sidebar-collapsed-tab][data-active="true"]');
  const inactive = strip.locator('[data-sidebar-collapsed-tab]:not([data-active="true"])');
  const expanded = strip.locator('[data-sidebar-collapsed-tab][data-expanded="true"]');
  await expect(active).toHaveCount(1);
  await expect(tabs).toHaveCount(6);
  const stripBefore = await strip.boundingBox();
  const reducedDuration = await inactive
    .nth(0)
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration));
  expect(reducedDuration).toBeLessThanOrEqual(0.001);
  const activeId = await active.getAttribute('data-sidebar-collapsed-tab');
  const previewId = await inactive.nth(0).getAttribute('data-sidebar-collapsed-tab');
  await inactive.nth(0).hover();
  await expect(strip).toHaveAttribute('data-active-tab', activeId!);
  await expect(strip).toHaveAttribute('data-preview-tab', previewId!);
  await expect(expanded).toHaveAttribute('data-sidebar-collapsed-tab', previewId!);
  await expect(active.locator('[data-sidebar-tab-close][data-visible="true"]')).toHaveCount(0);
  expect(await strip.boundingBox()).toEqual(stripBefore);

  await page.mouse.move(0, 0);
  await expect(expanded).toHaveAttribute('data-sidebar-collapsed-tab', activeId!);
  await expect(active.locator('button')).toHaveAttribute('data-tab-action', 'close');
  await active.locator('[data-sidebar-tab-close]').click();
  const gridCards = page.locator('[data-sidebar-launcher-grid] [data-sidebar-launcher]');
  await expect(gridCards).toHaveCount(4);
  const restored = await boxes(gridCards);
  expectEqual(restored.slice(0, 2).map(({ width }) => width));
  expectEqual(restored.slice(2, 4).map(({ width }) => width));
  expect(new Set(restored.map(({ padding }) => padding.join('|'))).size).toBe(1);
});
