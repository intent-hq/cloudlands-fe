import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../../test/ct-test';
import Harness from './home-multi-select-harness.svelte';

type HookArgs = Parameters<Parameters<typeof test.beforeEach>[1]>;
type Page = HookArgs[0]['page'];
const artifacts = resolve(process.cwd(), '.demo-artifacts/home-multi-select');
const rerun =
  'corepack pnpm run test:ct -- src/features/home/home-multi-select.ct.spec.ts --workers=1';

const item = (page: Page, id: string) => page.locator(`[data-home-workspace="${id}"]`);
const option = (page: Page, id: string) => page.getByRole('option').filter({ has: item(page, id) });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected workspaces' });
const snapshot = (page: Page) => page.evaluate(() => window.__homeMultiSelect!.snapshot());
const toggle = (page: Page, id: string) => item(page, id).click({ modifiers: ['ControlOrMeta'] });
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterEach(async ({ page }, testInfo) => {
  const state = await page.evaluate(() => window.__homeMultiSelect?.snapshot());
  await mkdir(artifacts, { recursive: true });
  const name = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const path = resolve(artifacts, `${name}.json`);
  await writeFile(
    path,
    JSON.stringify(
      { test: testInfo.title, status: testInfo.status, rerun, state, pageErrors: errors.get(page) },
      null,
      2,
    ),
  );
  await testInfo.attach('home-multi-select-evidence', { path, contentType: 'application/json' });
  expect(errors.get(page)).toEqual([]);
});

test('Cmd/Ctrl-click builds a list selection and archives it in one step', async ({
  mount,
  page,
}) => {
  await mount(Harness, { props: { height: 800 } });
  await item(page, 'multi-a').click();
  await expect.poll(async () => (await snapshot(page)).selectedId).toBe('multi-a');
  await expect(bar(page)).toHaveCount(0);

  await toggle(page, 'multi-b');
  await toggle(page, 'multi-c');
  await expect(bar(page)).toContainText('3 selected');
  for (const id of ['multi-a', 'multi-b', 'multi-c'])
    await expect(option(page, id)).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, 'multi-d')).toHaveAttribute('aria-selected', 'false');
  // Several rows replace the single preview, and Cmd/Ctrl-click no longer opens a tab.
  expect((await snapshot(page)).selectedId).toBeNull();

  await toggle(page, 'multi-b');
  await expect(bar(page)).toContainText('2 selected');
  await expect(option(page, 'multi-b')).toHaveAttribute('aria-selected', 'false');
  await expect(bar(page).getByRole('button', { name: 'Purge folders' })).toHaveCount(0);

  await bar(page).getByRole('button', { name: 'Archive' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Archive 2 workspaces?');
  await expect(dialog).toContainText('Draft the release notes');
  await expect(dialog).toContainText('Tune search ranking');
  await dialog.getByRole('button', { name: 'Archive all' }).click();

  await expect
    .poll(async () => (await snapshot(page)).calls)
    .toEqual([
      { method: 'workspace.archive', workspaceId: 'multi-a' },
      { method: 'workspace.archive', workspaceId: 'multi-c' },
    ]);
  await expect(item(page, 'multi-a')).toHaveCount(0);
  await expect(item(page, 'multi-b')).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test('Archived workspaces can be purged and deleted together from the context menu', async ({
  mount,
  page,
}) => {
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await mount(Harness, { props: { height: 800 } });
  const filters = page.getByRole('group', { name: 'Status', exact: true });
  await filters.getByRole('button', { name: 'Archived', exact: false }).first().click();
  await toggle(page, 'multi-archived');
  await toggle(page, 'multi-purged');
  await expect(bar(page)).toContainText('2 selected');
  await expect(bar(page).getByRole('button', { name: 'Archive' })).toHaveCount(0);

  await item(page, 'multi-purged').click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Purge folders' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Purge folders' }).click();

  const dialog = page.getByRole('dialog');
  // The purged workspace has no folder left, so only the archived one is listed.
  await expect(dialog).toContainText('Purge the folder of 1 workspace?');
  await expect(dialog).toContainText('Old billing spike');
  await expect(dialog).not.toContainText('Retired prototype');
  await dialog.getByRole('button', { name: 'Purge folders' }).click();
  await expect
    .poll(async () => (await snapshot(page)).calls)
    .toEqual([{ method: 'workspace.retire', workspaceId: 'multi-archived' }]);
  await expect.poll(async () => (await snapshot(page)).statuses['multi-archived']).toBe('Retired');
  await expect(dialog).toHaveCount(0);

  await expect(bar(page)).toContainText('2 selected');
  await bar(page).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toContainText('Delete 2 workspaces?');
  await dialog.getByRole('button', { name: 'Delete all' }).click();
  await expect
    .poll(async () =>
      (await snapshot(page)).calls.filter((call) => call.method === 'workspace.delete'),
    )
    .toEqual([
      { method: 'workspace.delete', workspaceId: 'multi-archived' },
      { method: 'workspace.delete', workspaceId: 'multi-purged' },
    ]);
  await expect(item(page, 'multi-archived')).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
});

test('Board cards multi-select; plain click, Escape and right-click elsewhere reset it', async ({
  mount,
  page,
}) => {
  await mount(Harness, { props: { view: 'board', height: 800 } });
  await toggle(page, 'multi-a');
  await expect.poll(async () => (await snapshot(page)).selectedId).toBe('multi-a');
  await toggle(page, 'multi-d');
  await expect(bar(page)).toContainText('2 selected');
  await expect(item(page, 'multi-a')).toHaveAttribute('aria-pressed', 'true');
  await expect(item(page, 'multi-d')).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
  await expect(item(page, 'multi-a')).toHaveAttribute('aria-pressed', 'false');

  await toggle(page, 'multi-a');
  await toggle(page, 'multi-b');
  await expect(bar(page)).toContainText('2 selected');
  await item(page, 'multi-c').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Open workspace' })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await page.keyboard.press('Escape');

  await toggle(page, 'multi-a');
  await toggle(page, 'multi-b');
  await item(page, 'multi-d').click();
  await expect(bar(page)).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).selectedId).toBe('multi-d');

  await toggle(page, 'multi-b');
  await expect(bar(page)).toContainText('2 selected');
  await bar(page).getByRole('button', { name: 'Clear selection' }).click();
  await expect(bar(page)).toHaveCount(0);
  expect((await snapshot(page)).calls).toEqual([]);
});

const rangeTo = (page: Page, id: string) => item(page, id).click({ modifiers: ['Shift'] });
const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '');

test('Shift-click selects a list range from the last clicked row', async ({ mount, page }) => {
  await mount(Harness, { props: { height: 800 } });
  await item(page, 'multi-a').click();
  await rangeTo(page, 'multi-c');
  for (const id of ['multi-a', 'multi-b', 'multi-c'])
    await expect(option(page, id)).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, 'multi-d')).toHaveAttribute('aria-selected', 'false');
  await expect(bar(page)).toContainText('3 selected');
  expect(await selectedText(page)).toBe('');

  // The anchor stays on the first row, so a second Shift-click re-ranges from it.
  await rangeTo(page, 'multi-b');
  await expect(option(page, 'multi-c')).toHaveAttribute('aria-selected', 'false');
  await expect(bar(page)).toContainText('2 selected');

  // Cmd/Ctrl-click moves the anchor; the next range starts there.
  await toggle(page, 'multi-d');
  await rangeTo(page, 'multi-c');
  await expect(bar(page)).toContainText('2 selected');
  for (const id of ['multi-c', 'multi-d'])
    await expect(option(page, id)).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, 'multi-a')).toHaveAttribute('aria-selected', 'false');

  // With nothing selected, a Shift-click starts fresh instead of ranging from a stale anchor.
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
  await rangeTo(page, 'multi-b');
  await expect(bar(page)).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).selectedId).toBe('multi-b');
  await expect(option(page, 'multi-c')).toHaveAttribute('aria-selected', 'false');
  expect((await snapshot(page)).calls).toEqual([]);
});

test('Shift-click selects a board range in card order', async ({ mount, page }) => {
  await mount(Harness, { props: { view: 'board', height: 800 } });
  await item(page, 'multi-d').click();
  await rangeTo(page, 'multi-a');
  for (const id of ['multi-a', 'multi-b', 'multi-c', 'multi-d'])
    await expect(item(page, id)).toHaveAttribute('aria-pressed', 'true');
  await expect(bar(page)).toContainText('4 selected');
  expect(await selectedText(page)).toBe('');
});
