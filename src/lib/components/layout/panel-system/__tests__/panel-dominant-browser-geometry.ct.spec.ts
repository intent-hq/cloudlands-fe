import { expect, test } from '../../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import PanelDominantBrowserGeometryHarness from './mocks/PanelDominantBrowserGeometryHarness.svelte';

async function widths(component: Locator) {
  return component
    .locator('.panel-split-container')
    .first()
    .evaluate((root) =>
      Array.from(root.children)
        .filter((element) => element.classList.contains('panel-split-child'))
        .map((element) => (element as HTMLElement).offsetWidth),
    );
}

test('recomputes the dominant panel for sidebar and window changes', async ({ mount }) => {
  const component = await mount(PanelDominantBrowserGeometryHarness, {
    props: { viewportWidth: 1600 },
  });
  await expect.poll(async () => (await widths(component)).every((width) => width > 0)).toBe(true);
  const initial = await widths(component);
  await component.update({ props: { viewportWidth: 1600, sidebarWidth: 280 } });
  await expect.poll(async () => (await widths(component))[0]).toBeLessThan(initial[0]);
  const withSidebar = await widths(component);
  expect(withSidebar[1]).toBe(initial[1]);
  await component.update({ props: { viewportWidth: 1200, sidebarWidth: 280 } });
  await expect.poll(async () => (await widths(component))[0]).toBeLessThan(withSidebar[0]);
  expect((await widths(component))[1]).toBe(initial[1]);
});
