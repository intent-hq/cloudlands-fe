import { expect, test } from '../../../../test/ct-test';
import Dropdown from './Dropdown.svelte';

test('empty dropdown copy stays at the left content inset', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  const component = await mount(Dropdown, {
    props: { options: [], portal: true, animate: false, contentClass: 'w-72' },
  });
  await component.getByRole('button').click();
  const empty = page.getByRole('listbox').getByText('No results found', { exact: true });
  await expect(empty).toBeVisible();
  const inset = await empty.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().left - element.getBoundingClientRect().left;
  });
  expect(inset).toBeCloseTo(8, 0);
});

test('filtered dropdown empty-state title and description share the left inset', async ({
  mount,
  page,
}) => {
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
  const titleBox = (await title.boundingBox())!;
  const descriptionBox = (await description.boundingBox())!;
  expect(titleBox.x).toBeCloseTo(descriptionBox.x, 0);
  expect(descriptionBox.y).toBeGreaterThan(titleBox.y);
  const inset = await title.evaluate(
    (element) =>
      element.getBoundingClientRect().left - element.parentElement!.getBoundingClientRect().left,
  );
  expect(inset).toBeCloseTo(8, 0);
});
