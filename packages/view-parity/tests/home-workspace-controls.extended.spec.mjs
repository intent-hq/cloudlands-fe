import { test, expect } from '@playwright/test';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function openDemo(page, width = 1400) {
  if (!process.env.REACT_BASE_URL) throw new Error('Set REACT_BASE_URL');
  const errors = await observeErrors(page);
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(
    `${process.env.REACT_BASE_URL}/sandbox/popovers?example=interactive&theme=light&motion=reduced`,
  );
  const demo = page.getByTestId('home-workspace-controls-demo');
  await expect(demo.getByRole('searchbox')).toBeVisible();
  await demo.scrollIntoViewIfNeeded();
  const read = (name) => async () =>
    JSON.parse(await demo.getByRole('status', { name }).textContent());
  return {
    errors,
    demo,
    state: read('Home toolbar state'),
    events: read('Home toolbar callbacks'),
    options: demo.getByRole('button', { name: 'View options', exact: true }),
  };
}

async function capture(page, locator, info, name) {
  await locator.scrollIntoViewIfNeeded();
  await info.attach(`${name}-geometry.json`, {
    body: JSON.stringify(
      await locator.evaluate((root) => ({
        bounds: root.getBoundingClientRect().toJSON(),
        controls: [...root.querySelectorAll('button,input')].map((node) => ({
          name: node.getAttribute('aria-label') ?? node.textContent,
          bounds: node.getBoundingClientRect().toJSON(),
        })),
      })),
    ),
    contentType: 'application/json',
  });
  await stableLocatorScreenshot(page, locator, async ({ png, attempt }) => {
    if (png) await info.attach(`${name}-${attempt}`, { body: png, contentType: 'image/png' });
  });
}

test('Home toolbar preserves controlled refusal, repeated status commands and search across view changes', async ({
  page,
}, info) => {
  const { errors, demo, state, events } = await openDemo(page);
  const running = demo.getByRole('button', { name: 'Running 2', exact: true });
  await running.click();
  await expect(running).toHaveAttribute('aria-pressed', 'true');
  await demo.getByRole('button', { name: 'Replace callbacks' }).click();
  await running.click();
  const search = demo.getByRole('searchbox');
  await search.fill('draft');
  await demo.getByRole('button', { name: 'Hold changes' }).click();
  const board = demo.getByRole('button', { name: 'Board view', exact: true });
  await board.focus();
  await page.keyboard.press('Enter');
  await expect(board).toHaveAttribute('aria-pressed', 'false');
  await expect(search).toHaveValue('draft');
  await demo.getByRole('button', { name: 'Hold changes' }).click();
  await board.focus();
  await page.keyboard.press('Space');
  await expect(board).toHaveAttribute('aria-pressed', 'true');
  await expect(search).toHaveValue('draft');
  expect(await events()).toEqual([
    { changes: { filter: 'running' }, revision: 'original' },
    { changes: { filter: 'running' }, revision: 'updated' },
    { changes: { query: 'draft' }, revision: 'updated' },
    { changes: { view: 'board' }, revision: 'updated' },
    { changes: { view: 'board' }, revision: 'updated' },
  ]);
  expect(await state()).toMatchObject({ filter: 'running', query: 'draft', view: 'board' });
  await capture(page, demo.getByTestId('home-workspace-controls-frame'), info, 'home-toolbar-wide');
  expect(errors).toEqual([]);
});

test('Home toolbar switches responsive controls while retaining selection and immediate native typeahead', async ({
  page,
}, info) => {
  const { errors, demo, events } = await openDemo(page, 600);
  const filter = demo.getByRole('combobox', { name: 'Status', exact: true });
  await filter.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  await expect(filter).toHaveText('Running');
  await expect(filter).toBeFocused();
  await capture(
    page,
    demo.getByTestId('home-workspace-controls-frame'),
    info,
    'home-toolbar-compact',
  );
  await page.setViewportSize({ width: 1400, height: 1000 });
  await expect(filter).toBeHidden();
  await expect(demo.getByRole('button', { name: 'Running 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await demo.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.setViewportSize({ width: 600, height: 1000 });
  await expect(filter).toHaveText('Archived');
  expect(await events()).toEqual([
    { changes: { filter: 'running' }, revision: 'original' },
    { changes: { filter: 'archived' }, revision: 'original' },
  ]);
  expect(errors).toEqual([]);
});

test('Home settings nested keyboard selections publish exact partial changes and unwind one layer at a time', async ({
  page,
}, info) => {
  const { errors, demo, state, events, options } = await openDemo(page, 600);
  await options.click();
  const dialog = page.getByRole('dialog');
  const grouping = dialog.getByRole('combobox', { name: 'Group by', exact: true });
  await grouping.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('r');
  await page.keyboard.press('Enter');
  await expect(grouping).toContainText('Repository');
  await expect(grouping).toBeFocused();
  expect(await state()).toMatchObject({ groupBy: 'repository', selectedId: 'selected-workspace' });
  const date = dialog.getByRole('combobox', { name: 'Updated', exact: true });
  await date.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(date).toContainText('Last month');
  expect(await state()).toMatchObject({ updatedWithin: 'month', selectedId: null });
  expect(await events()).toEqual([
    { changes: { groupBy: 'repository' }, revision: 'original' },
    { changes: { updatedWithin: 'month', selectedId: null }, revision: 'original' },
  ]);
  await capture(page, dialog, info, 'home-toolbar-settings');
  await grouping.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(grouping).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(options).toBeFocused();
  await options.click();
  const outside = demo.getByRole('button', { name: 'After toolbar' });
  await outside.click();
  await expect(dialog).toHaveCount(0);
  await expect(outside).toBeFocused();
  expect(errors).toEqual([]);
});

test('Home settings retain controlled values and retire both open layers with their owner', async ({
  page,
}) => {
  const { errors, demo, events, options } = await openDemo(page, 600);
  await demo.getByRole('button', { name: 'Hold changes' }).click();
  await options.click();
  const grouping = page.getByRole('dialog').getByRole('combobox', { name: 'Group by' });
  await grouping.click();
  await page.getByRole('option', { name: 'Repository', exact: true }).click();
  await expect(grouping).toContainText('Status');
  await page.keyboard.press('Escape');
  await demo.getByRole('button', { name: 'Hold changes' }).click();
  await demo.getByRole('button', { name: 'Replace callbacks' }).click();
  await demo.getByRole('button', { name: 'Retire on change' }).click();
  await options.click();
  const oldDialog = await page.getByRole('dialog').elementHandle();
  await grouping.click();
  const oldList = await page.getByRole('listbox').elementHandle();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(options).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  expect(await oldDialog.evaluate((node) => node.isConnected)).toBe(false);
  expect(await oldList.evaluate((node) => node.isConnected)).toBe(false);
  expect(await events()).toEqual([
    { changes: { groupBy: 'repository' }, revision: 'original' },
    { changes: { groupBy: 'none' }, revision: 'updated' },
  ]);
  await demo.getByRole('button', { name: 'Show toolbar' }).click();
  await options.click();
  await expect(grouping).toContainText('None');
  expect(errors).toEqual([]);
});
