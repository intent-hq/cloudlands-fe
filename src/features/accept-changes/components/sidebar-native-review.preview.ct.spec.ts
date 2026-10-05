import { test, expect } from '../../../test/ct-test';
import Preview from './sidebar-native-review.preview.svelte';

test.describe.configure({ retries: 0 });
type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
async function fill(page: Page, branch = 'release/literal ') {
  await page.getByTestId('pr-create-button').click();
  await page.getByRole('textbox', { name: 'Target branch', exact: true }).fill(branch);
  await page
    .getByRole('textbox', { name: 'Commit Message', exact: true })
    .fill('Original staged commit');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Original review title');
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Original review body');
}
async function first(page: Page) {
  await page
    .getByRole('region', { name: 'Create a merge request' })
    .getByRole('button', { name: 'Commit', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Commit', exact: true })
    .getByRole('button', { name: 'Commit', exact: true })
    .click();
  await expect(page.getByText('Completed commit: staged-parent-B')).toBeVisible();
}
async function second(page: Page) {
  await page.getByRole('button', { name: 'Prepare merge request', exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Create this merge request?' })
    .getByRole('button', { name: 'Create', exact: true })
    .click();
}
async function transcript(page: Page) {
  return JSON.parse(
    (await page.locator('[data-boundary-transcript]').textContent()) ?? '[]',
  ) as Array<{ channel: string; payload: Record<string, unknown> }>;
}
async function evidence(page: Page, name: string) {
  await test
    .info()
    .attach(name + '.png', { body: await page.screenshot(), contentType: 'image/png' });
  await test.info().attach(name + '-boundary.json', {
    body: JSON.stringify(await transcript(page)),
    contentType: 'application/json',
  });
  const geometry = await page
    .locator('[data-sidebar-native-ready]')
    .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  await test.info().attach(name + '-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
}

test('keyboard literal target and two original confirmations preserve cancellation and never execute on queue', async ({
  mount,
  page,
}) => {
  await mount(Preview);
  await fill(page);
  const commit = page
    .getByRole('region', { name: 'Create a merge request' })
    .getByRole('button', { name: 'Commit', exact: true });
  await commit.focus();
  await commit.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Commit', exact: true });
  await expect(dialog).toContainText('Original staged commit');
  await expect(dialog).toContainText('release/literal');
  expect((await transcript(page)).filter((r) => r.channel === 'execute')).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await first(page);
  await page.getByRole('button', { name: 'Prepare merge request', exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await transcript(page)).filter((r) => r.channel === 'execute')).toHaveLength(1);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Merge request created')).toBeVisible();
  const rows = await transcript(page),
    prepared = rows.filter((r) => r.channel === 'prepare');
  expect(prepared).toHaveLength(2);
  expect(prepared[0].payload.input).toMatchObject({
    action: 'commit',
    review: { targetBranch: 'release/literal ', companion: { kind: 'create-pr' } },
  });
  expect(prepared[1].payload).toHaveProperty('companionOf', 'sidebar-operation-1');
  expect(rows.filter((r) => r.channel === 'execute').map((r) => r.payload.command)).toEqual([
    { commitMessage: 'Original staged commit' },
    { prTitle: 'Original review title', prBody: 'Original review body' },
  ]);
  await evidence(page, 'sidebar-created');
});
test('child failure preserves the original completed commit', async ({ mount, page }) => {
  await mount(Preview, { props: { scene: 'failed' } });
  await fill(page);
  await first(page);
  await second(page);
  await expect(page.getByText('Review creation failed')).toBeVisible();
  await expect(page.getByText('Completed commit: staged-parent-B')).toBeVisible();
  expect((await transcript(page)).filter((r) => r.channel === 'execute')).toHaveLength(2);
  await expect(
    page.getByRole('button', { name: 'Prepare merge request', exact: true }),
  ).toHaveCount(0);
  await evidence(page, 'sidebar-child-failed');
});
test('child uncertainty uses one explicit original Check without replay and retains parent facts', async ({
  mount,
  page,
}) => {
  await mount(Preview, { props: { scene: 'uncertain' } });
  await fill(page);
  await first(page);
  await second(page);
  await expect(page.getByText(/The result is uncertain/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.getByText('Existing merge request reused')).toBeVisible();
  await expect(page.getByText('Completed commit: staged-parent-B')).toBeVisible();
  const rows = await transcript(page);
  expect(rows.filter((r) => r.channel === 'execute')).toHaveLength(2);
  expect(rows.filter((r) => r.channel === 'reconcile').map((r) => r.payload.id)).toEqual([
    'sidebar-operation-2',
  ]);
  await evidence(page, 'sidebar-child-uncertain');
});
test('Member omissions and fresh Guest refusal fit 300px without added commands', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 300, height: 1100 });
  await mount(Preview, { props: { member: true, scene: 'reused', baseRef: 'release/saved' } });
  await fill(page, 'release/saved');
  await first(page);
  await second(page);
  await expect(page.getByText('Existing merge request reused')).toBeVisible();
  await expect(page.getByText('Target branch: Unknown')).toBeVisible();
  await evidence(page, 'sidebar-member');
  await page
    .getByRole('region', { name: 'Create a merge request' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  const before = (await transcript(page)).filter(
    (r) => r.channel === 'prepare' || r.channel === 'execute',
  );
  await page.getByRole('button', { name: 'Guest access', exact: true }).click();
  await expect(
    page.getByText('This review cannot be prepared with the current repository and access.'),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Create a merge request' })
      .getByRole('button', { name: 'Commit', exact: true }),
  ).toHaveCount(0);
  expect(
    (await transcript(page)).filter((r) => r.channel === 'prepare' || r.channel === 'execute'),
  ).toEqual(before);
  await evidence(page, 'sidebar-guest');
});
