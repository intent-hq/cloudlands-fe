import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import sharp from 'sharp';
import WorkspaceTabStripGeometryPreview from './workspace-tab-strip-geometry.preview.svelte';
import {
  WORKSPACE_TAB_EDGE_FADE_WIDTH_PX,
  WORKSPACE_TAB_LEADING_EDGE_FADE_OFFSET_PX,
} from './titlebar-geometry';

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
    const panelRows = rowsAt(outsideX, outsideX);
    const joinStart = endpoint.x + Math.min(0, endpoint.direction * 1.5 * zoom);
    const joinEnd = endpoint.x + Math.max(0, endpoint.direction * 1.5 * zoom);
    const joinRows = rowsAt(joinStart, joinEnd);
    expect(panelRows, endpoint.side).not.toHaveLength(0);
    expect(joinRows, endpoint.side).toEqual(panelRows);
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

async function captureTabMotion(control: Locator, workspaceId: string) {
  return control.evaluate(
    async (button, { id }) => {
      const frames: Array<{
        width: number | null;
        activeId: string | null;
        maskLeftDelta: number | null;
        maskWidthDelta: number | null;
      }> = [];
      (button as HTMLButtonElement).click();
      for (let index = 0; index < 40; index += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const motion = document.querySelector<HTMLElement>(`[data-workspace-tab-motion="${id}"]`);
        const active = document.querySelector<HTMLElement>(
          '[data-workspace-tab][data-active="true"]',
        );
        const mask = document.querySelector<HTMLElement>('[data-active-tab-border-mask]');
        const strip = document.querySelector<HTMLElement>('[data-workspace-tab-strip]');
        const activeRect = active?.getBoundingClientRect();
        const maskRect = mask?.getBoundingClientRect();
        const stripRect = strip?.getBoundingClientRect();
        const expectedMaskLeft =
          activeRect && stripRect ? Math.max(activeRect.left, stripRect.left) : null;
        const expectedMaskRight =
          activeRect && stripRect ? Math.min(activeRect.right, stripRect.right) : null;
        frames.push({
          width: motion?.getBoundingClientRect().width ?? null,
          activeId: active?.dataset.workspaceTab ?? null,
          maskLeftDelta:
            maskRect && expectedMaskLeft !== null
              ? Math.abs(maskRect.left - expectedMaskLeft)
              : null,
          maskWidthDelta:
            maskRect && expectedMaskLeft !== null && expectedMaskRight !== null
              ? Math.abs(maskRect.width - (expectedMaskRight - expectedMaskLeft))
              : null,
        });
      }
      return frames;
    },
    { id: workspaceId },
  );
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

  const closingFrames = await captureTabMotion(
    component.locator('[data-workspace-tab="geometry-gamma"] [data-workspace-tab-close]'),
    'geometry-gamma',
  );
  expect(
    closingFrames.some(({ width }) => width !== null && width > 0 && width < naturalWidth),
  ).toBe(true);
  expect(closingFrames.some(({ width }) => width === null)).toBe(true);
  expect(
    closingFrames.some(
      ({ width, activeId }) =>
        width !== null && width > 0 && width < naturalWidth && activeId === 'geometry-gamma',
    ),
  ).toBe(true);
  await expect(tab).toHaveCount(0);

  await expectMaskAttachedToActiveTab(component);
});

test('widens the closed-sidebar logo gap while the flare and mask remain attached', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { activeWorkspaceId: 'geometry-alpha', sidebarPanelOpen: false },
  });

  const closedGap = await getLogoToLeadingFlareGap(component);
  expect(closedGap).toBeGreaterThanOrEqual(8);
  expect(closedGap).toBeLessThanOrEqual(12);
  expect(await getLeadingEdgeGeometry(component)).toEqual({
    curveEnd: 32,
    clipStart: 60,
    fadeEnd: 84,
    firstTab: 50,
  });
  await expectVisibleThroughAncestorClipping(
    component.locator('[data-workspace-tab="geometry-alpha"] [data-workspace-tab-leading-flare]'),
  );

  await component.update({
    props: { activeWorkspaceId: 'geometry-alpha', sidebarPanelOpen: true },
  });
  await expect.poll(() => getLogoToLeadingFlareGap(component)).toBeCloseTo(16, 0);
  await expect
    .poll(() => getLeadingEdgeGeometry(component))
    .toEqual({
      curveEnd: 32,
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
