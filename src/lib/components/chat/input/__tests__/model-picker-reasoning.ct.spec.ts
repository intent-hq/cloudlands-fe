import { expect, test } from '../../../../../test/ct-test';
import ModelPickerGeometryHost from './ModelPickerGeometryHost.svelte';

for (const placement of ['settings', 'composer', 'modal'] as const) {
  test(`chooses model then effort without reopening in ${placement}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(ModelPickerGeometryHost, { props: { placement } });
    const trigger = page.getByTestId('model-picker-host').getByRole('button').first();
    await trigger.click();
    const search = page.getByRole('searchbox');
    if (placement === 'composer') {
      await search.fill('Model 2');
      await search.press('Enter');
      await expect(search).toBeFocused();
    } else {
      await page.getByRole('option', { name: 'Model 2', exact: true }).click();
    }
    await expect(page.getByTestId('selection')).toContainText('"model":"model-2"');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const effort = page.getByTestId('effort-picker-trigger');
    if (placement === 'composer') {
      await search.press('Tab');
      await page.keyboard.press('Tab');
      await expect(effort).toBeFocused();
      await effort.press('Enter');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
    } else {
      await effort.click();
      await page
        .locator('[data-slot="select-content"]')
        .getByRole('option', { name: 'Max', exact: true })
        .click();
    }
    await expect(page.getByTestId('selection')).toHaveText(
      JSON.stringify({ model: 'model-2', effort: 'max', changes: 1 }),
    );
    await expect(effort).toBeFocused();
    await testInfo.attach(`model-and-effort-${placement}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await effort.press('Enter');
    await page.keyboard.press('Escape');
    await expect(effort).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    if (placement === 'modal') await expect(page.getByRole('dialog')).toBeVisible();
    await trigger.click();
    await search.click();
    if (placement === 'modal') await page.getByRole('heading', { name: 'Model settings' }).click();
    else await page.mouse.click(700, 400);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    if (placement === 'modal') await expect(page.getByRole('dialog')).toBeVisible();
  });
}
