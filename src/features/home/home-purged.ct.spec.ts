import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

// An archived workspace whose folder was purged (`Retired`, PROTOCOL §5.1) is
// presented as archived: there is no Retired chip, it appears only under
// Archived (list and board), and All, Needs you and Running never show it.
test('Home shows purged workspaces under Archived, with no Retired chip', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'purged', height: 880 } });
  const purged = component.locator('[data-home-workspace="home-retired"]');
  const filters = component.getByRole('group', { name: 'Status', exact: true });

  const chips = await filters.getByRole('button').allInnerTexts();
  const labels = chips.map((text) => text.replace(/\d+$/, '').trim());
  expect(labels.at(-1)).toBe('Archived');
  expect(labels).not.toContain('Retired');

  await expect(component.locator('[data-home-workspace]').first()).toBeVisible();
  await expect(purged).toHaveCount(0);
  for (const name of ['Needs you', 'Running']) {
    await filters.getByRole('button', { name, exact: false }).first().click();
    await expect(purged).toHaveCount(0);
  }

  await filters.getByRole('button', { name: 'Archived', exact: false }).first().click();
  await expect(purged).toHaveCount(1);
  await expect(purged).not.toContainText('Retired');

  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  const board = component.locator('[data-home-board]');
  await expect(board.getByRole('region', { name: 'Archived', exact: true })).toBeVisible();
  await expect(board.locator('[data-home-workspace="home-retired"]')).toHaveCount(1);
});

// Under Archived, a purged row carries a "Workspace purged" pill on the right,
// just before the status icon and last activity; plain archived rows do not.
test('Home marks purged workspaces with a Workspace purged pill', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'purged', height: 880 } });
  const filters = component.getByRole('group', { name: 'Status', exact: true });
  await filters.getByRole('button', { name: 'Archived', exact: false }).first().click();

  const purged = component.locator('[data-home-workspace="home-retired"]');
  const pill = purged.locator('[data-home-workspace-purged]');
  await expect(pill).toHaveText('Workspace purged');
  await expect(
    component.locator('[data-home-workspace="home-archived"] [data-home-workspace-purged]'),
  ).toHaveCount(0);
  await expect(component.locator('[data-home-workspace-purged]')).toHaveCount(1);

  const pillBox = await pill.boundingBox();
  const statusBox = await purged.locator('[data-home-status]').boundingBox();
  const timeBox = await purged.locator('[data-home-row-time]').boundingBox();
  expect(pillBox && statusBox && timeBox).toBeTruthy();
  expect(pillBox!.x + pillBox!.width).toBeLessThanOrEqual(statusBox!.x);
  expect(statusBox!.x).toBeLessThan(timeBox!.x);

  await pill.hover();
  await expect(page.getByRole('tooltip')).toContainText('deleted to free disk space');

  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  const board = component.locator('[data-home-board]');
  await expect(
    board.locator('[data-home-workspace="home-retired"] [data-home-workspace-purged]'),
  ).toHaveText('Workspace purged');
  await expect(board.locator('[data-home-workspace-purged]')).toHaveCount(1);
});
