import { expect, test } from '../../../../test/ct-test';
import CollectionStateHarness from './CollectionStateHarness.svelte';

test('virtual rows fill the viewport on mount and resize without scrolling', async ({
  mount,
  page,
}) => {
  await mount(CollectionStateHarness, { props: { count: 300 } });
  const list = page.getByRole('list');
  const rows = list.getByRole('listitem');

  // Four visible 48px rows plus the default four-row overscan.
  await expect(rows).toHaveCount(8);
  await expect(list).toHaveJSProperty('scrollTop', 0);

  await list.evaluate((element) => {
    element.style.height = '480px';
  });

  // Ten visible rows plus overscan, with no scroll event to refresh the range.
  await expect(rows).toHaveCount(14);
  await expect(rows.nth(9)).toBeInViewport();
  await expect(list).toHaveJSProperty('scrollTop', 0);
});
