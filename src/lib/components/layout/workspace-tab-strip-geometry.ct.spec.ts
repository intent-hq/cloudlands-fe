import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import sharp from 'sharp';
import WorkspaceTabStripGeometryPreview from './workspace-tab-strip-geometry.preview.svelte';
import { WORKSPACE_TAB_MAX_SCROLL_STEP_PX } from './workspace-tab-lifecycle-motion';
import {
  WORKSPACE_TAB_EDGE_FADE_WIDTH_PX,
  WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX,
  WORKSPACE_TAB_MOTION_DURATION_MS,
} from './titlebar-geometry';

const WORKSPACE_TAB_SCROLL_TRACE_TOLERANCE_PX = Math.ceil(WORKSPACE_TAB_MAX_SCROLL_STEP_PX);

async function expectVisibleThroughAncestorClipping(target: Locator) {
  const result = await target.evaluate((element) => {
    const targetRect = element.getBoundingClientRect();
    const clippingAncestors: Array<{ selector: string; rect: DOMRect; overflow: string }> = [];
    let ancestor = element.parentElement;

    while (ancestor) {
      const style = getComputedStyle(ancestor);
      const clips = [style.overflow, style.overflowX, style.overflowY].some((value) =>
        ['auto', 'scroll', 'hidden', 'clip'].includes(value),
      );
      if (clips) {
        clippingAncestors.push({
          selector:
            ancestor.getAttribute('data-workspace-tab-strip') !== null
              ? '[data-workspace-tab-strip]'
              : ancestor.tagName.toLowerCase(),
          rect: ancestor.getBoundingClientRect(),
          overflow: `${style.overflowX}/${style.overflowY}`,
        });
      }
      if (ancestor.hasAttribute('data-titlebar-geometry-root')) break;
      ancestor = ancestor.parentElement;
    }

    return {
      target: targetRect.toJSON(),
      clippingAncestors: clippingAncestors.map(({ selector, rect, overflow }) => ({
        selector,
        overflow,
        rect: rect.toJSON(),
        contains:
          targetRect.left >= rect.left &&
          targetRect.right <= rect.right &&
          targetRect.top >= rect.top &&
          targetRect.bottom <= rect.bottom,
      })),
    };
  });

  expect(result.clippingAncestors.length).toBeGreaterThan(0);
  expect(result.clippingAncestors, JSON.stringify(result, null, 2)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ selector: '[data-workspace-tab-strip]', contains: true }),
    ]),
  );
  expect(
    result.clippingAncestors.every((ancestor) => ancestor.contains),
    JSON.stringify(result, null, 2),
  ).toBe(true);
}

async function expectMaskAttachedToActiveTab(component: Locator) {
  const activeBox = await component
    .locator('[data-workspace-tab][data-active="true"]')
    .boundingBox();
  const maskBox = await component.locator('[data-active-tab-border-mask]').boundingBox();
  expect(activeBox).toBeTruthy();
  expect(maskBox).toBeTruthy();
  expect(Math.abs((maskBox?.x ?? 0) - (activeBox?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((maskBox?.width ?? 0) - (activeBox?.width ?? 0))).toBeLessThanOrEqual(1);
}

async function getFlareEndpointGeometry(component: Locator) {
  return component.evaluate((root) => {
    const tab = root.querySelector<HTMLElement>('[data-workspace-tab][data-active="true"]');
    const mask = root.querySelector<HTMLElement>('[data-active-tab-border-mask]');
    const leading = root.querySelector<SVGPathElement>(
      '[data-workspace-tab][data-active="true"] [data-workspace-tab-leading-flare] path.stroke-border',
    );
    const trailing = root.querySelector<SVGPathElement>(
      '[data-workspace-tab][data-active="true"] [data-workspace-tab-trailing-flare] path.stroke-border',
    );
    if (!tab || !mask || !leading || !trailing) throw new Error('Missing flare geometry');
    const screenPoint = (path: SVGPathElement, end: boolean) => {
      const point = path.getPointAtLength(end ? path.getTotalLength() : 0);
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error('Missing flare transform');
      return new DOMPoint(point.x, point.y).matrixTransform(matrix);
    };
    const tabRect = tab.getBoundingClientRect();
    const maskRect = mask.getBoundingClientRect();
    const scale = root.getBoundingClientRect().width / (root as HTMLElement).offsetWidth;
    return {
      tabLeftBorderCenter:
        tabRect.left + (parseFloat(getComputedStyle(tab).borderLeftWidth) * scale) / 2,
      tabRightBorderCenter:
        tabRect.right - (parseFloat(getComputedStyle(tab).borderRightWidth) * scale) / 2,
      titlebarBorderCenter: maskRect.top + maskRect.height / 2,
      leadingStart: screenPoint(leading, false),
      leadingEnd: screenPoint(leading, true),
      trailingStart: screenPoint(trailing, false),
      trailingEnd: screenPoint(trailing, true),
    };
  });
}

async function expectRenderedFlareJoinsPanelBorder(page: Page, component: Locator, zoom: number) {
  const geometry = await getFlareEndpointGeometry(component);
  const panel = await component.locator('[data-preview-panel]').boundingBox();
  expect(panel).toBeTruthy();
  const panelTop = panel?.y ?? 0;
  const endpoints = [
    { side: 'leading', x: geometry.leadingEnd.x, direction: 1 },
    { side: 'trailing', x: geometry.trailingEnd.x, direction: -1 },
  ] as const;
  let panelRowReference: number[] | null = null;

  for (const endpoint of endpoints) {
    const clip = {
      x: Math.floor(endpoint.x - 4 * zoom),
      y: Math.floor(panelTop - 4 * zoom),
      width: Math.ceil(8 * zoom),
      height: Math.ceil(8 * zoom),
    };
    const image = await page.screenshot({ animations: 'disabled', clip });
    const { data, info } = await sharp(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const scale = info.width / clip.width;
    const isDark = (x: number, y: number) => {
      const pixelX = Math.max(0, Math.min(info.width - 1, Math.floor((x - clip.x) * scale)));
      const pixelY = Math.max(0, Math.min(info.height - 1, y));
      const offset = (pixelY * info.width + pixelX) * info.channels;
      return (data[offset] + data[offset + 1] + data[offset + 2]) / 3 < 128;
    };
    const rowsAt = (fromX: number, toX: number) => {
      const rows: number[] = [];
      for (let y = 0; y < info.height; y += 1) {
        for (let x = fromX; x <= toX; x += 0.25 / scale) {
          if (isDark(x, y)) {
            rows.push(y);
            break;
          }
        }
      }
      return rows;
    };
    const outsideX = endpoint.x - endpoint.direction * 2 * zoom;
    const measuredPanelRows = rowsAt(outsideX, outsideX);
    const panelRows = endpoint.side === 'leading' ? measuredPanelRows : panelRowReference;
    const joinStart = endpoint.x + Math.min(0, endpoint.direction * 5.5 * zoom);
    const joinEnd = endpoint.x + Math.max(0, endpoint.direction * 5.5 * zoom);
    const joinRows = rowsAt(joinStart, joinEnd);
    if (!panelRows) throw new Error('Missing leading panel row reference');
    expect(panelRows, endpoint.side).not.toHaveLength(0);
    expect(joinRows, endpoint.side).not.toHaveLength(0);
    expect(joinRows.slice(-panelRows.length), endpoint.side).toEqual(panelRows);
    panelRowReference = panelRows;
  }
}

async function getLogoToLeadingFlareGap(component: Locator) {
  const logoBox = await component.locator('[data-preview-logo]').boundingBox();
  const flareBox = await component
    .locator('[data-workspace-tab][data-active="true"] [data-workspace-tab-leading-flare]')
    .boundingBox();
  expect(logoBox).toBeTruthy();
  expect(flareBox).toBeTruthy();
  return (flareBox?.x ?? 0) - ((logoBox?.x ?? 0) + (logoBox?.width ?? 0));
}

async function getInterTabGap(component: Locator) {
  const tabs = component.locator('[data-workspace-tab]');
  const [first, second] = await Promise.all([tabs.nth(0).boundingBox(), tabs.nth(1).boundingBox()]);
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  return (second?.x ?? 0) - ((first?.x ?? 0) + (first?.width ?? 0));
}

async function captureTabMotion(control: Locator, workspaceId: string) {
  return control.evaluate(
    async (button, { id }) => {
      const frames: Array<{
        width: number | null;
        activeId: string | null;
        visualY: number | null;
        visualOpacity: number | null;
        launcherLeft: number | null;
        scrollLeft: number | null;
        scrollWidth: number | null;
        clientWidth: number | null;
        hasOverflow: boolean;
        fadesLeft: boolean;
        stripMaskImage: string | null;
        slotOverflow: string | null;
        tabRects: Array<[string, { left: number; width: number }]>;
        maskLeftDelta: number | null;
        maskWidthDelta: number | null;
        maskTransitionDuration: string | null;
      }> = [];
      (button as HTMLButtonElement).click();
      for (let index = 0; index < 60; index += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const motion = document.querySelector<HTMLElement>(`[data-workspace-tab-motion="${id}"]`);
        const active = document.querySelector<HTMLElement>(
          '[data-workspace-tab][data-active="true"]',
        );
        const visual = document.querySelector<HTMLElement>(`[data-workspace-tab-visual="${id}"]`);
        const launcher = document.querySelector<HTMLElement>('[data-preview-launcher]');
        const mask = document.querySelector<HTMLElement>('[data-active-tab-border-mask]');
        const strip = document.querySelector<HTMLElement>('[data-workspace-tab-strip]');
        const activeRect = active?.getBoundingClientRect();
        const visualRect = visual?.getBoundingClientRect();
        const launcherRect = launcher?.getBoundingClientRect();
        const maskRect = mask?.getBoundingClientRect();
        const stripRect = strip?.getBoundingClientRect();
        const expectedMaskLeft =
          activeRect && stripRect ? Math.max(activeRect.left, stripRect.left) : null;
        const expectedMaskRight =
          activeRect && stripRect ? Math.min(activeRect.right, stripRect.right) : null;
        const tabRects = Array.from(
          document.querySelectorAll<HTMLElement>('[data-workspace-tab]'),
        ).map((tab) => {
          const rect = tab.getBoundingClientRect();
          return [tab.dataset.workspaceTab ?? '', { left: rect.left, width: rect.width }] as [
            string,
            { left: number; width: number },
          ];
        });
        frames.push({
          width: motion?.getBoundingClientRect().width ?? null,
          activeId: active?.dataset.workspaceTab ?? null,
          visualY: visualRect?.y ?? null,
          visualOpacity: visual ? Number.parseFloat(getComputedStyle(visual).opacity) : null,
          launcherLeft: launcherRect?.left ?? null,
          scrollLeft: strip?.scrollLeft ?? null,
          scrollWidth: strip?.scrollWidth ?? null,
          clientWidth: strip?.clientWidth ?? null,
          hasOverflow: strip ? strip.scrollWidth > strip.clientWidth : false,
          fadesLeft: strip?.dataset.fadeLeft === 'true',
          stripMaskImage: strip ? getComputedStyle(strip).maskImage : null,
          slotOverflow: motion ? getComputedStyle(motion).overflow : null,
          tabRects,
          maskLeftDelta:
            maskRect && expectedMaskLeft !== null
              ? Math.abs(maskRect.left - expectedMaskLeft)
              : null,
          maskWidthDelta:
            maskRect && expectedMaskLeft !== null && expectedMaskRight !== null
              ? Math.abs(maskRect.width - (expectedMaskRight - expectedMaskLeft))
              : null,
          maskTransitionDuration: mask ? getComputedStyle(mask).transitionDuration : null,
        });
      }
      return frames;
    },
    { id: workspaceId },
  );
}

function countMotionReversals(values: number[]): number {
  let direction = 0;
  let reversals = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (Math.abs(delta) < 2) continue;
    const nextDirection = Math.sign(delta);
    if (direction !== 0 && nextDirection !== direction) reversals += 1;
    direction = nextDirection;
  }
  return reversals;
}

async function getBorderMaskFadeStops(component: Locator) {
  return component.evaluate((root) => {
    const strip = root.querySelector<HTMLElement>('[data-workspace-tab-strip]');
    const mask = root.querySelector<HTMLElement>('[data-active-tab-border-mask]');
    if (!strip || !mask) throw new Error('Missing strip or border mask');
    const stripRect = strip.getBoundingClientRect();
    const maskRect = mask.getBoundingClientRect();
    const stops = [...getComputedStyle(mask).maskImage.matchAll(/(-?[\d.]+)px/g)].map((match) =>
      Number(match[1]),
    );
    return {
      stripLeft: stripRect.left,
      stripRight: stripRect.right,
      maskLeft: maskRect.left,
      stops,
    };
  });
}

async function getLeadingEdgeGeometry(component: Locator) {
  return component.evaluate(
    (root, { fadeOffset, fadeWidth }) => {
      const rootRect = root.getBoundingClientRect();
      const logoRect = root
        .querySelector<HTMLElement>('[data-preview-logo]')
        ?.getBoundingClientRect();
      const stripRect = root
        .querySelector<HTMLElement>('[data-workspace-tab-strip]')
        ?.getBoundingClientRect();
      const firstTabRect = root
        .querySelector<HTMLElement>('[data-workspace-tab]')
        ?.getBoundingClientRect();
      if (!logoRect || !stripRect || !firstTabRect) throw new Error('Missing leading geometry');
      const curveEnd = logoRect.right - rootRect.left;
      const clipStart = stripRect.left - rootRect.left + fadeOffset;
      return {
        curveEnd,
        clipStart,
        fadeEnd: clipStart + fadeWidth,
        firstTab: firstTabRect.left - rootRect.left,
      };
    },
    {
      fadeOffset: WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX,
      fadeWidth: WORKSPACE_TAB_EDGE_FADE_WIDTH_PX,
    },
  );
}

test('keeps flares mounted and synchronizes visibility through activation and clipping', async ({
  mount,
}) => {
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { activeWorkspaceId: 'geometry-alpha' },
  });
  const strip = component.locator('[data-workspace-tab-strip]');
  const leftSurface = component.locator('[data-titlebar-left-drag-surface]');

  await expect(strip).toBeVisible();
  await expect
    .poll(() => strip.evaluate((element) => element.scrollWidth))
    .toBeGreaterThan(await strip.evaluate((element) => element.clientWidth));
  expect(await strip.evaluate((element) => element.scrollHeight)).toBe(
    await strip.evaluate((element) => element.clientHeight),
  );
  await expect(leftSurface).toHaveCSS('overflow-y', 'visible');

  const firstFlares = component.locator(
    '[data-workspace-tab="geometry-alpha"] [data-workspace-tab-leading-flare], [data-workspace-tab="geometry-alpha"] [data-workspace-tab-trailing-flare]',
  );
  const middleFlares = component.locator(
    '[data-workspace-tab="geometry-beta"] [data-workspace-tab-leading-flare], [data-workspace-tab="geometry-beta"] [data-workspace-tab-trailing-flare]',
  );
  await expect(firstFlares).toHaveCount(2);
  await expect(middleFlares).toHaveCount(2);
  for (const flare of await firstFlares.all()) await expect(flare).toHaveCSS('opacity', '1');
  for (const flare of await middleFlares.all()) await expect(flare).toHaveCSS('opacity', '0');

  await expectVisibleThroughAncestorClipping(
    component.locator('[data-workspace-tab="geometry-alpha"] [data-workspace-tab-leading-flare]'),
  );
  await expectVisibleThroughAncestorClipping(
    component.locator('[data-workspace-tab="geometry-alpha"] [data-workspace-tab-trailing-flare]'),
  );

  await component.update({ props: { activeWorkspaceId: 'geometry-beta' } });
  for (const flare of await firstFlares.all()) await expect(flare).toHaveCSS('opacity', '0');
  for (const flare of await middleFlares.all()) await expect(flare).toHaveCSS('opacity', '1');
});

test('clips the mask during user scroll and restores it without transition lag', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { activeWorkspaceId: 'geometry-alpha' },
  });
  const strip = component.locator('[data-workspace-tab-strip]');
  const mask = component.locator('[data-active-tab-border-mask]');
  await page.waitForTimeout(250);
  await expect(strip).toHaveAttribute('data-fade-left', 'false');
  await expect(strip).toHaveAttribute('data-fade-right', 'true');
  await expect(strip).not.toHaveCSS('mask-image', 'none');
  await strip.evaluate((element) => (element.scrollLeft = 100));
  await expect(strip).toHaveAttribute('data-fade-left', 'true');
  await expect(strip).toHaveAttribute('data-fade-right', 'true');
  const transitionWhileScrolling = await strip.evaluate(async (element) => {
    element.dispatchEvent(new Event('scroll'));
    await Promise.resolve();
    const borderMask = document.querySelector<HTMLElement>('[data-active-tab-border-mask]');
    return borderMask ? getComputedStyle(borderMask).transition : null;
  });
  expect(transitionWhileScrolling).toBe('none');
  await expect
    .poll(async () => {
      const [stripBox, maskBox] = await Promise.all([strip.boundingBox(), mask.boundingBox()]);
      if (!stripBox || !maskBox) return false;
      return maskBox.x >= stripBox.x && maskBox.x + maskBox.width <= stripBox.x + stripBox.width;
    })
    .toBe(true);
  const fade = await getBorderMaskFadeStops(component);
  expect(fade.stops).toHaveLength(4);
  expect(fade.maskLeft + fade.stops[0]).toBeCloseTo(
    fade.stripLeft + WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX,
    1,
  );
  expect(fade.stops[1] - fade.stops[0]).toBe(WORKSPACE_TAB_EDGE_FADE_WIDTH_PX);
  expect(fade.maskLeft + fade.stops[2]).toBeCloseTo(
    fade.stripRight - WORKSPACE_TAB_EDGE_FADE_WIDTH_PX,
    1,
  );
  expect(fade.maskLeft + fade.stops[3]).toBeCloseTo(fade.stripRight, 1);
  await strip.evaluate((element) => (element.scrollLeft = element.scrollWidth));
  await expect(strip).toHaveAttribute('data-fade-left', 'true');
  await expect(strip).toHaveAttribute('data-fade-right', 'false');
  await expect(mask).toHaveCount(0);
  await strip.evaluate((element) => (element.scrollLeft = 0));
  await expect(strip).toHaveAttribute('data-fade-left', 'false');
  await expect(strip).toHaveAttribute('data-fade-right', 'true');
  await expectMaskAttachedToActiveTab(component);

  await component.update({ props: { activeWorkspaceId: 'geometry-gamma' } });
  await page.waitForTimeout(250);
  await strip.evaluate((element) => (element.scrollLeft = 0));
  await expect(mask).toHaveCount(0);
});

test('keeps the border fade aligned when the active flare or body enters it', async ({ mount }) => {
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { activeWorkspaceId: 'geometry-beta' },
  });
  const strip = component.locator('[data-workspace-tab-strip]');
  const active = component.locator('[data-workspace-tab][data-active="true"]');
  const mask = component.locator('[data-active-tab-border-mask]');

  for (const activeOffset of [44, 28]) {
    await strip.evaluate((element, targetOffset) => {
      const activeTab = document.querySelector<HTMLElement>(
        '[data-workspace-tab][data-active="true"]',
      );
      if (!activeTab) throw new Error('Missing active tab');
      element.scrollLeft +=
        activeTab.getBoundingClientRect().left -
        element.getBoundingClientRect().left -
        targetOffset;
    }, activeOffset);
    await expect(strip).toHaveAttribute('data-fade-left', 'true');
    await expect
      .poll(async () => {
        const [stripBox, activeBox, maskBox] = await Promise.all([
          strip.boundingBox(),
          active.boundingBox(),
          mask.boundingBox(),
        ]);
        if (!stripBox || !activeBox || !maskBox) return null;
        return {
          activeOffset: activeBox.x - stripBox.x,
          maskOffset: maskBox.x - activeBox.x,
        };
      })
      .toEqual({ activeOffset, maskOffset: 0 });
    const fade = await getBorderMaskFadeStops(component);
    expect(fade.maskLeft + fade.stops[0]).toBeCloseTo(
      fade.stripLeft + WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX,
      1,
    );
    expect(fade.maskLeft + fade.stops[1]).toBeCloseTo(
      fade.stripLeft + WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX + WORKSPACE_TAB_EDGE_FADE_WIDTH_PX,
      1,
    );
  }
});

test('removes both edge fades when every tab fits', async ({ mount }) => {
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: {
      activeWorkspaceId: 'geometry-alpha',
      initialOpenWorkspaceIds: ['geometry-alpha'],
    },
  });
  const strip = component.locator('[data-workspace-tab-strip]');
  await expect
    .poll(() => strip.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await expect(strip).toHaveAttribute('data-fade-left', 'false');
  await expect(strip).toHaveAttribute('data-fade-right', 'false');
  await expect(strip).toHaveCSS('mask-image', 'none');
  await expect(component.locator('[data-active-tab-border-mask]')).toHaveCSS('mask-image', 'none');
});

test('renders both flare strokes on the panel border rows at 1x and 2x', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { activeWorkspaceId: 'geometry-beta' },
  });
  await component.locator('.workspace-controls').evaluate((controls) => {
    const element = controls as HTMLElement;
    element.style.width = '650px';
    element.style.flex = 'none';
  });
  await page.waitForTimeout(WORKSPACE_TAB_MOTION_DURATION_MS + 50);
  await component.evaluate((root) => {
    (root as HTMLElement).style.setProperty('--sidebar', '0 0% 100%');
    (root as HTMLElement).style.setProperty('--border', '0 0% 0%');
    for (const path of root.querySelectorAll<SVGPathElement>('path.stroke-border')) {
      path.style.stroke = 'rgb(0 0 0)';
    }
  });
  for (const zoom of [1, 2]) {
    await component.evaluate((root, value) => {
      (root as HTMLElement).style.transform = `scale(${value})`;
      (root as HTMLElement).style.transformOrigin = 'top left';
    }, zoom);
    await page.waitForTimeout(200);
    const geometry = await getFlareEndpointGeometry(component);
    expect(Math.abs(geometry.leadingStart.x - geometry.tabLeftBorderCenter)).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(geometry.trailingStart.x - geometry.tabRightBorderCenter)).toBeLessThanOrEqual(
      0.5,
    );
    await expectRenderedFlareJoinsPanelBorder(page, component, zoom);
  }
});

test('grows and removes a tab while the active mask follows the shared motion', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { initialOpenWorkspaceIds: ['geometry-alpha', 'geometry-beta'], interactive: true },
  });
  await component.locator('.workspace-controls').evaluate((controls) => {
    const element = controls as HTMLElement;
    element.style.width = '650px';
    element.style.flex = 'none';
  });
  const tab = component.locator('[data-workspace-tab-motion="geometry-gamma"]');
  const naturalWidth = await component
    .locator('[data-workspace-tab-motion="geometry-beta"]')
    .evaluate((element) => element.getBoundingClientRect().width);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  const openingFrames = await captureTabMotion(
    component.locator('[data-open-tab]'),
    'geometry-gamma',
  );
  expect(
    openingFrames.some(({ width }) => width !== null && width > 0 && width < naturalWidth),
  ).toBe(true);
  const openingVisual = openingFrames.flatMap(({ visualY, visualOpacity }) =>
    visualY === null || visualOpacity === null ? [] : [{ visualY, visualOpacity }],
  );
  expect(openingVisual.some((frame) => frame.visualY > openingVisual.at(-1)!.visualY + 1)).toBe(
    true,
  );
  expect(openingVisual.some((frame) => frame.visualOpacity > 0 && frame.visualOpacity < 1)).toBe(
    true,
  );
  const openingLauncher = openingFrames.flatMap((frame) =>
    frame.launcherLeft === null ? [] : [frame.launcherLeft],
  );
  expect(Math.max(...openingLauncher) - Math.min(...openingLauncher)).toBeGreaterThan(8);
  expect(
    Math.min(...openingLauncher.slice(1).map((value, index) => value - openingLauncher[index])),
  ).toBeGreaterThan(-8);
  expect(
    openingFrames.some(
      ({ width, activeId, maskLeftDelta, maskWidthDelta }) =>
        width !== null &&
        width > 0 &&
        width < naturalWidth &&
        activeId === 'geometry-gamma' &&
        maskLeftDelta !== null &&
        maskLeftDelta <= 1 &&
        maskWidthDelta !== null &&
        maskWidthDelta <= 1,
    ),
  ).toBe(true);
  await expect(tab).toHaveCount(1);
  expect(await tab.evaluate((element) => element.getBoundingClientRect().width)).toBe(naturalWidth);
  await component.page().waitForTimeout(50);

  const closingFrames = await captureTabMotion(
    component.locator('[data-workspace-tab="geometry-gamma"] [data-workspace-tab-close]'),
    'geometry-gamma',
  );
  expect(
    closingFrames.some(({ width }) => width !== null && width > 0 && width < naturalWidth),
  ).toBe(true);
  const closingVisual = closingFrames.flatMap(({ visualY, visualOpacity }) =>
    visualY === null || visualOpacity === null ? [] : [{ visualY, visualOpacity }],
  );
  expect(closingVisual.some((frame) => frame.visualY > closingVisual[0].visualY + 1)).toBe(true);
  expect(closingVisual.some((frame) => frame.visualOpacity > 0 && frame.visualOpacity < 1)).toBe(
    true,
  );
  const closingLauncher = closingFrames.flatMap((frame) =>
    frame.launcherLeft === null ? [] : [frame.launcherLeft],
  );
  expect(
    Math.max(...closingLauncher) - Math.min(...closingLauncher),
    JSON.stringify(
      closingFrames.map(({ width, launcherLeft, scrollWidth, clientWidth, hasOverflow }) => ({
        width,
        launcherLeft,
        scrollWidth,
        clientWidth,
        hasOverflow,
      })),
    ),
  ).toBeGreaterThan(8);
  expect(
    Math.max(...closingLauncher.slice(1).map((value, index) => value - closingLauncher[index])),
  ).toBeLessThan(8);
  const closingScroll = closingFrames.flatMap((frame) =>
    frame.scrollLeft === null ? [] : [frame.scrollLeft],
  );
  expect(countMotionReversals(closingScroll)).toBe(0);
  expect(closingFrames.some(({ width }) => width === null)).toBe(true);
  expect(
    closingFrames.some(
      ({ width, activeId }) =>
        width !== null &&
        width > 0 &&
        width < naturalWidth &&
        activeId !== null &&
        activeId !== 'geometry-gamma',
    ),
  ).toBe(true);
  await expect(tab).toHaveCount(0);

  await expectMaskAttachedToActiveTab(component);
});

for (const controlsWidth of [650, 490, 360]) {
  test(`reopens a tab during its outro at ${controlsWidth}px without losing the tab`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const component = await mount(WorkspaceTabStripGeometryPreview, {
      props: {
        initialOpenWorkspaceIds: ['geometry-alpha', 'geometry-beta', 'geometry-gamma'],
        activeWorkspaceId: 'geometry-gamma',
        interactive: true,
      },
    });
    await component.locator('.workspace-controls').evaluate((controls, width) => {
      const element = controls as HTMLElement;
      element.style.width = `${width}px`;
      element.style.flex = 'none';
    }, controlsWidth);
    await page.waitForTimeout(WORKSPACE_TAB_MOTION_DURATION_MS + 50);

    const interruptedWidth = await component
      .locator('[data-close-tab]')
      .evaluate(async (button) => {
        const slot = document.querySelector<HTMLElement>(
          '[data-workspace-tab-motion="geometry-gamma"]',
        );
        if (!slot) throw new Error('Missing gamma tab slot');
        (button as HTMLButtonElement).click();
        for (let frame = 0; frame < 120; frame += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const width = slot.getBoundingClientRect().width;
          if (width > 30 && width < 140) return width;
        }
        return slot.getBoundingClientRect().width;
      });
    expect(interruptedWidth).toBeGreaterThan(30);
    expect(interruptedWidth).toBeLessThan(140);
    await component.locator('[data-open-tab]').click();
    await page.waitForTimeout(1_000);

    const tabOrder = await component
      .locator('[data-workspace-tab]')
      .evaluateAll((tabs) => tabs.map((tab) => (tab as HTMLElement).dataset.workspaceTab));
    const settledWidths = await component
      .locator('[data-workspace-tab-motion]')
      .evaluateAll((slots) => slots.map((slot) => slot.getBoundingClientRect().width));
    const activeAnimationCount = await component
      .locator('[data-workspace-tab-motion]')
      .evaluateAll(
        (slots) =>
          slots
            .flatMap((slot) => slot.getAnimations())
            .filter((animation) => animation.playState !== 'finished').length,
      );
    const evidence = JSON.stringify({
      interruptedWidth,
      pageErrors,
      tabOrder,
      settledWidths,
      activeAnimationCount,
    });
    expect(pageErrors, evidence).toEqual([]);
    expect(tabOrder, evidence).toEqual(['geometry-alpha', 'geometry-beta', 'geometry-gamma']);
    expect(settledWidths, evidence).toEqual([160, 160, 160]);
    expect(activeAnimationCount, evidence).toBe(0);
  });
}

test('closes the active rightmost tab without reversing an overflowing strip', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: {
      initialOpenWorkspaceIds: ['geometry-alpha', 'geometry-beta', 'geometry-gamma'],
      activeWorkspaceId: 'geometry-gamma',
      interactive: true,
    },
  });
  await component.locator('.workspace-controls').evaluate((controls) => {
    const element = controls as HTMLElement;
    element.style.width = '490px';
    element.style.flex = 'none';
  });
  await page.waitForTimeout(WORKSPACE_TAB_MOTION_DURATION_MS + 50);
  await component.locator('[data-workspace-tab-strip]').evaluate((strip) => {
    strip.scrollLeft = strip.scrollWidth;
    strip.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(50);

  const frames = await captureTabMotion(
    component.locator('[data-workspace-tab="geometry-gamma"] [data-workspace-tab-close]'),
    'geometry-gamma',
  );
  const widths = frames.flatMap((frame) => (frame.width === null ? [] : [frame.width]));
  const visual = frames.flatMap(({ visualY, visualOpacity }) =>
    visualY === null || visualOpacity === null ? [] : [{ visualY, visualOpacity }],
  );
  const scroll = frames.flatMap((frame) => (frame.scrollLeft === null ? [] : [frame.scrollLeft]));
  const scrollWidths = frames.flatMap((frame) =>
    frame.scrollWidth === null ? [] : [frame.scrollWidth],
  );
  const launcher = frames.flatMap((frame) =>
    frame.launcherLeft === null ? [] : [frame.launcherLeft],
  );
  const targetGaps = frames.flatMap(({ tabRects }) => {
    const targetIndex = tabRects.findIndex(([id]) => id === 'geometry-gamma');
    if (targetIndex < 1) return [];
    const previous = tabRects[targetIndex - 1][1];
    return [tabRects[targetIndex][1].left - previous.left - previous.width];
  });

  expect(widths.some((width) => width > 1 && width < 159)).toBe(true);
  expect(visual.some((frame) => frame.visualY > visual[0].visualY + 1)).toBe(true);
  expect(visual.some((frame) => frame.visualOpacity > 0 && frame.visualOpacity < 1)).toBe(true);
  expect(countMotionReversals(scroll), JSON.stringify(scroll)).toBe(0);
  expect(
    scroll.slice(1).every((value, index) => value <= scroll[index] + 0.5),
    JSON.stringify(scroll),
  ).toBe(true);
  expect(
    Math.max(...scroll.slice(1).map((value, index) => Math.abs(value - scroll[index]))),
    JSON.stringify(frames),
  ).toBeLessThanOrEqual(WORKSPACE_TAB_SCROLL_TRACE_TOLERANCE_PX);
  expect(scroll.at(-1), JSON.stringify(frames.slice(-8))).toBeLessThanOrEqual(1);
  expect(Math.max(...scrollWidths) - scrollWidths[0]).toBeLessThanOrEqual(1);
  expect(scrollWidths.at(-1), JSON.stringify(frames.slice(-8))).toBe(frames.at(-1)?.clientWidth);
  expect(
    Math.max(...launcher.slice(1).map((value, index) => Math.abs(value - launcher[index]))),
    JSON.stringify(frames.slice(-12)),
  ).toBeLessThanOrEqual(8);
  expect(countMotionReversals(launcher), JSON.stringify(launcher)).toBe(0);
  expect(Math.min(...targetGaps), JSON.stringify(targetGaps)).toBeGreaterThanOrEqual(-1);
  expect(
    frames
      .filter((frame) => (frame.scrollLeft ?? 0) > 0.5)
      .every((frame) => frame.fadesLeft && frame.stripMaskImage !== 'none'),
    JSON.stringify(
      frames.map(({ scrollLeft, fadesLeft, stripMaskImage }) => ({
        scrollLeft,
        fadesLeft,
        stripMaskImage,
      })),
    ),
  ).toBe(true);
  const trackedMaskFrames = frames.filter(
    (frame) =>
      frame.width !== null &&
      frame.width > 1 &&
      frame.width < 159 &&
      frame.maskLeftDelta !== null &&
      frame.maskWidthDelta !== null,
  );
  expect(trackedMaskFrames.every((frame) => frame.maskTransitionDuration === '0s')).toBe(true);
  expect(
    trackedMaskFrames.every(
      (frame) => Math.abs(frame.maskLeftDelta!) < 1 && Math.abs(frame.maskWidthDelta!) < 1,
    ),
  ).toBe(true);
  const settledMaskFrames = frames.filter(
    (frame) => frame.maskLeftDelta !== null && frame.maskWidthDelta !== null,
  );
  expect(
    settledMaskFrames
      .slice(-8)
      .every((frame) => Math.abs(frame.maskLeftDelta!) < 1 && Math.abs(frame.maskWidthDelta!) < 1),
  ).toBe(true);
});

test('closes an active middle tab with monotonic neighbor and launcher motion', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: {
      initialOpenWorkspaceIds: ['geometry-alpha', 'geometry-beta', 'geometry-gamma'],
      activeWorkspaceId: 'geometry-beta',
      interactive: true,
    },
  });
  await component.locator('.workspace-controls').evaluate((controls) => {
    const element = controls as HTMLElement;
    element.style.width = '650px';
    element.style.flex = 'none';
  });
  await page.waitForTimeout(WORKSPACE_TAB_MOTION_DURATION_MS + 50);

  const frames = await captureTabMotion(
    component.locator('[data-workspace-tab="geometry-beta"] [data-workspace-tab-close]'),
    'geometry-beta',
  );
  const gammaLeft = frames.flatMap((frame) => {
    const rect = frame.tabRects.find(([id]) => id === 'geometry-gamma')?.[1];
    return rect ? [rect.left] : [];
  });
  const launcher = frames.flatMap((frame) =>
    frame.launcherLeft === null ? [] : [frame.launcherLeft],
  );
  const visual = frames.flatMap(({ visualY, visualOpacity }) =>
    visualY === null || visualOpacity === null ? [] : [{ visualY, visualOpacity }],
  );
  const targetGaps = frames.flatMap(({ tabRects }) => {
    const targetIndex = tabRects.findIndex(([id]) => id === 'geometry-beta');
    if (targetIndex < 1) return [];
    const previous = tabRects[targetIndex - 1][1];
    return [tabRects[targetIndex][1].left - previous.left - previous.width];
  });

  expect(Math.max(...gammaLeft) - Math.min(...gammaLeft)).toBeGreaterThan(5);
  expect(countMotionReversals(gammaLeft)).toBe(0);
  expect(Math.min(...targetGaps), JSON.stringify(targetGaps)).toBeGreaterThanOrEqual(-1);
  expect(Math.max(...launcher) - Math.min(...launcher)).toBeGreaterThan(100);
  expect(
    Math.max(...launcher.slice(1).map((value, index) => value - launcher[index])),
  ).toBeLessThan(8);
  const removalIndex = frames.findIndex((frame) => frame.width === null);
  const postRemovalLauncher = frames
    .slice(removalIndex)
    .flatMap((frame) => (frame.launcherLeft === null ? [] : [frame.launcherLeft]));
  expect(Math.max(...postRemovalLauncher) - Math.min(...postRemovalLauncher)).toBeLessThan(3);
  expect(visual.some((frame) => frame.visualY > visual[0].visualY + 1)).toBe(true);
  expect(visual.some((frame) => frame.visualOpacity > 0 && frame.visualOpacity < 1)).toBe(true);
  expect(
    frames
      .filter((frame) => frame.width !== null && frame.width > 1 && frame.width < 159)
      .every((frame) => frame.slotOverflow === 'hidden'),
  ).toBe(true);
  expect(
    frames.some(
      (frame) =>
        frame.width !== null &&
        frame.width > 1 &&
        frame.width < 159 &&
        frame.activeId !== null &&
        frame.activeId !== 'geometry-beta',
    ),
    JSON.stringify(frames.map(({ width, activeId }) => ({ width, activeId }))),
  ).toBe(true);
  await expectMaskAttachedToActiveTab(component);
});

test('removes tab lifecycle motion when reduced motion is preferred', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { initialOpenWorkspaceIds: ['geometry-alpha', 'geometry-beta'], interactive: true },
  });
  await page.waitForTimeout(50);
  await expect(component.locator('[data-active-tab-border-mask]')).toHaveCSS(
    'transition-property',
    'none',
  );

  const openingFrames = await captureTabMotion(
    component.locator('[data-open-tab]'),
    'geometry-gamma',
  );
  expect(
    openingFrames.some((frame) => frame.width !== null && frame.width > 1 && frame.width < 159),
  ).toBe(false);
  expect(
    openingFrames.some(
      (frame) => frame.visualOpacity !== null && frame.visualOpacity > 0 && frame.visualOpacity < 1,
    ),
  ).toBe(false);

  const closingFrames = await captureTabMotion(
    component.locator('[data-workspace-tab="geometry-gamma"] [data-workspace-tab-close]'),
    'geometry-gamma',
  );
  expect(
    closingFrames.some((frame) => frame.width !== null && frame.width > 1 && frame.width < 159),
  ).toBe(false);
  await expect(component.locator('[data-workspace-tab-motion="geometry-gamma"]')).toHaveCount(0);
  expect(
    closingFrames
      .filter((frame) => frame.maskLeftDelta !== null && frame.maskWidthDelta !== null)
      .slice(-8)
      .every((frame) => Math.abs(frame.maskLeftDelta!) < 1 && Math.abs(frame.maskWidthDelta!) < 1),
  ).toBe(true);
});

test('matches the closed-sidebar logo gap to the tab gap while the flare stays visible', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { activeWorkspaceId: 'geometry-alpha', sidebarPanelOpen: false },
  });

  const [closedGap, interTabGap] = await Promise.all([
    getLogoToLeadingFlareGap(component),
    getInterTabGap(component),
  ]);
  expect(Math.abs(closedGap - Math.max(interTabGap, 4))).toBeLessThanOrEqual(1);
  expect(await getLeadingEdgeGeometry(component)).toEqual({
    curveEnd: 26,
    clipStart: 46,
    fadeEnd: 70,
    firstTab: 36,
  });
  await expectVisibleThroughAncestorClipping(
    component.locator('[data-workspace-tab="geometry-alpha"] [data-workspace-tab-leading-flare]'),
  );

  await component.update({
    props: { activeWorkspaceId: 'geometry-alpha', sidebarPanelOpen: true },
  });
  await expect.poll(() => getLogoToLeadingFlareGap(component)).toBeCloseTo(22, 0);
  await expect
    .poll(() => getLeadingEdgeGeometry(component))
    .toEqual({
      curveEnd: 26,
      clipStart: 60,
      fadeEnd: 84,
      firstTab: 54,
    });
  await expectMaskAttachedToActiveTab(component);
});

test('settles tab lifecycle changes immediately with reduced motion', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { initialOpenWorkspaceIds: ['geometry-alpha', 'geometry-beta'], interactive: true },
  });
  const tab = component.locator('[data-workspace-tab-motion="geometry-gamma"]');
  await expect(component.locator('[data-workspace-tab-strip]')).toHaveCSS(
    'transition-property',
    'none',
  );

  await component.locator('[data-open-tab]').click();
  await expect(tab).toHaveCount(1);
  expect(await tab.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(
    100,
  );
  await component
    .locator('[data-workspace-tab="geometry-gamma"] [data-workspace-tab-close]')
    .click();
  await expect(tab).toHaveCount(0);
});
