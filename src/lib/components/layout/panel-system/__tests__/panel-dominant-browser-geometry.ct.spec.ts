import { expect, test } from '@playwright/experimental-ct-svelte';
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

test('assigns the exact live remainder and recomputes for sidebar and window changes', async ({
  mount,
}) => {
  const component = await mount(PanelDominantBrowserGeometryHarness, {
    props: { viewportWidth: 1600 },
  });
  await expect.poll(() => widths(component)).toEqual([1312, 280]);

  await component.update({ props: { viewportWidth: 1600, sidebarWidth: 280 } });
  await expect(component.getByTestId('available-viewport')).toHaveJSProperty('clientWidth', 1320);
  await expect.poll(() => widths(component)).toEqual([1032, 280]);

  await component.update({ props: { viewportWidth: 1200, sidebarWidth: 280 } });
  await expect(component.getByTestId('available-viewport')).toHaveJSProperty('clientWidth', 920);
  await expect.poll(() => widths(component)).toEqual([632, 280]);
});

test('keeps compact siblings and horizontal overflow at 200% zoom', async ({ mount }) => {
  const component = await mount(PanelDominantBrowserGeometryHarness, {
    props: { viewportWidth: 1200, zoomFactor: 2 },
  });
  await expect.poll(() => widths(component)).toEqual([500, 280]);
  await expect(component.getByTestId('available-viewport')).toHaveJSProperty('clientWidth', 600);
  await expect(component.getByTestId('panel-workspace-inset')).toHaveJSProperty('clientWidth', 788);
});

test('reserves nested sibling panels and their internal gutter', async ({ mount }) => {
  const component = await mount(PanelDominantBrowserGeometryHarness, {
    props: { viewportWidth: 1600, scenario: 'nested' },
  });
  await expect.poll(() => widths(component)).toEqual([1024, 568]);
  await expect
    .poll(() =>
      component
        .locator('.panel-split-container')
        .nth(1)
        .evaluate((nested) =>
          Array.from(nested.children)
            .filter((element) => element.classList.contains('panel-split-child'))
            .map((element) => (element as HTMLElement).offsetWidth),
        ),
    )
    .toEqual([280, 280]);
  await expect
    .poll(() =>
      component
        .locator('[data-split-gutter="horizontal"]')
        .evaluateAll((gutters) => gutters.map((gutter) => (gutter as HTMLElement).offsetWidth)),
    )
    .toEqual([8, 8]);
});

test('gives a wide target the exact remainder around four compact siblings', async ({ mount }) => {
  const component = await mount(PanelDominantBrowserGeometryHarness, {
    props: { viewportWidth: 2400, scenario: 'wide' },
  });
  await expect.poll(() => widths(component)).toEqual([1248, 280, 280, 280, 280]);
  await expect
    .poll(() =>
      component
        .locator('[data-split-gutter="horizontal"]')
        .evaluateAll((gutters) => gutters.map((gutter) => (gutter as HTMLElement).offsetWidth)),
    )
    .toEqual([8, 8, 8, 8]);
  await expect(component.getByTestId('panel-workspace-inset')).toHaveJSProperty(
    'clientWidth',
    2400,
  );
});
