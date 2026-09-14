/**
 * Regression (fe#2440 verifier): the owner's hover-card Share/Remove controls
 * must be reachable with a real pointer in the real wrapper. WorkspaceCard
 * portals the card beside the row; leaving the row toward the card must not
 * dismiss it, and pressing its controls must not count as an outside click.
 *
 * Sagas do not run in the CT bundle, so the mutation the confirm step
 * dispatches is observed as the reducer-owned in-flight marker rather than a
 * wire call; the Share entry is observed as the dialog target the reducer
 * records.
 */
import { expect, test, type MountResult } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import WorkspaceCardShareHoverHarness from './mocks/WorkspaceCardShareHoverHarness.svelte';

async function enterCardFromRow(page: Page, component: MountResult) {
  const row = component.locator('[data-workspace-card-row]');
  await row.hover();
  const surface = page.locator('[data-workspace-card-hover-surface]');
  await expect(surface).toBeVisible();
  const members = surface.locator('[data-workspace-hover-card-members]');
  await expect(members.locator('[data-workspace-hover-card-member-row]')).toHaveCount(2);
  await moveInSteps(page, row, surface);
  await expect(surface).toBeVisible();
  return { row, surface, members, state: component.locator('[data-share-hover-state]') };
}

async function moveInSteps(page: Page, from: Locator, to: Locator) {
  const [a, b] = await Promise.all([from.boundingBox(), to.boundingBox()]);
  if (!a || !b) throw new Error('row and hover card must both be laid out');
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const end = { x: b.x + 24, y: b.y + 24 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.move(end.x, end.y, { steps: 10 });
}

test('the card stays open while the pointer travels from the row into it', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'travel' },
  });
  const { surface, state } = await enterCardFromRow(page, component);

  await expect(surface.getByRole('button', { name: 'Remove bob' })).toBeVisible();
  await expect(surface.locator('[data-workspace-hover-card-share]')).toBeVisible();
  await expect(state).toHaveAttribute('data-member-count', '2');
});

test('first Remove asks for confirmation and Cancel dispatches no removal', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'cancel' },
  });
  const { surface, members, state } = await enterCardFromRow(page, component);

  await expect(members.getByRole('button', { name: 'Remove Alice' })).toHaveCount(0);
  await members.getByRole('button', { name: 'Remove bob' }).click();
  await expect(surface).toBeVisible();
  await expect(surface.locator('[data-workspace-hover-card-member-remove-confirm]')).toBeVisible();
  await expect(state).toHaveAttribute('data-removing-principal-id', '');
  await expect(state).toHaveAttribute('data-member-count', '2');

  await members.getByRole('button', { name: 'Cancel' }).click();
  await expect(surface.locator('[data-workspace-hover-card-member-remove-confirm]')).toHaveCount(0);
  await expect(surface).toBeVisible();
  await expect(state).toHaveAttribute('data-removing-principal-id', '');
  await expect(state).toHaveAttribute('data-member-count', '2');
});

test('confirming removes only the collaborator and keeps the card open', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'confirm' },
  });
  const { surface, members, state } = await enterCardFromRow(page, component);

  await members.getByRole('button', { name: 'Remove bob' }).click();
  await members.getByRole('button', { name: 'Confirm removing bob' }).click();

  await expect(state).toHaveAttribute('data-removing-principal-id', 'p-bob');
  await expect(surface).toBeVisible();
  await expect(members.getByRole('button', { name: 'Remove bob' })).toBeDisabled();
  await expect(members.locator('[data-workspace-hover-card-member-row]')).toHaveCount(2);
});

test('Share opens the dialog for the hovered workspace in one step', async ({ mount, page }) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'share' },
  });
  const { surface, state } = await enterCardFromRow(page, component);

  await surface.locator('[data-workspace-hover-card-share]').click();

  await expect(state).toHaveAttribute('data-dialog-open', 'true');
  await expect(state).toHaveAttribute('data-dialog-workspace-id', 'share-hover-share');
});

test('leaving both the row and the card still dismisses it', async ({ mount, page }) => {
  const component = await mount(WorkspaceCardShareHoverHarness, {
    props: { scenario: 'dismiss' },
  });
  const { row, surface } = await enterCardFromRow(page, component);

  // Straight down from the row: below the single row, left of the card.
  const rowBox = (await row.boundingBox())!;
  await page.mouse.move(rowBox.x + 8, rowBox.y + rowBox.height + 200, { steps: 10 });
  await expect(surface).toHaveCount(0);
});
