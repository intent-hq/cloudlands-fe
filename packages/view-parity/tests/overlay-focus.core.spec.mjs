import {
  test,
  expect,
  openMenu,
  expectSynchronousReclaim,
  expectOutsideReleased,
} from '../lib/overlay-focus.mjs';

// Oracle: original Bits ContentStatic -> FocusScope capture/manager, and the
// unchanged Svelte menu-content/menu-roving-focus wrappers at reference 003bc52.
test('overlay focus: public programmatic focus is synchronously reclaimed without hiding surrounding controls; outside pointer closes', async ({
  page,
}) => {
  const { example, menu, outside } = await openMenu(page);
  const field = menu.getByRole('textbox', { name: 'Parent menu field' });
  await field.click();
  await page.keyboard.type('parent input');
  await expect(field).toHaveValue('parent input');
  await expectSynchronousReclaim(outside, field);

  // Role lookup excludes aria-hidden/inert content. A visible DOM node alone
  // would miss the modal branch incorrectly removing surrounding accessibility.
  await expect(example.getByRole('button', { name: 'Outside action', exact: true })).toBeVisible();
  await expect(outside).toBeVisible();
  await example.getByRole('button', { name: 'Outside action', exact: true }).click();
  await expect(example.getByLabel('Static menu open', { exact: true })).toHaveText('false');
  await expect(menu).toHaveCount(0);
  await expect(example.getByLabel('Outside action count', { exact: true })).toHaveText('1');
  await expectOutsideReleased(example, outside);
});

test('overlay focus: submenu keyboard ownership returns with ArrowLeft and resumes programmatic focus capture', async ({
  page,
}) => {
  const { example, menu, outside } = await openMenu(page);
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'First command', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const trigger = menu.getByRole('menuitem', { name: 'More focus actions', exact: true });
  await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const submenu = page.getByRole('menu', { name: 'Nested focus menu', exact: true });
  await expect(
    submenu.getByRole('menuitem', { name: 'Submenu command', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    submenu.getByRole('menuitem', { name: 'Second submenu command', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(example.getByLabel('Menu commands', { exact: true })).toHaveText(
    '["second-submenu"]',
  );
  await page.keyboard.press('ArrowLeft');
  await expect(submenu).toHaveCount(0);
  await expectSynchronousReclaim(outside, trigger);
  await expect(example.getByLabel('Static menu open', { exact: true })).toHaveText('true');
});

test('overlay focus: dialog takes native keyboard input and dismissal restores parent programmatic focus capture', async ({
  page,
}) => {
  const { example, menu, outside } = await openMenu(page);
  const trigger = menu.getByRole('menuitem', { name: 'Open nested dialog', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Nested focus dialog', exact: true });
  const field = dialog.getByRole('textbox', { name: 'Nested dialog field' });
  await expect(field).toBeFocused();
  await page.keyboard.type('dialog input');
  await expect(field).toHaveValue('dialog input');
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Nested dialog action', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog.getByLabel('Nested dialog actions', { exact: true })).toHaveText('1');
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Dismiss nested dialog', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expectSynchronousReclaim(outside, trigger);
  await expect(example.getByLabel('Static menu open', { exact: true })).toHaveText('true');
});

test('overlay focus: popover takes native keyboard input and dismissal restores parent programmatic focus capture', async ({
  page,
}) => {
  const { example, menu, outside } = await openMenu(page);
  const trigger = menu.getByRole('menuitem', { name: 'Open nested popover', exact: true });
  await trigger.click();
  const popover = page.getByRole('dialog', { name: 'Nested focus popover', exact: true });
  const field = popover.getByRole('textbox', { name: 'Nested popover field' });
  await expect(field).toBeFocused();
  await page.keyboard.type('popover input');
  await expect(field).toHaveValue('popover input');
  await page.keyboard.press('Tab');
  await expect(
    popover.getByRole('button', { name: 'Close nested popover', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(popover).toHaveCount(0);
  await expectSynchronousReclaim(outside, trigger);
  await expect(example.getByLabel('Static menu open', { exact: true })).toHaveText('true');
});

test('overlay focus: nested select accepts native keyboard selection and returns parent programmatic focus capture', async ({
  page,
}) => {
  const { example, menu, outside } = await openMenu(page);
  const trigger = menu.getByRole('combobox', { name: 'Nested select', exact: true });
  await trigger.click();
  const options = page.getByRole('listbox', { name: 'Nested select options', exact: true });
  await expect(options).toBeVisible();
  // Bits holds focus on its trigger and uses active-descendant navigation;
  // Radix moves DOM focus. Selection is the independent shared contract.
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(options).toHaveCount(0);
  await expect(example.getByLabel('Nested select value', { exact: true })).toHaveText('beta');
  await expectSynchronousReclaim(outside, trigger);
  await expect(example.getByLabel('Static menu open', { exact: true })).toHaveText('true');
});
