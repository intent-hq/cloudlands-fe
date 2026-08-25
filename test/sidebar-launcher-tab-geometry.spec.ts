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
    agentCount?: number;
    noteCount?: number;
    description?: string;
    hasPullRequest?: boolean;
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
    const [{ mount, tick }, { default: Strip }, icons] = await Promise.all([
      import('/@id/svelte'),
      import('/src/lib/components/workspace/SidebarExpandedTabStrip.svelte'),
      import('/src/lib/icons/phosphor-icons.ts'),
    ]);
    document.body.replaceChildren();
    document.documentElement.classList.toggle('dark', theme === 'dark');
    for (const count of [2, 6, 8]) {
      const activeIndices = [...new Set([0, Math.floor(count / 2), count - 1])];
      for (const activeIndex of activeIndices) {
        const target = document.createElement('div');
        target.dataset.stripScenario = `${count}-${activeIndex}`;
        target.style.cssText = `width:${width}px; margin:12px; zoom:${zoom};`;
        document.body.append(target);
        const tabIcons = [
          icons.faRobot,
          icons.faAlignLeft,
          icons.faCode,
          icons.faFolderTree,
          icons.faGlobe,
          icons.faTerminal,
          icons.faFile,
          icons.faGear,
        ];
        const tabs = Array.from({ length: count }, (_, index) => ({
          id: `tab-${index}`,
          label: `Very long workspace tab label ${index + 1}`,
          icon: tabIcons[index],
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

function expectSegmentedDeck(rects: Array<{ x: number; width: number }>) {
  for (let index = 1; index < rects.length; index += 1) {
    expect(rects[index].x).toBeGreaterThan(rects[index - 1].x);
    expect(
      Math.abs(rects[index].x - (rects[index - 1].x + rects[index - 1].width)),
    ).toBeLessThanOrEqual(1);
  }
}

test('Agents card shares adaptive stack geometry at boundary counts', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1200, height: 1000 });
  for (const agentCount of [1, 26]) {
    for (const theme of ['light'] as const) {
      for (const zoom of [1]) {
        await mountSidebar(page, {
          width: 260,
          zoom,
          theme,
          selectedTab: 'overview',
          agentCount,
          noteCount: 3,
        });
        for (const direction of ['ltr', 'rtl'] as const) {
          await page.evaluate((dir) => {
            document.documentElement.dir = dir;
          }, direction);
          const card = page.locator('[data-sidebar-launcher="agents"]');
          const stack = card.locator('[data-agent-avatar-stack]');
          await expect
            .poll(() => stack.locator('[data-agent-avatar-stack-item]').count())
            .toBeGreaterThan(0);
          const geometry = await card.evaluate((element) => {
            const action = element.querySelector<HTMLElement>(
              '[data-testid="agent-panel-toggle"]',
            )!;
            const stack = element.querySelector<HTMLElement>('[data-agent-avatar-stack]')!;
            const overflow = stack.querySelector<HTMLElement>('[data-agent-avatar-overflow]');
            const items = [
              ...stack.querySelectorAll<HTMLElement>('[data-agent-avatar-stack-item]'),
            ];
            const box = (node: Element) => {
              const rect = node.getBoundingClientRect();
              return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            };
            const stackBox = box(stack);
            const overflowBox = overflow ? box(overflow) : null;
            return {
              card: box(element),
              action: box(action),
              align: stack.dataset.agentAvatarStackAlign,
              overlap: stack.dataset.agentAvatarStackOverlap,
              items: items.map((item) => ({
                box: box(item),
                zIndex: Number(getComputedStyle(item).zIndex),
                mask: getComputedStyle(item).maskImage,
                state: item.querySelector<HTMLElement>('[data-agent-avatar-with-state]')?.dataset
                  .avatarState,
              })),
              overflow: overflow?.textContent ?? null,
              centerDelta: overflowBox
                ? Math.abs(
                    (overflowBox.top + overflowBox.bottom) / 2 -
                      (stackBox.top + stackBox.bottom) / 2,
                  )
                : 0,
              direction: getComputedStyle(stack).direction,
              devicePixelRatio: window.devicePixelRatio,
            };
          });
          const visibleCount = geometry.items.length;
          expect(geometry.align).toBe('start');
          expect(geometry.overlap).toBe('later-on-top');
          expect(geometry.items.map(({ zIndex }) => zIndex)).toEqual(
            Array.from({ length: visibleCount }, (_, index) => index + 1),
          );
          expect(geometry.items.map(({ state }) => state)).toEqual([
            'running',
            ...Array.from({ length: visibleCount - 1 }, () => 'idle'),
          ]);
          expect(geometry.items.at(-1)?.mask).toBe('none');
          expect(geometry.items.slice(0, -1).every(({ mask }) => mask.includes('url('))).toBe(true);
          const steps = geometry.items
            .slice(1)
            .map(({ box }, index) => box.left - geometry.items[index].box.left);
          expect(steps.every((step) => (direction === 'ltr' ? step > 0 : step < 0))).toBe(true);
          if (agentCount <= 3) {
            expect(visibleCount).toBe(agentCount);
            expect(geometry.overflow).toBeNull();
          } else {
            expect(visibleCount).toBeLessThan(agentCount);
            expect(geometry.overflow).toBe(`+${agentCount - visibleCount}`);
          }
          expect(geometry.centerDelta * geometry.devicePixelRatio).toBeLessThanOrEqual(0.5);
          expect(geometry.action.left - geometry.card.left).toBeCloseTo(zoom, 1);
          expect(geometry.card.right - geometry.action.right).toBeCloseTo(zoom, 1);
          expect(geometry.action.top - geometry.card.top).toBeCloseTo(zoom, 1);
          expect(geometry.card.bottom - geometry.action.bottom).toBeCloseTo(zoom, 1);
          expect(geometry.direction).toBe(direction);
          await expect(card.locator('[data-sidebar-agent]')).toHaveCount(visibleCount);
          await expect(card.locator('[data-agent-avatar-overflow] button')).toHaveCount(0);
        }
        await page.locator('[data-testid="agent-panel-toggle"]').click();
        await expect(page.locator('[data-sidebar-overlay]')).toBeVisible();
        await expect(page.locator('[data-sidebar-tab-strip]')).toHaveAttribute(
          'data-active-tab',
          'agents',
        );
      }
    }
  }
});

test('visible Agents stack avatars support hover, focus, Enter, and Space', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await mountSidebar(page, {
    width: 260,
    zoom: 1,
    theme: 'light',
    selectedTab: 'overview',
    agentCount: 3,
    noteCount: 3,
  });

  const buttons = page.locator('[data-sidebar-launcher="agents"] [data-sidebar-agent]');
  await expect(buttons).toHaveCount(3);
  expect(
    await buttons.evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-sidebar-agent')),
    ),
  ).toEqual(['agent-running', 'agent-1', 'agent-2']);

  await buttons.nth(0).hover();
  await expect(page.locator('[data-sidebar-hover-card="agent"]')).toBeVisible();
  await page.mouse.move(0, 0);
  await buttons.nth(1).focus();
  await expect(buttons.nth(1)).toBeFocused();
  await expect(page.locator('[data-sidebar-hover-card="agent"]')).toBeVisible();

  await buttons.nth(1).evaluate((button) => {
    button.addEventListener('click', () => {
      button.setAttribute(
        'data-keyboard-clicks',
        String(Number(button.getAttribute('data-keyboard-clicks') ?? 0) + 1),
      );
    });
  });
  await page.keyboard.press('Enter');
  await expect(buttons.nth(1)).toHaveAttribute('data-keyboard-clicks', '1');

  await buttons.nth(2).focus();
  await buttons.nth(2).evaluate((button) => {
    button.addEventListener('click', () => {
      button.setAttribute(
        'data-keyboard-clicks',
        String(Number(button.getAttribute('data-keyboard-clicks') ?? 0) + 1),
      );
    });
  });
  await page.keyboard.press('Space');
  await expect(buttons.nth(2)).toHaveAttribute('data-keyboard-clicks', '1');
  await expect(page.locator('[data-sidebar-overlay]')).toHaveCount(0);
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

test('expanded footer collapses from every surrounding hit area without swallowing navigator clicks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await mountSidebar(page, {
    width: 360,
    zoom: 1,
    selectedTab: 'agents',
    reducedMotion: true,
  });

  const footer = page.locator('[data-sidebar-expanded-footer]');
  const strip = page.locator('[data-sidebar-tab-strip]');
  const openAgents = async () => {
    await page.locator('[data-sidebar-launcher="agents"] .launcher-tile-action').click();
    await expect(page.locator('[data-sidebar-overlay]')).toBeVisible();
    await expect(strip).toHaveAttribute('data-active-tab', 'agents');
  };

  for (const area of ['left', 'right', 'above', 'below'] as const) {
    const footerBox = await footer.boundingBox();
    const stripBox = await strip.boundingBox();
    expect(footerBox).not.toBeNull();
    expect(stripBox).not.toBeNull();
    const x =
      area === 'left'
        ? footerBox!.x + 2
        : area === 'right'
          ? footerBox!.x + footerBox!.width - 2
          : stripBox!.x + stripBox!.width / 2;
    const y =
      area === 'above'
        ? footerBox!.y + 2
        : area === 'below'
          ? footerBox!.y + footerBox!.height - 2
          : stripBox!.y + stripBox!.height / 2;

    await page.mouse.click(x, y);
    await expect(page.locator('[data-sidebar-launcher-grid]')).toBeVisible();
    await openAgents();
  }

  await strip.dispatchEvent('click');
  await expect(page.locator('[data-sidebar-overlay]')).toBeVisible();
  await expect(strip).toHaveAttribute('data-active-tab', 'agents');

  await strip.locator('[data-sidebar-collapsed-tab="context"] button').dispatchEvent('click');
  await expect(page.locator('[data-sidebar-overlay]')).toBeVisible();
  await expect(strip).toHaveAttribute('data-active-tab', 'context');

  await strip.locator('[data-sidebar-collapsed-tab="context"] button').dispatchEvent('click');
  await expect(page.locator('[data-sidebar-launcher-grid]')).toBeVisible();
});

test('tab deck previews inactive tabs without changing current content and transfers close on activation', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 1200 });
  for (const geometry of [
    { width: 360, zoom: 1, theme: 'light' as const },
    { width: 280, zoom: 2, theme: 'dark' as const },
  ]) {
    await mountSidebar(page, { ...geometry, selectedTab: 'agents' });
    const strip = page.locator('[data-sidebar-tab-strip]');
    const tabs = strip.locator('[data-sidebar-collapsed-tab]');
    const activeTab = strip.locator('[data-sidebar-collapsed-tab][data-active="true"]');
    const inactiveTabs = strip.locator('[data-sidebar-collapsed-tab]:not([data-active="true"])');
    const expandedCard = page.locator('.sidebar-expanded-card');
    const expandedTab = strip.locator('[data-sidebar-collapsed-tab][data-expanded="true"]');
    const icons = strip.locator('[data-sidebar-tab-strip-icon]');
    const closes = strip.locator('[data-sidebar-tab-close]');
    await expect(activeTab).toHaveCount(1);
    await expect(tabs).toHaveCount(6);
    await expect(strip.locator('svg')).toHaveCount(6);
    await expect(expandedTab).toHaveCount(1);
    await expect(icons).toHaveCount(6);
    await expect(closes).toHaveCount(1);
    const stripBefore = await strip.boundingBox();
    const cardBefore = await expandedCard.boundingBox();
    const headerBefore = await expandedCard.locator('h6').first().textContent();
    const activeId = await activeTab.getAttribute('data-sidebar-collapsed-tab');
    expectEqual((await boxes(tabs)).map(({ width }) => width));
    expectSegmentedDeck(await boxes(tabs));
    const cardSurfaceStyles = await cardStyles(
      page.locator('.sidebar-expanded-card, [data-sidebar-tab-strip] [data-sidebar-card-surface]'),
    );
    expect(new Set(cardSurfaceStyles.map(({ backgroundColor }) => backgroundColor)).size).toBe(1);
    expect(cardSurfaceStyles.every(({ opacity }) => Number(opacity) === 1)).toBe(true);
    expect(cardSurfaceStyles.every(({ borderWidth }) => borderWidth === '1px')).toBe(true);
    expect(new Set(cardSurfaceStyles.map(({ borderColor }) => borderColor)).size).toBe(1);
    const tabButtonStyles = await cardStyles(tabs.locator('button'));
    expect(tabButtonStyles.every(({ radii }) => radii.every((radius) => radius !== '0px'))).toBe(
      true,
    );
    await expect(strip.locator('.sidebar-expanded-tab-indicator')).toHaveCount(1);
    const activeLayer = (await cardStyles(activeTab))[0].zIndex;
    expect(activeLayer).toBeGreaterThan(
      Math.max(...(await cardStyles(inactiveTabs)).map(({ zIndex }) => zIndex)),
    );
    await expect(icons).toHaveCount(6);
    await expect(activeTab.locator('[data-sidebar-tab-strip-icon]')).toHaveCount(1);
    await expect(activeTab.locator('[data-sidebar-tab-close][data-visible="true"]')).toHaveCount(1);

    await inactiveTabs.nth(0).hover();
    await page.waitForTimeout(300);
    const previewId = await inactiveTabs.nth(0).getAttribute('data-sidebar-collapsed-tab');
    await expect(strip).toHaveAttribute('data-active-tab', activeId!);
    await expect(strip).toHaveAttribute('data-preview-tab', previewId!);
    await expect(expandedTab).toHaveAttribute('data-sidebar-collapsed-tab', previewId!);
    await expect(icons).toHaveCount(6);
    await expect(inactiveTabs.nth(0).locator('[data-sidebar-tab-strip-icon]')).toHaveCount(1);
    await expect(activeTab.locator('[data-sidebar-tab-strip-icon]')).toHaveCount(1);
    await expect(activeTab.locator('[data-sidebar-tab-close]')).toHaveCount(1);
    await expect(activeTab.locator('[data-sidebar-tab-close][data-visible="true"]')).toHaveCount(1);
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
    expect(previewButtonStyle.paddingLeft).toBe('8px');
    expect(previewButtonStyle.paddingRight).toBe('8px');
    expect(previewButtonStyle.radii.every((radius) => radius !== '0px')).toBe(true);
    expect((await boxes(inactiveTabs.nth(0)))[0].width).toBeCloseTo(
      (await boxes(activeTab))[0].width,
      0,
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
    await expect(strip).toHaveAttribute('data-slide-direction', 'right');
    await expect(page.locator('[data-sidebar-overlay]')).toHaveAttribute(
      'data-sidebar-switch-direction',
      'right',
    );
    const transferredActive = strip.locator(
      `[data-sidebar-collapsed-tab="${keyboardPreviewId}"][data-active="true"]`,
    );
    await expect(transferredActive.locator('[data-sidebar-tab-close]')).toHaveCount(1);
    await expect(strip.locator('[data-sidebar-tab-close]')).toHaveCount(1);
    await expect(transferredActive.locator('[data-sidebar-tab-strip-icon]')).toHaveCount(1);
    await strip.locator(`[data-sidebar-collapsed-tab="${activeId}"] button`).click();
    await expect(strip).toHaveAttribute('data-active-tab', activeId!);
    await expect(strip).toHaveAttribute('data-slide-direction', 'left');
    await expect(page.locator('[data-sidebar-overlay]')).toHaveAttribute(
      'data-sidebar-switch-direction',
      'left',
    );
    await strip
      .locator(`[data-sidebar-collapsed-tab="${activeId}"][data-active="true"] button`)
      .click();
    await expect(page.locator('[data-sidebar-launcher-grid]')).toBeVisible();
  }
});

test('segmented deck keeps one icon per card and current-owned close at boundary tab counts', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1800 });
  for (const geometry of [
    { width: 360, zoom: 1, theme: 'light' as const, reducedMotion: true },
    { width: 260, zoom: 2, theme: 'dark' as const, reducedMotion: true },
  ]) {
    await mountStripMatrix(page, geometry);
    for (const count of [2, 6, 8]) {
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
        await expect(strip.locator('[data-sidebar-tab-strip-label]')).toHaveCount(0);
        await expect(strip.locator('[data-sidebar-tab-close]')).toHaveCount(1);
        await expect(active.locator('[data-sidebar-tab-close][data-visible="true"]')).toHaveCount(
          1,
        );
        await expect(strip.locator('[data-sidebar-tab-strip-icon]')).toHaveCount(count);
        await expect(strip.locator('svg')).toHaveCount(count);
        const stripBox = await strip.boundingBox();
        expectEqual((await boxes(tabs)).map(({ width }) => width));
        expectSegmentedDeck(await boxes(tabs));
        const tabHeights = (await boxes(tabs)).map(({ height }) => height);
        expectEqual(tabHeights);
        expect(Math.max(...tabHeights)).toBeLessThan(stripBox!.height);
        expect(
          (await boxes(tabs)).every(({ width, height }) => Math.abs(width - height) <= 2),
        ).toBe(true);
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
        expect(restingRadii.every((radii) => radii.every((radius) => radius !== '0px'))).toBe(true);
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
        expect(horizontalPadding.every(([left, right]) => left === '8px' && right === '8px')).toBe(
          true,
        );

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
          await expect(strip.locator('[data-sidebar-tab-strip-icon]')).toHaveCount(count);
          await expect(active.locator('[data-sidebar-tab-close]')).toHaveCount(1);
          await expect(active.locator('[data-sidebar-tab-close][data-visible="true"]')).toHaveCount(
            1,
          );
          const previewStripBox = await strip.boundingBox();
          expect(previewStripBox?.width).toBe(stripBox?.width);
          expect(previewStripBox?.height).toBe(stripBox?.height);
          expectSegmentedDeck(await boxes(tabs));
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
  await expect(active.locator('[data-sidebar-tab-close][data-visible="true"]')).toHaveCount(1);
  expect(await strip.boundingBox()).toEqual(stripBefore);

  await page.mouse.move(0, 0);
  await expect(expanded).toHaveAttribute('data-sidebar-collapsed-tab', activeId!);
  await expect(active.locator('button')).toHaveAttribute('data-tab-action', 'close');
  await active.locator('button').click();
  const gridCards = page.locator('[data-sidebar-launcher-grid] [data-sidebar-launcher]');
  await expect(gridCards).toHaveCount(4);
  const restored = await boxes(gridCards);
  expectEqual(restored.slice(0, 2).map(({ width }) => width));
  expectEqual(restored.slice(2, 4).map(({ width }) => width));
  expect(new Set(restored.map(({ padding }) => padding.join('|'))).size).toBe(1);
});
