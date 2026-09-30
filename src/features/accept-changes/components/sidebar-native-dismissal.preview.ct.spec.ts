import { test, expect } from '../../../test/ct-test';
import Preview from './sidebar-native-dismissal.preview.svelte';

test.describe.configure({ retries: 0 });
type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Row = {
  id: string;
  closed: boolean;
  publicNull: boolean;
  success?: boolean;
  receipts?: Array<{ stage: string; commitHash?: string }>;
};
type Report = {
  dismissal: string;
  duplicate: boolean;
  completions: number;
  held: number;
  generation: number;
  events: Array<{ kind: string; id?: string }>;
  requests: Array<{ id: string; kind: string }>;
  captures: Array<{ id: string; companionOf?: string }>;
  attempts: Row[];
};
async function report(page: Page): Promise<Report> {
  return JSON.parse((await page.locator('[data-dismissal-report]').textContent())!);
}
test.afterEach(async ({ page }, info) => {
  if (await page.locator('[data-dismissal-report]').count()) {
    await info.attach('original-dismissal-final.json', {
      body: JSON.stringify(await report(page)),
      contentType: 'application/json',
    });
  }
});
async function parent(page: Page) {
  await page.getByTestId('pr-create-button').click();
  await page.getByRole('textbox', { name: 'Target branch', exact: true }).fill('release/literal ');
  await page
    .getByRole('textbox', { name: 'Commit Message', exact: true })
    .fill('Original staged commit');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Original child title');
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Original child body');
  await page
    .getByRole('region', { name: 'Create a merge request' })
    .getByRole('button', { name: 'Commit', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Commit', exact: true })
    .getByRole('button', { name: 'Commit', exact: true })
    .click();
  await expect.poll(async () => (await report(page)).requests.length).toBe(1);
  await page.getByRole('button', { name: 'Finish parent', exact: true }).click();
  await expect(page.getByText('Completed commit: staged-parent-B')).toBeVisible();
}
async function heldChild(page: Page) {
  await parent(page);
  await page.getByRole('button', { name: 'Prepare merge request', exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Create this merge request?' })
    .getByRole('button', { name: 'Create', exact: true })
    .click();
  await expect.poll(async () => (await report(page)).requests.length).toBe(2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function dismissHeld(page: Page) {
  await page.getByRole('button', { name: 'Staged', exact: true }).click();
  await expect.poll(async () => (await report(page)).held).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Dismiss sidebar', exact: true }).click();
  const pending = await report(page);
  expect(pending.dismissal).toBe('pending');
  expect(pending.completions).toBe(0);
  return pending;
}
async function finishDismissal(page: Page) {
  await page.getByRole('button', { name: 'Finish original animations', exact: true }).click();
  await expect.poll(async () => (await report(page)).dismissal).toBe('completed');
  const after = await report(page);
  expect(after.attempts.every((row) => row.publicNull && row.closed)).toBe(true);
  return after;
}
async function evidence(page: Page, name: string) {
  await test.info().attach(name + '.json', {
    body: JSON.stringify(await report(page)),
    contentType: 'application/json',
  });
  await test
    .info()
    .attach(name + '.png', { body: await page.screenshot(), contentType: 'image/png' });
}
test('dismiss waits for the original sidebar destruction and exact parent child demand retirement', async ({
  mount,
  page,
}) => {
  await mount(Preview);
  await heldChild(page);
  const before = await report(page);
  await dismissHeld(page);
  const after = await finishDismissal(page);
  expect(after.duplicate).toBe(true);
  expect(after.completions).toBe(1);
  expect(after.requests).toEqual(before.requests);
  expect(after.captures).toEqual(before.captures);
  const ended = after.events
    .filter((event) => event.kind === 'owner-ended')
    .map((event) => event.id);
  expect(ended).toEqual([before.attempts[1].id, before.attempts[0].id]);
  expect(after.events.some((event) => event.kind === 'demand-ended')).toBe(true);
  expect(after.events.at(-1)?.kind).toBe('dismiss-completed');
  expect(after.attempts[1].success).toBeUndefined();
  await evidence(page, 'dismiss-originals');
});
test('late original child result is retained after completed dismissal without adopting replacement owners', async ({
  mount,
  page,
}) => {
  await mount(Preview);
  await heldChild(page);
  const before = await report(page);
  await dismissHeld(page);
  await finishDismissal(page);
  await page.getByRole('button', { name: 'Finish child', exact: true }).click();
  await expect.poll(async () => (await report(page)).attempts[1].success).toBe(true);
  const closed = await report(page);
  expect(closed.attempts.map((row) => row.id)).toEqual(before.attempts.map((row) => row.id));
  expect(closed.attempts.every((row) => row.closed && row.publicNull)).toBe(true);
  expect(closed.attempts[0].receipts).toEqual([{ stage: 'commit', commitHash: 'staged-parent-B' }]);
  expect(closed.attempts[1].receipts).toEqual([]);
  await evidence(page, 'dismiss-late-original');
  await page.getByRole('button', { name: 'Mount next generation', exact: true }).click();
  await expect.poll(async () => (await report(page)).generation).toBe(1);
  await parent(page);
  const replacement = await report(page);
  expect(replacement.attempts.at(-1)?.id).not.toBe(before.attempts[0].id);
  expect(replacement.requests).toHaveLength(1);
  await evidence(page, 'dismiss-next-generation');
});
test('ordinary drawer close and nonfinal context replacement remain separate from fixture dismissal', async ({
  mount,
  page,
}) => {
  await mount(Preview);
  await parent(page);
  await page
    .getByRole('region', { name: 'Create a merge request' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect.poll(async () => (await report(page)).attempts[0].closed).toBe(true);
  const closed = await report(page);
  expect(closed.dismissal).toBe('idle');
  await page.getByRole('button', { name: 'Replace host', exact: true }).click();
  await page.getByRole('button', { name: 'Read original state', exact: true }).click();
  expect((await report(page)).events.filter((event) => event.kind === 'owner-ended')).toEqual(
    closed.events.filter((event) => event.kind === 'owner-ended'),
  );
  expect((await report(page)).requests).toEqual(closed.requests);
  await evidence(page, 'dismiss-nonfinal');
});
test('unfinished retirement and original errors never fulfill dismissal', async ({
  mount,
  page,
}) => {
  await mount(Preview);
  await heldChild(page);
  const held = await dismissHeld(page);
  await page.getByRole('button', { name: 'Read original state', exact: true }).click();
  const stillHeld = await report(page);
  expect(stillHeld.dismissal).toBe('pending');
  expect(stillHeld.requests).toEqual(held.requests);
  expect(stillHeld.attempts[1].success).toBeUndefined();
  await evidence(page, 'dismiss-incomplete');
  await finishDismissal(page);
});
