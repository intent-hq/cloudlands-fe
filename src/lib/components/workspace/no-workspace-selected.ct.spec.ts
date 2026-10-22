import { expect, test } from '../../../test/ct-test';
import Preview from './no-workspace-selected.preview.svelte';

for (const width of [390, 1280]) {
  test(`empty Home keeps workspace creation accessible at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const component = await mount(Preview);
    await expect(component.getByRole('heading', { name: 'Your work starts here' })).toBeVisible();
    const action = component
      .locator('[data-slot="empty-state"]')
      .getByRole('button', { name: 'New workspace' });
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(component.locator('[data-create-workspace-requested]')).toHaveText('true');
    const panel = component.locator('[data-home-page]');
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await testInfo.attach('empty-home', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}
