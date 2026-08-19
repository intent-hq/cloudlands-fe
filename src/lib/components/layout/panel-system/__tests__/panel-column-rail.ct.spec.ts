import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelColumnRailHost from './mocks/PanelColumnRailHost.svelte';

test.setTimeout(60_000);

for (const theme of ['light', 'dark'] as const) {
  for (const width of [240, 1200]) {
    for (const zoom of [1, 2]) {
      test(`reserves 100px without overlap in ${theme} at ${width}px and ${zoom * 100}% zoom`, async ({
        mount,
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const component = await mount(PanelColumnRailHost, {
          props: { theme, width, zoom, initialCount: 2 },
        });
        const host = component;
        const rail = component.locator('[data-panel-column-rail]');
        const content = component.locator('[data-panel-content]');
        const trigger = component.locator('[data-panel-column-count-trigger]');
        const [hostBox, contentBox, railBox] = await Promise.all([
          host.boundingBox(),
          content.boundingBox(),
          rail.boundingBox(),
        ]);

        expect(railBox!.width / zoom).toBeCloseTo(100, 1);
        expect(contentBox!.x + contentBox!.width).toBeCloseTo(railBox!.x, 1);
        expect(railBox!.x + railBox!.width).toBeCloseTo(hostBox!.x + hostBox!.width, 1);
        await expect(trigger).toHaveAccessibleName('Panel columns: 2');
        await expect(trigger.locator('svg')).toHaveAttribute('stroke-width', '2');
        await expect(trigger.locator('rect')).toHaveCount(2);
        expect(
          Number.parseFloat(
            await trigger.evaluate((node) => getComputedStyle(node).transitionDuration),
          ),
        ).toBeLessThan(0.001);
      });
    }
  }
}

test('keeps the selector, tooltip, and surrounding focus order keyboard-operable', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelColumnRailHost, { props: { initialCount: 2 } });
  const trigger = component.locator('[data-panel-column-count-trigger]');

  await component.getByTestId('before-column-rail').focus();
  await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('Change panel column count. Current: 2');
  await expect(tooltip).toHaveCSS('animation-name', 'none');

  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: '4 columns' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: '4 columns' }).click();
  await expect(component).toHaveAttribute('data-current-count', '4');
  await expect(component.locator('[data-panel-column-count]')).toHaveText('4');
  await expect(component.locator('[data-panel-column-count-icon] rect')).toHaveCount(4);

  await page.keyboard.press('Tab');
  await expect(component.getByTestId('after-column-rail')).toBeFocused();
});
