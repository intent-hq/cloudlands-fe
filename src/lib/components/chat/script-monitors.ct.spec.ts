import Preview from './script-monitors.preview.svelte';
import { test, expect } from '../../../test/ct-test';
test('monitor details and menu stay keyboard accessible at narrow width', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Preview);
  const row = component.getByTestId('script-monitor-row').first();
  const disclosure = row.getByRole('button', { name: 'Frontend checks' }).first();
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(row.getByText(/Monitoring ends at/)).toBeVisible();
  const trigger = row.getByRole('button', { name: /Actions for/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: /panel/i })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /bottom/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  const bounds = await row.boundingBox();
  const control = await trigger.boundingBox();
  expect(control!.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(control!.x + control!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
});
