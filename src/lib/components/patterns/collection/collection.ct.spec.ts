import { expect, test } from '@playwright/experimental-ct-svelte';
import CollectionHarness from './CollectionHarness.svelte';

for (const key of ['Enter', 'Space']) {
  test(`${key} activates a nested row action exactly once without selecting the row`, async ({
    mount,
  }) => {
    const component = await mount(CollectionHarness);
    const first = component.getByRole('option').first();
    const action = first.getByRole('button', { name: 'Act on Alpha' });

    await action.press(key);

    await expect(component.getByRole('status', { name: 'Action count' })).toHaveText('1');
    await expect(first).toHaveAttribute('aria-selected', 'false');
  });
}

test('arrow keys in a nested input do not move row focus', async ({ mount }) => {
  const component = await mount(CollectionHarness);
  const first = component.getByRole('option').first();
  const input = first.getByRole('textbox', { name: 'Edit Alpha' });

  await input.focus();
  await input.press('ArrowDown');

  await expect(input).toBeFocused();
});

test('keyboard row focus reveals its actions', async ({ mount }) => {
  const component = await mount(CollectionHarness);
  const first = component.getByRole('option').first();
  const actions = first.locator('[data-slot="row-actions"]');

  await first.focus();

  await expect(actions).toHaveCSS('opacity', '1');
});

test('an open overflow menu keeps row actions revealed', async ({ mount, page }) => {
  const component = await mount(CollectionHarness);
  const first = component.getByRole('option').first();
  const actions = first.locator('[data-slot="row-actions"]');

  const overflow = first.getByRole('button', { name: 'More actions for Alpha' });
  await overflow.focus();
  await overflow.press('Enter');

  await expect(page.getByRole('menu', { name: 'More actions for Alpha' })).toBeVisible();
  await expect(actions).toHaveCSS('opacity', '1');
});
