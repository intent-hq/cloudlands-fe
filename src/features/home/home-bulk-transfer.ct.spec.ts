import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../../test/ct-test';
import Harness from './home-bulk-transfer-harness.svelte';

type HookArgs = Parameters<Parameters<typeof test.beforeEach>[1]>;
type Page = HookArgs[0]['page'];
const artifacts = resolve(process.cwd(), '.demo-artifacts/home-bulk-transfer');
const rerun =
  'corepack pnpm run test:ct -- src/features/home/home-bulk-transfer.ct.spec.ts --workers=1';

const item = (page: Page, id: string) => page.locator(`[data-home-workspace="${id}"]`);
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected workspaces' });
const toggle = (page: Page, id: string) => item(page, id).click({ modifiers: ['ControlOrMeta'] });
const relayCalls = (page: Page) => page.evaluate(() => window.__homeBulkTransfer!.calls());
const rows = (page: Page) => page.getByTestId('bulk-transfer-items').getByRole('listitem');
const errors = new WeakMap<Page, string[]>();

async function shot(page: Page, name: string) {
  await mkdir(artifacts, { recursive: true });
  await page.getByRole('dialog').screenshot({ path: resolve(artifacts, `${name}.png`) });
}

async function openForThree(page: Page) {
  await item(page, 'multi-a').click();
  await toggle(page, 'multi-b');
  await toggle(page, 'multi-c');
  await expect(bar(page)).toContainText('3 selected');
  await bar(page).getByRole('button', { name: 'Transfer…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Transfer workspaces' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', (error) => errors.get(page)!.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.afterEach(async ({ page }, testInfo) => {
  const calls = await page.evaluate(() => window.__homeBulkTransfer?.calls());
  await mkdir(artifacts, { recursive: true });
  const name = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const path = resolve(artifacts, `${name}.json`);
  await writeFile(
    path,
    JSON.stringify(
      { test: testInfo.title, status: testInfo.status, rerun, calls, pageErrors: errors.get(page) },
      null,
      2,
    ),
  );
  await testInfo.attach('home-bulk-transfer-evidence', { path, contentType: 'application/json' });
  expect(errors.get(page)).toEqual([]);
});

test('transfers a Home selection with the chosen options and one progress bar', async ({
  mount,
  page,
}) => {
  await mount(Harness, { props: { height: 800 } });
  const dialog = await openForThree(page);

  // Per-workspace plan estimates (1 MiB, 2 MiB, 512 KiB) and their sum.
  await expect(rows(page)).toContainText([/\b1\s?Mi/, /\b2\s?Mi/, /\b512\s?Ki/]);
  await expect(dialog.getByTestId('bulk-transfer-total-size')).toContainText(/3\.5\s?Mi/);
  const start = dialog.getByRole('button', { name: 'Transfer 3 workspaces' });
  await expect(start).toBeDisabled();

  await dialog.getByTestId('bulk-transfer-server-devbox').click();
  await expect(dialog.getByTestId('bulk-transfer-server-local')).toHaveCount(0);
  await expect(start).toBeEnabled();
  const archive = dialog.getByRole('checkbox', { name: 'Archive transferred workspaces here' });
  const restart = dialog.getByRole('checkbox', {
    name: 'Restart in-flight agents on the destination',
  });
  await expect(archive).toBeChecked();
  await expect(restart).not.toBeChecked();
  await restart.click();
  await expect(restart).toBeChecked();
  await shot(page, '1-setup');

  await start.click();
  const running = page.getByRole('dialog', { name: 'Transferring workspaces…' });
  await expect(running.getByTestId('bulk-transfer-current')).toContainText(
    'Draft the release notes',
  );
  // Half of the first 1 MiB archive relayed out of a 3.5 MiB run.
  await expect(running.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '14');
  await expect(running.getByRole('progressbar')).toHaveCount(1);
  await expect(running.getByTestId('bulk-transfer-total-size')).toContainText(/3\.5\s?Mi/);
  await expect(rows(page).first()).toHaveAttribute('data-status', 'running');
  await shot(page, '2-transferring');
  await page.keyboard.press('Escape');
  await expect(running).toBeVisible();

  await page.evaluate(() => window.__homeBulkTransfer!.release());
  const result = page.getByRole('dialog', { name: 'Transfer workspaces' });
  await expect(result.getByTestId('bulk-transfer-result')).toBeVisible();
  await expect
    .poll(() => rows(page).evaluateAll((items) => items.map((item) => item.dataset.status)))
    .toEqual(['done', 'done', 'failed']);
  await expect(rows(page).nth(2)).toContainText('the destination ran out of disk space');
  await shot(page, '3-result');

  const calls = await relayCalls(page);
  expect(
    calls.map((call) => [call.channel, (call.params as { workspaceId?: string }).workspaceId]),
  ).toEqual([
    ['transfer:start', 'multi-a'],
    ['transfer:finalize', undefined],
    ['transfer:start', 'multi-b'],
    ['transfer:finalize', undefined],
    ['transfer:start', 'multi-c'],
  ]);
  expect(calls[0]?.params).toEqual({
    workspaceId: 'multi-a',
    destination: { kind: 'server', connectionId: 'devbox' },
  });
  expect(calls[1]?.params).toEqual({
    archiveSource: true,
    restartAgents: true,
    finalStatusMessage: expect.stringContaining('Transferred to devbox'),
  });

  await result.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Stop cancels the running transfer and skips the rest', async ({ mount, page }) => {
  await mount(Harness, { props: { height: 800 } });
  const dialog = await openForThree(page);
  await dialog.getByTestId('bulk-transfer-server-devbox').click();
  await dialog.getByRole('checkbox', { name: 'Archive transferred workspaces here' }).click();
  await dialog.getByRole('button', { name: 'Transfer 3 workspaces' }).click();
  await expect(rows(page).first()).toHaveAttribute('data-status', 'running');

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('bulk-transfer-result')).toBeVisible();
  await expect
    .poll(() => rows(page).evaluateAll((items) => items.map((item) => item.dataset.status)))
    .toEqual(['skipped', 'skipped', 'skipped']);
  await shot(page, '4-stopped');

  const calls = await relayCalls(page);
  expect(calls.map((call) => call.channel)).toEqual(['transfer:start', 'transfer:cancel']);
});
