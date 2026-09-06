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
