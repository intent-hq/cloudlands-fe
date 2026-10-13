import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

test('menu navigation skips disabled rows and preserves submenu commands', async ({ page }) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL to the maintained React preview');
  const errors = await observeErrors(page);
  await page.goto(`${base}/sandbox/menu?motion=reduced`);
  await page.getByRole('button', { name: 'Open catalog menu', exact: true }).first().click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Show panel' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  const archive = page.getByRole('menuitem', { name: 'Archive', exact: true });
  await expect(archive).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('static menu navigation respects nested menus and editable controls', async ({ page }) => {
  const base = process.env.REACT_BASE_URL;
  if (!base) throw new Error('Set REACT_BASE_URL to the maintained React preview');
  const errors = await observeErrors(page);
  await page.goto(`${base}/sandbox/menu?example=interactive&motion=reduced`);
  await page.getByTestId('mount-static-menu').click();
  const menu = page.getByTestId('static-focus-menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  const nested = page.getByTestId('nested-focus-menu');
  await expect(
    nested.getByRole('menuitem', { name: 'Submenu command', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('menu-focus-commands')).toHaveText('["second-submenu"]');
  await page.keyboard.press('Escape');
  await expect(nested).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'More focus actions' })).toBeFocused();
  const input = menu.getByRole('textbox', { name: 'Parent menu field', exact: true });
  await input.fill('draft');
  await page.keyboard.press('Home');
  await page.keyboard.type('kept ');
  await expect(input).toHaveValue('kept draft');
  await expect(input).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect(input).toHaveValue('kept draft!');
  expect(errors).toEqual([]);
});
