import { expect, test } from '@playwright/experimental-ct-svelte';
import WorkspaceColumnsRevealHarness from './mocks/WorkspaceColumnsRevealHarness.svelte';

test('fully reveals and consumes an equivalent panel request at 200% zoom', async ({ mount }) => {
  const component = await mount(WorkspaceColumnsRevealHarness, {
    props: { viewportWidth: 400, zoom: 2 },
  });
  const host = component.locator('[data-reveal-host]');
  const state = component.locator('[data-reveal-state]');
  const scroller = component.locator('[data-workspace-columns]');
  const target = component.locator('[data-panel-id="target-panel"]');

  await expect(target).toBeVisible();
  expect(await host.evaluate((node) => node.getBoundingClientRect().width)).toBe(800);
  const before = await Promise.all([scroller.boundingBox(), target.boundingBox()]);
  expect(before[1]!.x + before[1]!.width).toBeGreaterThan(before[0]!.x + before[0]!.width + 1);

  await component.locator('[data-reveal-trigger]').click();
  await expect(state).toHaveAttribute('data-saw-pending-reveal', 'true');
  await expect(state).toHaveAttribute('data-pending-panel-reveal', '');
  await expect
    .poll(async () => {
      const [viewport, panel] = await Promise.all([scroller.boundingBox(), target.boundingBox()]);
      return {
        leftVisible: panel!.x >= viewport!.x - 1,
        rightVisible: panel!.x + panel!.width <= viewport!.x + viewport!.width + 1,
      };
    })
    .toEqual({ leftVisible: true, rightVisible: true });
  expect(await scroller.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await expect(component.locator('[data-panel-id]')).toHaveCount(2);
});
