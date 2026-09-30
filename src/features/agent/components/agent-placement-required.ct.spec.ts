import { expect, test } from '../../../test/ct-test';
import Preview from './agent-placement-required.preview.svelte';

test('local placement options remain clickable above the launch dialog', async ({
  mount,
  page,
}) => {
  await mount(Preview, { props: { isolated: true } });
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: 'Remote isolated checkout' })).toHaveCount(0);
  await page.getByRole('option', { name: 'Local worktree' }).click();
  await expect(page.getByRole('combobox')).toHaveText('Local worktree');
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeEnabled();
});
