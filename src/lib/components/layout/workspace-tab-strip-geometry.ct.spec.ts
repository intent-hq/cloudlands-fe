import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import WorkspaceTabStripGeometryPreview from './workspace-tab-strip-geometry.preview.svelte';

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
