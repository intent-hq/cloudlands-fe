import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

// Retired workspaces (PROTOCOL §5.1) appear on Home only under the Retired
// chip, which sits immediately after Archived; All, Needs you, Running and
// Archived never show them.
test('Home shows retired workspaces only under the Retired chip, after Archived', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'retired', height: 880 } });
  const retired = component.locator('[data-home-workspace="home-retired"]');
  const filters = component.getByRole('group', { name: 'Status', exact: true });

  const chips = await filters.getByRole('button').allInnerTexts();
  const labels = chips.map((text) => text.replace(/\d+$/, '').trim());
  expect(labels.slice(-2)).toEqual(['Archived', 'Retired']);

  await expect(component.locator('[data-home-workspace]').first()).toBeVisible();
  await expect(retired).toHaveCount(0);
  for (const name of ['Needs you', 'Running', 'Archived']) {
    await filters.getByRole('button', { name, exact: false }).first().click();
    await expect(retired).toHaveCount(0);
  }

  await filters.getByRole('button', { name: 'Retired', exact: true }).click();
  await expect(retired).toHaveCount(1);
  await expect(component.locator('[data-home-workspace]')).toHaveCount(1);

  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  const board = component.locator('[data-home-board]');
  await expect(board.getByRole('region', { name: 'Retired', exact: true })).toBeVisible();
  await expect(board.locator('[data-home-workspace="home-retired"]')).toHaveCount(1);
});
