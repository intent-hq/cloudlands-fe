import { test, expect } from '../../../../test/ct-test';
import Harness from './GroupedComboboxHarness.svelte';

test('portals grouped options beyond a clipping parent and keeps header actions quiet', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await page.getByRole('combobox').click();
  const option = page.getByRole('option', { name: 'Beta', exact: true });
  await expect(option).toBeVisible();
  expect(
    await option.evaluate((node) => node.closest('[data-testid="clipping-parent"]')),
  ).toBeNull();
  const box = await option.boundingBox();
  expect(box).not.toBeNull();
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('[role="option"]')?.textContent?.includes('Beta'),
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    ),
  ).toBe(true);
  const toggle = page.getByRole('button', { name: /Toggle.*Projects/i });
  await toggle.hover();
  await expect
    .poll(() =>
      toggle.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const fills = node.closest('[role="listbox"]')?.querySelectorAll('.bg-hover') ?? [];
        return Array.from(fills).some((fill) => {
          const rect = fill.getBoundingClientRect();
          return (
            rect.left < box.right &&
            rect.right > box.left &&
            rect.top < box.bottom &&
            rect.bottom > box.top
          );
        });
      }),
    )
    .toBe(false);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(option).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByLabel('Selected project')).toHaveText('beta');
});
