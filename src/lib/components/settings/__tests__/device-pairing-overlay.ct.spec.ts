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
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
