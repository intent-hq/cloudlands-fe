import { expect, test } from '../../../../test/ct-test';
import { m } from '$shared/paraglide/messages.js';
import Preview from '../devices-settings.preview.svelte';

test('Mobile QR dialog traps focus and returns it when dismissed', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1040, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Preview, {
    props: { mobilePage: true },
    hooksConfig: { geometrySnapshot: { scene: 'devices-settings', state: 'mobile' } },
  });
  const trigger = page.getByRole('button', { name: m.settings_wsApi_showQrCode(), exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('img')).toBeVisible();
  const footerClose = dialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole('button', { name: m.settings_wsApi_close(), exact: true });
  await expect(footerClose).toBeFocused();
  await page.keyboard.press('Tab');
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(footerClose).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(footerClose).toBeFocused();
  await footerClose.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(footerClose).toBeFocused();
  // Visibility alone can precede the dialog's deferred outside-pointer listener.
  // Use locator actionability and keep the click outside the dialog.
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 10, y: 10 } });
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
