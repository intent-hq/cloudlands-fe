import { test, expect } from '@playwright/test';
import { observeErrors } from '../lib/browser.mjs';

async function open(page) {
  const errors = await observeErrors(page);
  await page.goto(
    `${process.env.REACT_BASE_URL ?? 'http://127.0.0.1:5174'}/sandbox/command-palette?example=interactive&theme=light&motion=reduced&fit=component`,
  );
  const host = page.getByTestId('command-palette-demo');
  await expect(host).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  return { host, errors };
}

test('integrated palette preserves controlled selection and current workspace options', async ({
  page,
}) => {
  const { host, errors } = await open(page);
  const selection = host.getByRole('status');
  await host.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(selection).toHaveText('file');
  await expect(host.getByRole('button', { name: 'Files', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await host.getByRole('switch', { name: 'Collaborator', exact: true }).click();
  await expect(host.getByRole('button', { name: 'Terminals', exact: true })).toHaveCount(0);
  await host.getByRole('switch', { name: 'Workspace options' }).click();
  await expect(host.getByRole('button', { name: 'Files', exact: true })).toHaveCount(0);
  await host.getByRole('textbox', { name: 'Result title' }).focus();
  await page.keyboard.press('Tab');
  await expect(selection).toHaveText('all');
  await page.keyboard.press('Shift+Tab');
  await expect(selection).toHaveText('message');
  expect(errors).toEqual([]);
});

test('integrated title replaces caller content and conditionally shows archive context', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 800, height: 650 });
  const { host, errors } = await open(page);
  const title = host.locator('[title]').filter({ hasText: 'React migration' });
  await expect(title).toHaveAttribute(
    'title',
    'React migration — Intent · cloudlands-fe · Plan / Integration',
  );
  await host.getByRole('textbox', { name: 'Result title' }).fill('Workspace journey');
  await host.getByRole('switch', { name: 'Archived workspace', exact: true }).click();
  const frame = host.getByTestId('command-palette-frame');
  await expect(frame.getByText('Archived workspace', { exact: true })).toBeVisible();
  await expect(frame.locator('[title]').first()).toHaveAttribute(
    'title',
    'Workspace journey — Intent · cloudlands-fe · Plan / Integration',
  );
  await host.getByRole('switch', { name: 'Archived workspace', exact: true }).click();
  await expect(frame.getByText('Archived workspace', { exact: true })).toHaveCount(0);
  await host.screenshot({ path: info.outputPath('integrated-palette.png') });
  await info.attach('integrated-palette', {
    path: info.outputPath('integrated-palette.png'),
    contentType: 'image/png',
  });
  expect(errors).toEqual([]);
});

test('narrow keyboard cycling reveals the selected offscreen filter and retains input focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const { host, errors } = await open(page);
  const input = host.getByRole('textbox', { name: 'Result title' });
  await input.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(host.getByRole('status')).toHaveText('browser');
  await expect(input).toBeFocused();
  const browser = host.getByRole('button', { name: 'Browser', exact: true });
  await expect(browser).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(input).not.toBeFocused();
  await expect(host.getByRole('switch', { name: 'Workspace options' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(host.getByRole('switch', { name: 'Collaborator', exact: true })).toBeFocused();
  await browser.click();
  await expect(browser).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
