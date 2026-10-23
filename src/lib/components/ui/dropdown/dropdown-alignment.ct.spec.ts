import { expect, test } from '../../../../test/ct-test';
import Dropdown from './Dropdown.svelte';

test('empty dropdown displays its empty state', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  const component = await mount(Dropdown, {
    props: { options: [], portal: true, animate: false, contentClass: 'w-72' },
  });
  await component.getByRole('button').click();
  const empty = page.getByRole('listbox').getByText('No results found', { exact: true });
  await expect(empty).toBeVisible();
});

test('filtering out every option displays the empty state', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  const component = await mount(Dropdown, {
    props: {
      options: [{ value: 'alpha', label: 'Alpha' }],
      portal: true,
      animate: false,
      contentClass: 'w-72',
    },
  });
  await component.getByRole('button').click();
  await expect(page.getByRole('option', { name: 'Alpha' })).toBeVisible();
  await page.getByRole('searchbox').fill('missing');
  await expect(page.getByRole('option')).toHaveCount(0);
  const title = page.getByRole('listbox').getByText(/No results for/);
  const description = page.getByRole('listbox').getByText('Try a different search term');
  await expect(title).toBeVisible();
  await expect(description).toBeVisible();
});
