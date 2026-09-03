import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import WorkspaceTabStripGeometryPreview from './workspace-tab-strip-geometry.preview.svelte';
import { WORKSPACE_TAB_FLARE_RADIUS_PX } from './titlebar-geometry';

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
  expect(
    Math.abs((maskBox?.x ?? 0) + WORKSPACE_TAB_FLARE_RADIUS_PX - (activeBox?.x ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((maskBox?.width ?? 0) - 2 * WORKSPACE_TAB_FLARE_RADIUS_PX - (activeBox?.width ?? 0)),
  ).toBeLessThanOrEqual(1);
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
    async (button, { id, radius }) => {
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
          activeRect && stripRect ? Math.max(activeRect.left - radius, stripRect.left) : null;
        const expectedMaskRight =
          activeRect && stripRect ? Math.min(activeRect.right + radius, stripRect.right) : null;
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
    { id: workspaceId, radius: WORKSPACE_TAB_FLARE_RADIUS_PX },
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
  await strip.evaluate((element) => (element.scrollLeft = 100));
  await expect(mask).toHaveCSS('transition', 'none');
  await expect
    .poll(async () => {
      const [stripBox, maskBox] = await Promise.all([strip.boundingBox(), mask.boundingBox()]);
      if (!stripBox || !maskBox) return false;
      return maskBox.x >= stripBox.x && maskBox.x + maskBox.width <= stripBox.x + stripBox.width;
    })
    .toBe(true);
  await strip.evaluate((element) => (element.scrollLeft = element.scrollWidth));
  await expect(mask).toHaveCount(0);
  await strip.evaluate((element) => (element.scrollLeft = 0));
  await expectMaskAttachedToActiveTab(component);

  await component.update({ props: { activeWorkspaceId: 'geometry-gamma' } });
  await page.waitForTimeout(250);
  await strip.evaluate((element) => (element.scrollLeft = 0));
  await expect(mask).toHaveCount(0);
});

test('joins both flare strokes to the tab and titlebar borders at 1x and 2x', async ({ mount }) => {
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { activeWorkspaceId: 'geometry-beta' },
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
    expect(Math.abs(geometry.leadingEnd.y - geometry.titlebarBorderCenter)).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(geometry.trailingEnd.y - geometry.titlebarBorderCenter)).toBeLessThanOrEqual(
      0.5,
    );
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

test('tightens the closed-sidebar inset while the flare and mask remain attached', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { activeWorkspaceId: 'geometry-alpha', sidebarPanelOpen: false },
  });

  const closedGap = await getLogoToLeadingFlareGap(component);
  expect(closedGap).toBeLessThanOrEqual(4);
  await expectVisibleThroughAncestorClipping(
    component.locator('[data-workspace-tab="geometry-alpha"] [data-workspace-tab-leading-flare]'),
  );

  await component.update({
    props: { activeWorkspaceId: 'geometry-alpha', sidebarPanelOpen: true },
  });
  await expect.poll(() => getLogoToLeadingFlareGap(component)).toBeCloseTo(closedGap + 13, 0);
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
