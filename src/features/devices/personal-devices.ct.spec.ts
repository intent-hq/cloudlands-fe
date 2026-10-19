import { test, expect } from '../../test/ct-test';
import Preview from './personal-devices.preview.svelte';

test('personal pairing stays usable at narrow width and Escape returns focus to the pairing control', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await mount(Preview, {
    hooksConfig: { previewScene: { scene: 'personal-devices', state: 'member' } },
  });
  const trigger = page.getByRole('button', { name: 'Show QR Code' });
  await expect(trigger).toBeEnabled();
  await page.screenshot({ path: '.demo-artifacts/mobile-pairing-controls.png' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('img')).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  await page.screenshot({ path: '.demo-artifacts/personal-devices-pairing.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('button', { name: 'Copy pairing link' })).toBeEnabled();
});
