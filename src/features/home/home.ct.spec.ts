import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

test('Home filters and previews workspaces without entering them', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  const list = component.getByRole('listbox', { name: 'Workspaces' });
  await expect(list.getByRole('option')).toHaveCount(6);
  await component.getByRole('tab', { name: 'Pull requests', exact: true }).click();
  await expect(component.getByRole('tab', { name: 'Pull requests', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('ArrowLeft');
  await expect(component.getByRole('tab', { name: 'Workspaces', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(list.getByRole('option')).toHaveCount(6);
  await component.getByRole('button', { name: /^Needs you/ }).click();
  await expect(list.getByRole('option')).toHaveCount(2);
  await list.getByRole('option').first().focus();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await expect(component.getByRole('button', { name: 'Open workspace' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await expect(list.getByRole('option').first()).toBeFocused();
  await component.getByRole('button', { name: /^Unread/ }).click();
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list).toContainText('Document the release process');
  await component.getByRole('button', { name: /^Archived/ }).click();
  await expect(list).toContainText('Explore alternative layouts');
  await component.getByRole('button', { name: /^All workspaces/ }).click();
  await component.getByRole('button', { name: 'acme/platform', exact: true }).click();
  await expect(list.getByRole('option')).toHaveCount(2);
  await component.getByRole('searchbox').fill('no matching work');
  await expect(component.getByRole('heading', { name: 'No matching workspaces' })).toBeVisible();
  await component.getByRole('button', { name: 'Clear filters' }).click();
  await expect(list.getByRole('option')).toHaveCount(6);
  await testInfo.attach('home-list', { body: await page.screenshot(), contentType: 'image/png' });
});

test('Home board uses the same scope and restores keyboard focus after narrow preview', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const component = await mount(Preview, { props: { scenario: 'board' } });
  await expect(component.getByRole('button', { name: 'Board view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const board = component.locator('[data-home-board]');
  await expect(board.getByRole('button')).toHaveCount(6);
  const card = board.getByRole('button', { name: 'Review the new onboarding flow', exact: true });
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-home-detail]')).toBeVisible();
  await component.getByRole('button', { name: 'Back to list' }).click();
  await expect(card).toBeFocused();
  expect(
    await component
      .locator('[data-home-page]')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await component.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(component.getByRole('listbox').getByRole('option')).toHaveCount(6);
  await component.getByRole('button', { name: 'Board view', exact: true }).click();
  await component.getByRole('button', { name: /^Running/ }).click();
  await expect(board.getByRole('button')).toHaveCount(1);
  await testInfo.attach('home-board', { body: await page.screenshot(), contentType: 'image/png' });
});

test('Home keeps Assistant and owner creation hidden for collaborators', async ({ mount }) => {
  const component = await mount(Preview, { props: { scenario: 'collaborator' } });
  await expect(component.getByRole('button', { name: 'Assistant', exact: true })).toHaveCount(0);
  await expect(component.getByRole('button', { name: 'New workspace', exact: true })).toHaveCount(
    0,
  );
  await expect(component.getByRole('listbox').getByRole('option')).toHaveCount(6);
});

test('Home shows connection errors with a retry action', async ({ mount }) => {
  const component = await mount(Preview, { props: { scenario: 'error' } });
  await expect(component.getByRole('alert')).toContainText(
    'The daemon connection was interrupted.',
  );
  await expect(component.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});
