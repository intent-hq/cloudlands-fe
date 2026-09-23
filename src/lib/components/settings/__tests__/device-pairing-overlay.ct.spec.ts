import { expect, test } from '../../../../test/ct-test';
import Preview from '../devices-settings.preview.svelte';

test('QR dialog covers device dividers and returns focus when dismissed', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Preview, {
    props: { expanded: true },
    hooksConfig: { geometrySnapshot: { scene: 'devices-settings', state: 'local-expanded' } },
  });
  const trigger = page.getByRole('button', { name: 'Show QR Code', exact: true });
  const nextDevice = page.getByRole('article', { name: 'Studio Mac', exact: true });
  const divider = await nextDevice.boundingBox();
  expect(divider).not.toBeNull();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('img')).toBeVisible();
  const coverage = await dialog.evaluate((node, dividerY) => {
    const bounds = node.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    return {
      crossesDivider: dividerY > bounds.top && dividerY < bounds.bottom,
      coversDivider: [-0.5, 0, 0.5, 1].every((offset) =>
        node.contains(document.elementFromPoint(x, dividerY + offset)),
      ),
    };
  }, divider!.y);
  expect(coverage.crossesDivider).toBe(true);
  expect(coverage.coversDivider).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  // Exercise focus with both same-name controls present, not the older footer-only dialog.
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(2);
  const footerClose = dialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole('button', { name: 'Close', exact: true });
  await expect(footerClose).toBeFocused();
  // Visibility alone can precede the dialog's deferred outside-pointer listener.
  // Use locator actionability (stable, receiving events) rather than a raw mouse
  // event immediately after remounting. Keep the click outside the dialog.
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 10, y: 10 } });
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
