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

async function inspectPristinePanelBackground(page: Page, theme: 'light' | 'dark') {
  await page.goto(`${baseUrl}src/app.html`);
  await page.addStyleTag({ url: `${baseUrl}src/app.css` });
  return page.evaluate(async (selectedTheme) => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
    const [{ mount, tick, unmount }, { default: Host }] = await Promise.all([
      import('/@id/svelte'),
      import('/test/fixtures/PanelPristineBackgroundHost.svelte'),
    ]);
    document.body.replaceChildren();

    const tokenBackground = (className: string) => {
      const probe = document.createElement('div');
      probe.className = className;
      document.body.append(probe);
      const background = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return background;
    };
    const sidebarBackground = tokenBackground('bg-sidebar');
    const cardBackground = tokenBackground('bg-card');
    const readEmptySurface = () => {
      const surface = document.querySelector<HTMLElement>('[data-empty-panel-surface="true"]');
      if (!surface) return null;
      return {
        background: getComputedStyle(surface).backgroundColor,
        containsPanel: surface.querySelector('.panel') !== null,
      };
    };
    const mountHost = async (openAgent: boolean) => {
      const target = document.createElement('div');
      document.body.append(target);
      let firstBackground: string | null = null;
      const observer = new MutationObserver(() => {
        firstBackground ??= readEmptySurface()?.background ?? null;
      });
      observer.observe(target, { childList: true, subtree: true });
      const component = mount(Host, {
        target,
        props: {
          workspaceId: `pristine-${selectedTheme}-${openAgent ? 'opened' : 'empty'}`,
          openAgent,
        },
      });
      await tick();
      await new Promise((resolveFrame) => setTimeout(resolveFrame, 0));
      firstBackground ??= readEmptySurface()?.background ?? null;
      observer.disconnect();
      return { component, target, firstBackground };
    };

    const initial = await mountHost(false);
    const initialSurface = readEmptySurface();
    await unmount(initial.component);
    initial.target.remove();

    const opened = await mountHost(true);
    const firstOpenSurface = readEmptySurface();
    const populatedPanel = [...document.querySelectorAll<HTMLElement>('.panel')].find(
      (panel) => !panel.closest('[data-empty-panel-surface="true"]'),
    );
    const populatedBackground = populatedPanel
      ? getComputedStyle(populatedPanel).backgroundColor
      : null;
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    const settledSurface = readEmptySurface();
    await unmount(opened.component);
    opened.target.remove();

    const remounted = await mountHost(true);
    const remountedSurface = readEmptySurface();
    await unmount(remounted.component);

    return {
      sidebarBackground,
      cardBackground,
      initialFirstBackground: initial.firstBackground,
      initialSurface,
      openedFirstBackground: opened.firstBackground,
      firstOpenSurface,
      settledSurface,
      populatedBackground,
      remountedSurface,
    };
  }, theme);
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

test('the visible pristine owner paints bg-sidebar from insertion through remount', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const theme of ['light', 'dark'] as const) {
    const result = await inspectPristinePanelBackground(page, theme);
    expect(result.initialFirstBackground).toBe(result.sidebarBackground);
    expect(result.initialSurface).toEqual({
      background: result.sidebarBackground,
      containsPanel: false,
    });
    expect(result.openedFirstBackground).toBe(result.sidebarBackground);
    expect(result.firstOpenSurface?.background).toBe(result.sidebarBackground);
    expect(result.settledSurface?.background).toBe(result.sidebarBackground);
    expect(result.remountedSurface?.background).toBe(result.sidebarBackground);
    expect(result.populatedBackground).toBe(result.cardBackground);
    expect(result.sidebarBackground).not.toBe(result.cardBackground);
  }
});

test('compact grid cards keep equal geometry and padding through hover at narrow and zoomed sizes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 1200 });
  let lightSurfaceBackground: string | undefined;
  for (const geometry of [
    { width: 360, zoom: 1, theme: 'light' as const, agentCount: 0, noteCount: 0 },
    { width: 280, zoom: 1, theme: 'dark' as const, agentCount: 1, noteCount: 1 },
    { width: 280, zoom: 1.5, theme: 'light' as const, agentCount: 3, noteCount: 3 },
    { width: 360, zoom: 1, theme: 'dark' as const, agentCount: 6, noteCount: 6 },
    { width: 260, zoom: 2, theme: 'dark' as const, agentCount: 8, noteCount: 8 },
    { width: 360, zoom: 1.5, theme: 'light' as const, agentCount: 26, noteCount: 26 },
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
    await expect(page.locator('[data-sidebar-launcher="activityLog"]')).toHaveCount(0);
    await expect(page.locator('[data-sidebar-launcher="changes"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="sidebar-activity-preview"]')).toHaveCount(0);
    await expect(page.locator('[data-sidebar-local-changes-summary]')).toHaveCount(0);
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
    const compactHeights = await bottomCards.evaluateAll((elements) =>
      elements.map((element) => Number.parseFloat(getComputedStyle(element).height)),
    );
    expect(compactHeights).toEqual([44, 44]);

    const iconBounds = await cards.evaluateAll((elements) =>
      elements.slice(0, 2).map((card) => {
        const cardRect = card.getBoundingClientRect();
        const scale = cardRect.width / (card as HTMLElement).offsetWidth;
        const stack = card.querySelector<HTMLElement>('[data-sidebar-launcher-icons]')!;
        const stackRect = stack.getBoundingClientRect();
        const inset = Number((card as HTMLElement).dataset.launcherInlineInset ?? 0) * scale;
        const labelLeft =
          card.querySelector<HTMLElement>('[data-sidebar-launcher-label]')!.getBoundingClientRect()
            .left - cardRect.left;
        const items = [...card.querySelectorAll<HTMLElement>('[data-launcher-preview-item]')];
        return items.map((item) => {
          const visibleSurface =
            item.querySelector<HTMLElement>('[data-sidebar-launcher-glyph]') ?? item;
          const itemRect = item.getBoundingClientRect();
          const visibleRect = visibleSurface.getBoundingClientRect();
          const overflowText = item.querySelector<HTMLElement>('span[aria-hidden="true"]');
          const overflowTextRect = overflowText?.getBoundingClientRect();
          return {
            left: itemRect.left - cardRect.left,
            visibleLeft: visibleRect.left - cardRect.left,
            visibleWidth: visibleRect.width,
            right: cardRect.right - itemRect.right,
            width: itemRect.width,
            inset,
            labelLeft,
            scale,
            overflow:
              item.hasAttribute('data-sidebar-agent-overflow') ||
              item.hasAttribute('data-sidebar-context-overflow'),
            overflowText: overflowText?.textContent ?? '',
            overflowTextLeft: overflowTextRect ? overflowTextRect.left - itemRect.left : 0,
            overflowTextRight: overflowTextRect ? itemRect.right - overflowTextRect.right : 0,
            scrollWidth: item.scrollWidth,
            clientWidth: item.clientWidth,
            availableWidth: stackRect.width,
          };
        });
      }),
    );
    expect(
      iconBounds.flat().every(({ left, right, inset }) => left >= inset && right >= inset),
    ).toBe(true);
    for (const [index, bounds] of iconBounds.entries()) {
      const total = index === 0 ? geometry.agentCount : geometry.noteCount;
      if (total === 0) {
        expect(bounds).toHaveLength(0);
        continue;
      }
      const renderedOverflow = bounds.find(({ overflow }) => overflow);
      const reservedOverflowWidth = renderedOverflow
        ? renderedOverflow.width / renderedOverflow.scale
        : 36;
      const expectedLimit = Math.max(
        1,
        Math.min(
          6,
          Math.floor(
            (bounds[0].availableWidth / bounds[0].scale - 36 - reservedOverflowWidth) / 16,
          ) + 1,
        ),
      );
      const expectedVisible = Math.min(total, expectedLimit);
      const expectedOverflow = total - expectedVisible;
      const expectedCount = expectedVisible + (expectedOverflow > 0 ? 1 : 0);
      expect(bounds).toHaveLength(expectedCount);
      expect(Math.abs(bounds[0].visibleLeft - bounds[0].labelLeft)).toBeLessThanOrEqual(0.5);
      expect(
        bounds
          .filter(({ overflow }) => !overflow)
          .every(({ width, scale }) => Math.abs(width - 36 * scale) <= 0.5),
      ).toBe(true);
      expect(
        bounds
          .filter(({ overflow }) => overflow)
          .every(({ width, scale }) => width >= 36 * scale - 0.5),
      ).toBe(true);
      expect(
        bounds
          .filter(({ overflow }) => !overflow)
          .every(({ visibleWidth, scale }) => Math.abs(visibleWidth - 20 * scale) <= 0.5),
      ).toBe(true);
      const steps = bounds.slice(1).map((item, itemIndex) => item.left - bounds[itemIndex].left);
      expect(steps.every((step) => step > 0 && step <= 36 * bounds[0].scale)).toBe(true);
      const visibleBounds = bounds.filter(({ overflow }) => !overflow);
      const visibleSteps = visibleBounds
        .slice(1)
        .map((item, itemIndex) => item.visibleLeft - visibleBounds[itemIndex].visibleLeft);
      if (visibleSteps.length > 1) expectEqual(visibleSteps, 0.75);
      expect(visibleSteps.every((step) => Math.abs(step - 16 * bounds[0].scale) <= 0.5)).toBe(true);
      expect(
        visibleSteps.every(
          (step) => Math.abs(20 * bounds[0].scale - step - 4 * bounds[0].scale) <= 0.5,
        ),
      ).toBe(true);
      if (expectedOverflow > 0) {
        const overflow = bounds.at(-1)!;
        expect(overflow.overflow).toBe(true);
        expect(steps.at(-1)).toBeCloseTo(36 * bounds[0].scale, 1);
        expect(overflow.overflowText).toBe(`+${expectedOverflow}`);
        expect(overflow.overflowTextLeft).toBeGreaterThanOrEqual(0);
        expect(overflow.overflowTextRight).toBeGreaterThanOrEqual(0);
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
      }
    }
    const cardAlignment = await surfaces.evaluateAll((elements) =>
      elements.map((card) => {
        const element = card as HTMLElement;
        const cardRect = element.getBoundingClientRect();
        const scale = cardRect.width / element.offsetWidth;
        const label = element.querySelector<HTMLElement>('[data-sidebar-launcher-label]')!;
        const stack = element.querySelector<HTMLElement>('[data-sidebar-launcher-icons]');
        const visibleSurface =
          element.querySelector<HTMLElement>('[data-sidebar-launcher-glyph]') ??
          element.querySelector<HTMLElement>(
            '[data-sidebar-changes-resource] [data-resource-icon-tile]',
          );
        const id =
          element.dataset.sidebarLauncher ??
          (element.hasAttribute('data-workspace-terminal-dock') ? 'shell' : 'unknown');
        let leadingLeft: number;
        if (visibleSurface) {
          leadingLeft = visibleSurface.getBoundingClientRect().left;
        } else if (stack) {
          leadingLeft =
            stack.getBoundingClientRect().left +
            Number(stack.dataset.launcherVisibleOffset ?? 0) * scale;
        } else {
          const style = getComputedStyle(element);
          leadingLeft =
            cardRect.left +
            (Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft)) *
              scale;
        }
        return {
          id,
          delta: Math.abs(label.getBoundingClientRect().left - leadingLeft),
        };
      }),
    );
    expect(cardAlignment.map(({ id }) => id).sort()).toEqual([
      'agents',
      'browser',
      'changes',
      'context',
      'files',
      'shell',
    ]);
    expect(cardAlignment.every(({ delta }) => delta <= 0.5)).toBe(true);
    if (geometry.agentCount > 0) {
      const avatarGeometry = await cards
        .filter({ has: page.locator('[data-sidebar-agent]') })
        .locator('[data-agent-avatar-with-state]')
        .evaluateAll((surfaces) =>
          surfaces.map((surface) => {
            const element = surface as HTMLElement;
            const card = element.closest<HTMLElement>('[data-sidebar-launcher]')!;
            const scale = card.getBoundingClientRect().width / card.offsetWidth;
            const avatar = element.querySelector<SVGElement>('[data-agent-avatar]')!;
            const avatarStyle = getComputedStyle(avatar);
            return {
              variant: element.dataset.avatarVariant,
              surface: element.getBoundingClientRect().width / scale,
              svg: avatar.getBoundingClientRect().width / scale,
              clearSpace: Number.parseFloat(avatarStyle.paddingLeft),
              art:
                avatar.getBoundingClientRect().width / scale -
                Number.parseFloat(avatarStyle.paddingLeft) -
                Number.parseFloat(avatarStyle.paddingRight),
            };
          }),
        );
      expect(avatarGeometry).toHaveLength(iconBounds[0].filter(({ overflow }) => !overflow).length);
      expect(
        avatarGeometry.every(
          ({ variant, surface, svg, clearSpace, art }) =>
            variant === 'standard' &&
            Math.abs(surface - 20) < 0.1 &&
            Math.abs(svg - 20) < 0.1 &&
            Math.abs(clearSpace - 2) < 0.1 &&
            Math.abs(art - 16) < 0.1,
        ),
      ).toBe(true);
    }
    const changesGeometry = await cards
      .filter({ has: page.locator('[data-sidebar-changes-resource]') })
      .evaluate((card) => {
        const scale = card.getBoundingClientRect().width / (card as HTMLElement).offsetWidth;
        return {
          target:
            card
              .querySelector<HTMLElement>('[data-sidebar-changes-resource]')!
              .getBoundingClientRect().width / scale,
          visible:
            card.querySelector<HTMLElement>('[data-resource-icon-tile]')!.getBoundingClientRect()
              .width / scale,
        };
      });
    expect(changesGeometry.target).toBeCloseTo(36, 1);
    expect(changesGeometry.visible).toBeCloseTo(20, 1);
    const labelRows = await cards.evaluateAll((elements) =>
      elements.map((card) => {
        const cardRect = card.getBoundingClientRect();
        const rowRect = card
          .querySelector<HTMLElement>('[data-sidebar-label-row]')!
          .getBoundingClientRect();
        const scale = cardRect.width / (card as HTMLElement).offsetWidth;
        return {
          height: rowRect.height / scale,
          bottomInset: (cardRect.bottom - rowRect.bottom) / scale,
        };
      }),
    );
    expect(labelRows.every(({ height }) => Math.abs(height - 28) < 0.1)).toBe(true);
    expect(labelRows.every(({ bottomInset }) => bottomInset >= 8 && bottomInset <= 10)).toBe(true);
    const filesCenterDelta = await cards
      .filter({ has: page.locator('[data-files-open-in]') })
      .evaluate((card) => {
        const row = card
          .querySelector<HTMLElement>('[data-sidebar-label-row]')!
          .getBoundingClientRect();
        const icon = card
          .querySelector<HTMLElement>('[data-files-open-in]')!
          .getBoundingClientRect();
        return Math.abs(row.top + row.height / 2 - (icon.top + icon.height / 2));
      });
    expect(filesCenterDelta).toBeLessThan(0.6 * geometry.zoom);

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

test('left-packed launchers preserve hover, focus, click, and open-panel markers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await mountSidebar(page, {
    width: 320,
    zoom: 1,
    theme: 'light',
    selectedTab: 'overview',
    agentCount: 8,
    noteCount: 8,
  });

  const agents = page.locator('[data-sidebar-agent]');
  const notes = page.locator('[data-sidebar-context]');
  await expect(agents).toHaveCount(6);
  await expect(notes).toHaveCount(6);
  await expect(agents.nth(0).locator('[data-panel-open-marker]')).toHaveAttribute(
    'data-panel-open-state',
    'active',
  );
  await expect(notes.nth(0).locator('[data-panel-open-marker]')).toHaveAttribute(
    'data-panel-open-state',
    'open',
  );

  await agents.nth(0).hover({ position: { x: 2, y: 18 } });
  await expect(page.locator('[data-sidebar-hover-card="agent"]')).toBeVisible();
  await notes.nth(0).focus();
  await expect(notes.nth(0)).toBeFocused();
  await expect(page.locator('[data-sidebar-hover-card="note"]')).toBeVisible();

  await notes.nth(0).click({ position: { x: 2, y: 18 } });
  await expect(notes.nth(0).locator('[data-panel-open-marker]')).toHaveAttribute(
    'data-panel-open-state',
    'active',
  );
  await agents.nth(0).focus();
  await page.keyboard.press('Tab');
  await expect(agents.nth(1)).toBeFocused();

  await page.locator('[data-sidebar-agent-overflow]').click();
  await expect(page.locator('[data-sidebar-overlay]')).toBeVisible();
  await expect(page.locator('[data-sidebar-tab-strip]')).toHaveAttribute(
    'data-active-tab',
    'agents',
  );
});

test('View PR follows the workspace description once in compact and expanded modes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const longDescription =
    'Reviewing the sidebar geometry across narrow widths, dark mode, expanded cards, and browser zoom without truncating this workspace description.';
  for (const scenario of [
    {
      width: 360,
      zoom: 1,
      theme: 'light' as const,
      selectedTab: 'overview',
      description: undefined,
      hasPullRequest: true,
    },
    {
      width: 260,
      zoom: 2,
      theme: 'dark' as const,
      selectedTab: 'changes',
      description: longDescription,
      hasPullRequest: true,
    },
    {
      width: 300,
      zoom: 1,
      theme: 'dark' as const,
      selectedTab: 'overview',
      description: longDescription,
      hasPullRequest: false,
    },
    {
      width: 320,
      zoom: 1.5,
      theme: 'light' as const,
      selectedTab: 'files',
      description: undefined,
      hasPullRequest: false,
    },
  ]) {
    await mountSidebar(page, scenario);
    const viewPr = page.locator('[data-workspace-view-pr]');
    await expect(viewPr).toHaveCount(scenario.hasPullRequest ? 1 : 0);
    await expect(page.locator('[data-sidebar-changes-pr]')).toHaveCount(0);
    await expect(page.locator('[data-sidebar-overlay]')).toHaveCount(
      scenario.selectedTab === 'overview' ? 0 : 1,
    );
    if (!scenario.hasPullRequest) continue;

    const titleRegion = page.locator('[data-workspace-title-region]');
    const regionBox = await titleRegion.boundingBox();
    const prBox = await viewPr.boundingBox();
    expect(regionBox).not.toBeNull();
    expect(prBox).not.toBeNull();
    expect(prBox!.x).toBeGreaterThanOrEqual(regionBox!.x);
    expect(prBox!.x + prBox!.width).toBeLessThanOrEqual(regionBox!.x + regionBox!.width);
    if (scenario.description) {
      const descriptionBox = await page
        .getByRole('button', { name: 'Edit workspace status' })
        .boundingBox();
      expect(descriptionBox).not.toBeNull();
      expect(prBox!.y).toBeGreaterThanOrEqual(descriptionBox!.y + descriptionBox!.height);
    }
    const button = viewPr.getByRole('button', { name: 'View PR' });
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(viewPr).toHaveCount(1);
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
