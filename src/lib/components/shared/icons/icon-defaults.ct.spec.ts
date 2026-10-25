import { expect, test } from '../../../../test/ct-test';
import Preview from './icon-defaults.preview.svelte';
import { expectDestructiveMenuInk } from '../../../../test/menu-geometry';

test('workspace list actions support keyboard activation and focus restoration', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        versions: { electron: 'icon-preview-only' },
        invoke: async () => {
          throw new Error('Native actions are disabled in icon preview');
        },
      },
    });
  });
  await mount(Preview, { props: { layout: 'list' } });
  const trigger = page.getByRole('button', { name: 'Workspace actions', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.locator('[data-slot="menu-content"]');
  await expect(menu.getByRole('button', { name: 'Open in Finder' })).toBeVisible();
  await menu.getByRole('button', { name: 'Transfer to host' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('icon-defaults-preview')).toHaveAttribute(
    'data-last-action',
    'transfer',
  );
  await expect(menu).toBeHidden();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('workspace menu keeps a viewport gutter and left-aligned copy with keyboard selection', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Preview);
  const trigger = page.getByRole('button', { name: 'Workspace actions', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  const transfer = menu.getByRole('menuitem', { name: 'Transfer to host' });
  await expect(transfer).toBeVisible();
  await expect
    .poll(async () => {
      const box = (await menu.boundingBox())!;
      return Math.min(box.x, box.y, 360 - box.x - box.width, 600 - box.y - box.height);
    })
    .toBeGreaterThanOrEqual(0);
  await expect(transfer.locator('kbd')).toHaveCount(1);
  await expectDestructiveMenuInk(menu.getByRole('menuitem', { name: /^Delete Workspace/ }));
  await page.screenshot({ path: testInfo.outputPath('workspace-menu-inset.png') });
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('t');
  await expect(transfer).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('icon-defaults-preview')).toHaveAttribute(
    'data-last-action',
    'transfer',
  );
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});
