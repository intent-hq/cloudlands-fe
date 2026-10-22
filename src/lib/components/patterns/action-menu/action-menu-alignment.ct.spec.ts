import { expect, test } from '../../../../test/ct-test';
import Harness from './ActionMenuAlignmentHarness.svelte';
import { expectDestructiveMenuInk } from '../../../../test/menu-geometry';

test('icons, shortcuts, checks and submenu arrows align with the first label line above descriptions', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 420, height: 850 });
  await mount(Harness, { props: { multiline: true } });
  const trigger = page.getByRole('button', { name: 'Actions', exact: true });
  await trigger.click();
  const root = page.getByRole('menu', { name: 'Workspace menu', exact: true });
  await expect(root).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const name of ['Locked', 'Show details', 'Compact', 'More']) {
    const row = root
      .locator('[data-menu-item]')
      .filter({ has: page.getByText(name, { exact: true }) });
    await row.scrollIntoViewIfNeeded();
    await expect(row).toHaveAttribute('aria-disabled', 'true');
  }
  await expectDestructiveMenuInk(root.getByRole('menuitem', { name: 'Delete', exact: true }));
  await testInfo.attach('action-menu-first-line', {
    body: await root.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('changing icons preserves submenu keyboard navigation', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Harness, { props: { iconSource: 'root' } });
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  const root = page.getByRole('menu', { name: 'Workspace menu', exact: true });
  await component.update({ props: { iconSource: 'submenu' } });
  await root.getByRole('menuitem', { name: 'More', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  const child = page.getByRole('menuitem', { name: 'Export', exact: true });
  await expect(child).toBeFocused();
});

for (const iconSource of ['root', 'section', 'radio', 'submenu', 'hidden'] as const) {
  test(`menu with ${iconSource} icons supports selection and submenus`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 600, height: 720 });
    await mount(Harness, { props: { iconSource } });
    const trigger = page.getByRole('button', { name: 'Actions', exact: true });
    await trigger.click();
    const root = page.getByRole('menu', { name: 'Workspace menu', exact: true });
    const rename = root.getByRole('menuitem', { name: 'Rename', exact: true });
    await expect(rename).toBeVisible();
    const checkbox = root.getByRole('menuitemcheckbox', { name: 'Show details' });
    await checkbox.click();
    await expect(checkbox).toHaveAttribute('aria-checked', 'true');
    const compact = root.getByRole('menuitemradio', { name: 'Compact', exact: true });
    await compact.click();
    await expect(compact).toHaveAttribute('aria-checked', 'true');
    const more = root.getByRole('menuitem', { name: 'More', exact: true });
    await more.focus();
    await page.keyboard.press('ArrowRight');
    const child = page
      .getByRole('menu')
      .filter({ has: page.getByRole('menuitem', { name: 'Export', exact: true }) });
    const exportRow = child.getByRole('menuitem', { name: 'Export', exact: true });
    await expect(exportRow).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('selection')).toHaveText('export');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
