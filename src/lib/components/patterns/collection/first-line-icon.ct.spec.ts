import { expect, test } from '../../../../test/ct-test';
import Harness from './FirstLineIconHarness.svelte';

test('an accordion with a wrapped label remains expandable', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mount(Harness, { props: { kind: 'accordion' } });
  await page.getByRole('button').click();
  await expect(page.getByText('Expanded details')).toBeVisible();
});
