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
