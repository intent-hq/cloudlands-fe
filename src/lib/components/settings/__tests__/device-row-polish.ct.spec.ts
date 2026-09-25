import { expect, test } from '../../../../test/ct-test';
import Preview from '../devices-settings.preview.svelte';

test('exposes version warnings and supports keyboard device actions', async ({ mount, page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Preview, {
    hooksConfig: { geometrySnapshot: { scene: 'devices-settings', state: 'versions' } },
  });
  const row = page.getByRole('article', { name: 'Studio Mac', exact: true });
  await expect(row).toBeVisible();
  const version = row.getByRole('button', { name: '6.7.0', exact: true });
  await version.focus();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('0.9.0');
  await expect(tooltip).toContainText('0.9.1');
  await expect(version).toHaveAttribute('aria-describedby', (await tooltip.getAttribute('id'))!);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  const actions = row.getByRole('button', { name: 'Actions for Studio Mac' });
  await actions.focus();
  await version.hover();
  await expect(tooltip).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
  await actions.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Update', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
  await expect(page.getByText('6.6.0', { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole('article', { name: 'Unknown version', exact: true })
      .getByRole('button', { name: /[0-9]+\.[0-9]+/ }),
  ).toHaveCount(0);
});
