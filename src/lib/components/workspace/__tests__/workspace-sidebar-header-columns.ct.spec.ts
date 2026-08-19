import { expect, test } from '@playwright/experimental-ct-svelte';
import WorkspaceSidebarHeaderColumnsHost from './mocks/WorkspaceSidebarHeaderColumnsHost.svelte';

test.setTimeout(60_000);

for (const theme of ['light', 'dark'] as const) {
  for (const width of [240, 560]) {
    for (const zoom of [1, 2]) {
      test(`keeps the column control before workspace actions in ${theme} at ${width}px and ${zoom * 100}% zoom`, async ({
        mount,
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const component = await mount(WorkspaceSidebarHeaderColumnsHost, {
          props: { theme, width, zoom, initialCount: 2 },
        });
        const controls = component.locator('[data-workspace-header-actions]');
        const columnTrigger = controls.locator('[data-panel-column-count-trigger]');
        const actionsTrigger = controls.locator('[data-workspace-actions-kebab]');
        const [hostBox, controlsBox, columnBox, actionsBox] = await Promise.all([
          component.boundingBox(),
          controls.boundingBox(),
          columnTrigger.boundingBox(),
          actionsTrigger.boundingBox(),
        ]);

        expect(columnBox!.x).toBeLessThan(actionsBox!.x);
        expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(
          hostBox!.x + hostBox!.width,
        );
        await expect(columnTrigger).toHaveAccessibleName('Panel columns: 2');
        await expect(columnTrigger.locator('svg')).toHaveAttribute('stroke-width', '2');
        await expect(columnTrigger.locator('rect')).toHaveCount(2);
      });
    }
  }
}

test('updates the workspace-scoped count and keeps keyboard focus order', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceSidebarHeaderColumnsHost, {
    props: { initialCount: 2 },
  });
  const trigger = component.locator('[data-panel-column-count-trigger]');

  await trigger.focus();
  await expect(page.getByRole('tooltip')).toContainText('Change panel column count. Current: 2');
  await page.keyboard.press('Enter');
  await page.getByRole('menuitemradio', { name: '4 columns' }).click();
  await expect(component).toHaveAttribute('data-current-count', '4');
  await expect(trigger.locator('rect')).toHaveCount(4);

  await page.keyboard.press('Tab');
  await expect(component.locator('[data-workspace-actions-kebab]')).toBeFocused();
});
