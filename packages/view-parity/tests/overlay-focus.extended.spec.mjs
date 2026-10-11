import {
  test,
  expect,
  openMenu,
  expectSynchronousReclaim,
  expectOutsideReleased,
} from '../lib/overlay-focus.mjs';

test('overlay focus: Escape closes the root menu, releases public focus capture and permits keyboard reopening', async ({
  page,
}) => {
  const { example, menu, outside } = await openMenu(page);
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'First command', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  const trigger = example.getByRole('button', { name: 'Toggle static menu', exact: true });
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Home');
  await expectSynchronousReclaim(
    outside,
    menu.getByRole('menuitem', { name: 'First command', exact: true }),
  );
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expectOutsideReleased(example, outside);
});

test('overlay focus: no-trigger Tab and ShiftTab move between real parent controls without closing', async ({
  page,
}) => {
  const { example, menu } = await openMenu(page, { trigger: false });
  const field = menu.getByRole('textbox', { name: 'Parent menu field' });
  const select = menu.getByRole('combobox', { name: 'Nested select', exact: true });
  await field.click();
  // Bits handleTabKeyDown returns when no root trigger exists. FocusScope
  // only loops at the boundary; interior Tab must retain native traversal.
  await page.keyboard.press('Tab');
  await expect(select).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(field).toBeFocused();
  await expect(example.getByLabel('Static menu open', { exact: true })).toHaveText('true');
});

test('overlay focus: closed force-mounted content releases public focus capture and can reopen', async ({
  page,
}) => {
  const { example, menu, outside } = await openMenu(page, { forceMount: true });
  await menu.getByRole('menuitem', { name: 'Close with command', exact: true }).click();
  await expect(example.getByLabel('Static menu open', { exact: true })).toHaveText('false');
  // This is the distinct forceMount lifecycle contract: its DOM remains, but
  // closed content must no longer capture document focus.
  await expect(example.getByTestId('static-focus-menu')).toHaveCount(1);
  await expect(example.getByTestId('static-focus-menu')).toHaveAttribute('data-state', 'closed');
  await expectOutsideReleased(example, outside);
  await example.getByRole('button', { name: 'Toggle static menu', exact: true }).click();
  await expect(example.getByLabel('Static menu open', { exact: true })).toHaveText('true');
  const field = menu.getByRole('textbox', { name: 'Parent menu field' });
  await field.click();
  await expectSynchronousReclaim(outside, field);
});

test('overlay focus: unmounting an active menu releases public focus capture and a fresh mount regains ownership', async ({
  page,
}) => {
  const { example, menu, outside } = await openMenu(page);
  await menu.getByRole('menuitem', { name: 'Unmount active menu', exact: true }).click();
  await expect(example.getByLabel('Menu mounted', { exact: true })).toHaveText('false');
  await expect(menu).toHaveCount(0);
  await expectOutsideReleased(example, outside);
  await example.getByRole('button', { name: 'Mount static menu', exact: true }).click();
  await expect(menu).toBeVisible();
  const field = menu.getByRole('textbox', { name: 'Parent menu field' });
  await field.click();
  await expectSynchronousReclaim(outside, field);
  await menu.getByRole('menuitem', { name: 'Unmount active menu', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expectOutsideReleased(example, outside);
});
