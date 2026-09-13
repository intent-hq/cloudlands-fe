import { test, expect } from '@playwright/experimental-ct-svelte';
import Harness from './CardGroupHarness.svelte';

test('reflows a card group when columns change and highlights the approached card', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const first = page.getByLabel('First card');
  const second = page.getByLabel('Second card');
  const firstBox = (await first.boundingBox())!;
  const secondBox = (await second.boundingBox())!;
  expect(Math.abs(firstBox.y - secondBox.y)).toBeLessThan(1);
  expect(secondBox.x).toBeGreaterThanOrEqual(firstBox.x + firstBox.width - 1);
  await second.hover();
  const fill = page.getByLabel('Card collection').locator('.bg-hover');
  await expect(fill).toBeVisible();
  await expect
    .poll(async () => Math.abs((await fill.boundingBox())!.x - (await second.boundingBox())!.x))
    .toBeLessThan(1);
  await page.getByRole('button', { name: 'Change layout' }).click();
  await expect
    .poll(async () => (await second.boundingBox())!.y - (await first.boundingBox())!.y)
    .toBeGreaterThan(1);
});
