import {
  test,
  expect,
  openMenu,
  expectSynchronousReclaim,
  expectOutsideReleased,
} from '../lib/overlay-focus.mjs';

test('overlay focus: explicit root and submenu names survive native keyboard navigation', async ({
  page,
}) => {
  const { example, menu } = await openMenu(page);
  // Bits merges caller naming into ContentStatic/SubContent without supplying
  // aria-labelledby from their triggers. Check the resulting accessible names.
  await expect(menu).toHaveAccessibleName('Static focus menu');
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'First command', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const trigger = menu.getByRole('menuitem', { name: 'More focus actions', exact: true });
  await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const submenu = page.getByRole('menu').and(page.getByTestId('nested-focus-menu'));
  await expect(submenu).toHaveAccessibleName('Nested focus menu');
  await expect(
    submenu.getByRole('menuitem', { name: 'Submenu command', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(example.getByLabel('Menu commands', { exact: true })).toHaveText('["submenu"]');
  await page.keyboard.press('ArrowLeft');
  await expect(submenu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('overlay focus: submenu Escape closes only its own layer and restores parent programmatic focus capture', async ({
  page,
}) => {
  const { example, menu, outside } = await openMenu(page);
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'First command', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const trigger = menu.getByRole('menuitem', { name: 'More focus actions', exact: true });
  await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const submenu = page.getByRole('menu').and(page.getByTestId('nested-focus-menu'));
  await expect(
    submenu.getByRole('menuitem', { name: 'Submenu command', exact: true }),
  ).toBeFocused();
  // menu-sub.svelte registers its own window-capture Escape layer, above the
  // root's layer, and explicitly returns focus to its parent sub-trigger.
  await page.keyboard.press('Escape');
  await expect(submenu).toHaveCount(0);
  await expect(example.getByLabel('Static menu open', { exact: true })).toHaveText('true');
  await expectSynchronousReclaim(outside, trigger);
});

test('overlay focus: Escape in a nested popover follows the source root menu capture layer', async ({
  page,
}) => {
  const { example, menu, outside } = await openMenu(page);
  await menu.getByRole('menuitem', { name: 'Open nested popover', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Nested popover field' });
  await expect(field).toBeFocused();
  await page.keyboard.type('nested input');
  await expect(field).toHaveValue('nested input');
  // Unlike menu-sub.svelte, popover-root.svelte registers no canonical Escape
  // layer. menu.svelte's window capture consumes Escape before Bits' document
  // listeners; it closes the root, unmounting its child popover too.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(field).toHaveCount(0);
  await expect(example.getByLabel('Static menu open', { exact: true })).toHaveText('false');
  await expect(
    example.getByRole('button', { name: 'Toggle static menu', exact: true }),
  ).toBeFocused();
  await expectOutsideReleased(example, outside);
});

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
