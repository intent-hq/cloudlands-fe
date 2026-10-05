import { expect, test } from '../../../../test/ct-test';
import DropdownSubmenuHarness from './DropdownSubmenuHarness.svelte';

// Regression for intent-hq/intent#5601: a real pointer click (mousedown then
// click) on a leaf inside the portaled submenu must select it once and close
// the dropdown, instead of the mousedown dismissing the menu first.
test('a real pointer click on a portaled submenu leaf selects it once', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await mount(DropdownSubmenuHarness);

  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();

  const trigger = page.getByRole('option', { name: 'More' });
  await trigger.hover();
  const submenu = page.getByRole('menu');
  await expect(submenu).toBeVisible();
  const submenuId = await submenu.getAttribute('id');
  expect.soft(submenuId).toBeTruthy();
  await expect.soft(trigger).toHaveAttribute('aria-controls', submenuId ?? '');

  await page.getByRole('menuitem', { name: 'Child action' }).click();

  await expect(page.getByTestId('submenu-result')).toHaveText(
    JSON.stringify({ invocations: 1, openChanges: [true, false] }),
  );
  await expect(listbox).toBeHidden();
  await expect(submenu).toBeHidden();
});
