import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelColumnRailHost from './mocks/PanelColumnRailHost.svelte';

test('reserves 100px and changes the visible count with keyboard input in both themes', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelColumnRailHost);
  const rail = component.locator('[data-panel-column-rail]');
  const content = component.locator('[data-panel-content]');
  const trigger = component.locator('[data-panel-column-count-trigger]');

  for (const theme of ['light', 'dark'] as const) {
    await component.update({ props: { theme, width: 500, initialCount: 2 } });
    const [contentBox, railBox] = await Promise.all([content.boundingBox(), rail.boundingBox()]);
    expect(railBox!.width).toBe(100);
    expect(contentBox!.x + contentBox!.width).toBeCloseTo(railBox!.x, 1);
    await expect(trigger).toHaveAccessibleName('Panel columns: 2');
    await expect(trigger.locator('svg')).toHaveAttribute('stroke-width', '2');
    await expect(trigger.locator('rect')).toHaveCount(2);
    expect(
      Number.parseFloat(
        await trigger.evaluate((node) => getComputedStyle(node).transitionDuration),
      ),
    ).toBeLessThan(0.001);

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitemradio', { name: '4 columns' })).toBeVisible();
    await page.getByRole('menuitemradio', { name: '4 columns' }).click();
    await expect(component).toHaveAttribute('data-current-count', '4');
    await expect(component.locator('[data-panel-column-count]')).toHaveText('4');
    await expect(component.locator('[data-panel-column-count-icon] rect')).toHaveCount(4);

    await trigger.click();
    await page.getByRole('menuitemradio', { name: '2 columns' }).click();
    await expect(component).toHaveAttribute('data-current-count', '2');
  }
});
