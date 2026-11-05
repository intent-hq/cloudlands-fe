import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../test/ct-test';
import { expectDismissibleLayerArmed } from '../../../test/dismissible-layer';
import WorkspaceTabStripGeometryPreview from './workspace-tab-strip-geometry.preview.svelte';
import WorkspaceTabMenuHarness from './WorkspaceTabMenuHarness.svelte';

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

test('keeps the leading flare visible', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(WorkspaceTabStripGeometryPreview, {
    props: { activeWorkspaceId: 'geometry-alpha' },
  });

  await expectVisibleThroughAncestorClipping(
    component.locator('[data-workspace-tab="geometry-alpha"] [data-workspace-tab-leading-flare]'),
  );

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
  await expect(tab).toBeVisible();
  await component
    .locator('[data-workspace-tab="geometry-gamma"] [data-workspace-tab-close]')
    .click();
  await expect(tab).toHaveCount(0);
});

for (const zoomFactor of [1, 1.1, 1.25]) {
  test(`active tab meets the panel and keeps its close target usable at zoom ${zoomFactor}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(WorkspaceTabStripGeometryPreview, {
      props: { activeWorkspaceId: 'geometry-alpha', zoomFactor },
    });
    await expectMaskAttachedToActiveTab(component);
    const close = component.locator(
      '[data-workspace-tab][data-active="true"] [data-workspace-tab-close]',
    );
    const target = await close.boundingBox();
    expect((target?.width ?? 0) * zoomFactor).toBeGreaterThanOrEqual(24);
    expect((target?.height ?? 0) * zoomFactor).toBeGreaterThanOrEqual(24);
    const tab = await component.locator('[data-workspace-tab][data-active="true"]').boundingBox();
    const panel = await component.locator('[data-preview-panel]').boundingBox();
    if (!tab || !panel) throw new Error('Missing seam geometry');
    expect(Math.abs(tab.y + tab.height - panel.y)).toBeLessThan(0.1);
  });
}

test('tab context menu stays actionable over the neighboring active tab', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 900, height: 600 });
  const component = await mount(WorkspaceTabMenuHarness);
  const source = component.locator('[data-workspace-tab="geometry-alpha"]');
  const neighbor = component.locator('[data-workspace-tab="geometry-beta"]');
  await expect(neighbor).toHaveAttribute('data-active', 'true');
  // Open near the right edge and top of the inactive tab, so Close crosses the active tab.
  const sourceBox = (await source.boundingBox())!;
  await source.click({ button: 'right', position: { x: sourceBox.width - 20, y: 2 } });
  const close = page.getByRole('menuitem', { name: 'Close', exact: true });
  await expect(close).toBeVisible();
  // Wait for popup positioning and actionability without invoking the action.
  await close.click({ trial: true });
  // Clear the trial-click highlight before capturing the menu for manual review.
  await page.mouse.move(850, 300);
  await expect(close).not.toHaveAttribute('data-highlighted');
  const [closeBox, neighborBox] = await Promise.all([close.boundingBox(), neighbor.boundingBox()]);
  const left = Math.max(closeBox!.x, neighborBox!.x);
  const right = Math.min(closeBox!.x + closeBox!.width, neighborBox!.x + neighborBox!.width);
  const top = Math.max(closeBox!.y, neighborBox!.y);
  const bottom = Math.min(closeBox!.y + closeBox!.height, neighborBox!.y + neighborBox!.height);
  expect(right - left, 'Close overlaps the neighboring tab horizontally').toBeGreaterThan(0);
  expect(bottom - top, 'Close overlaps the neighboring tab vertically').toBeGreaterThan(0);
  const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const screenshot = await page.screenshot();
  await testInfo.attach('tab-context-menu-overlap', {
    body: screenshot,
    contentType: 'image/png',
  });
  expect(
    await close.evaluate(
      (element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
      point,
    ),
    'Close must receive pointer input in the overlapping region',
  ).toBe(true);
  // eslint-disable-next-line intent/no-unarmed-outside-click-in-ct -- activates the menu's Close item; not an outside dismissal
  await page.mouse.click(point.x, point.y);
  await expect(source).toHaveCount(0);
  await expect(neighbor).toHaveAttribute('data-active', 'true');
  await expect(component.locator('[data-workspace-tab="geometry-gamma"]')).toBeVisible();
  await expect(close).toHaveCount(0);
});

test('tab context menu dismisses and restores keyboard focus', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 900, height: 600 });
  const component = await mount(WorkspaceTabMenuHarness);
  const source = component.locator('[data-workspace-tab="geometry-alpha"] [role="tab"]');
  const neighbor = component.locator('[data-workspace-tab="geometry-beta"]');
  await source.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(source).toBeFocused();
  await source.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expectDismissibleLayerArmed(menu);
  await page.mouse.click(850, 300);
  await expect(menu).toHaveCount(0);
  await expect(source).toBeFocused();
  await expect(neighbor).toHaveAttribute('data-active', 'true');
});

test('tab context menu outside click waits for a delayed dismissal setup', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 900, height: 600 });
  const component = await mount(WorkspaceTabMenuHarness);
  const source = component.locator('[data-workspace-tab="geometry-alpha"] [role="tab"]');
  // Delay bits-ui's afterSleep(1) listener setup, as a busy page can. An
  // outside click sent before setup completes is lost and the menu stays open.
  await page.evaluate(() => {
    const setTimeoutNative = window.setTimeout;
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      setTimeoutNative(handler, timeout === 1 ? 500 : timeout, ...args)) as typeof setTimeout;
  });
  await source.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expectDismissibleLayerArmed(menu);
  await page.mouse.click(850, 300);
  await expect(menu).toHaveCount(0);
  await expect(source).toBeFocused();
});
