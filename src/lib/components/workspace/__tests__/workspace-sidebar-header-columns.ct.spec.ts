import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelHeaderActionsHost from '../../layout/panel-system/__tests__/mocks/PanelHeaderActionsHost.svelte';

test.setTimeout(60_000);

for (const theme of ['light', 'dark'] as const) {
  for (const width of [240, 560]) {
    for (const zoom of [1, 2]) {
      test(`keeps one crisp panel column control in ${theme} at ${width}px and ${zoom * 100}% zoom`, async ({
        mount,
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const component = await mount(PanelHeaderActionsHost, {
          props: { theme, width, zoom, initialCount: 2 },
        });
        const header = component.locator('[data-panel-tabless-header]');
        const controls = header.locator('[data-panel-header-actions]');
        const columnTrigger = controls.locator('[data-panel-column-count-trigger]');
        const actionsTrigger = controls.locator('[data-testid="panel-actions-trigger"]');
        const closeTrigger = controls.locator('[data-testid="panel-close-button"]');

        await expect(columnTrigger).toHaveCount(1);
        expect(
          await controls
            .locator('button')
            .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
        ).toEqual([
          'Panel columns: 2',
          'More',
          'Panel history',
          'Go back',
          'Go forward',
          'Close panel',
        ]);
        const [headerBox, titleBox, controlsBox] = await Promise.all([
          header.boundingBox(),
          header.locator('[data-panel-header-title]').boundingBox(),
          controls.boundingBox(),
        ]);
        expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(controlsBox!.x + 0.5);
        expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(
          headerBox!.x + headerBox!.width + 0.5,
        );
        await expect(columnTrigger).toHaveAccessibleName('Panel columns: 2');
        await expect(controls.locator('[data-panel-column-icon]')).toHaveCount(0);
        for (const action of [columnTrigger, actionsTrigger, closeTrigger]) {
          const box = await action.boundingBox();
          expect(box!.width / zoom).toBeCloseTo(28, 0);
          expect(box!.height / zoom).toBeCloseTo(28, 0);
        }
      });
    }
  }
}

test('updates the workspace-scoped count and keeps keyboard focus order', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelHeaderActionsHost, {
    props: { initialCount: 2 },
  });
  const trigger = component.locator('[data-panel-column-count-trigger]');

  await trigger.focus();
  await expect(page.getByRole('tooltip')).toContainText('Change panel column count. Current: 2');
  await page.keyboard.press('Enter');
  const radios = page.getByRole('menuitemradio');
  await expect(radios).toHaveCount(4);
  await expect(page.getByRole('menuitemradio', { name: '2 columns' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: '4 columns' }).click();
  await expect(component).toHaveAttribute('data-current-count', '4');
  await expect(trigger).toHaveAccessibleName('Panel columns: 4');

  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'More');
});
