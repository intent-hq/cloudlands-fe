import HoverActionProbeHarness from './__tests__/HoverActionProbeHarness.svelte';
import { activateHoverAction, expect, test } from './ct-test';

// Playwright highlights parts of its error messages with ANSI colour codes.
const plain = (error: Error | null) => error?.message.replace(/\u001b\[[0-9;]*m/g, '');

test('activates the action without any hover, and toggles it back', async ({ mount }) => {
  const component = await mount(HoverActionProbeHarness);
  const list = component.getByTestId('list');
  const action = component.getByTestId('target-row').getByRole('button', { name: 'Expand' });

  const opened = await activateHoverAction(action, list);
  await expect(component.getByTestId('details')).toBeVisible();
  const closed = await activateHoverAction(action, list);
  await expect(component.getByTestId('details')).toHaveCount(0);
  expect(closed.height).toBeLessThan(opened.height);
});

test('with requireChange: false, an action that leaves the region still is accepted', async ({
  mount,
}) => {
  const component = await mount(HoverActionProbeHarness);
  const list = component.getByTestId('list');
  const row = component.getByTestId('other-row');

  await activateHoverAction(row.getByRole('button', { name: 'Open menu' }), list, {
    requireChange: false,
  });
  await expect(
    component.getByTestId('target-row').getByRole('button', { name: 'Expand' }),
  ).toHaveAttribute('data-activations', '1');
});

test('fails when an action that should move the region leaves it still', async ({ mount }) => {
  const component = await mount(HoverActionProbeHarness);
  const list = component.getByTestId('list');
  const action = component.getByTestId('other-row').getByRole('button', { name: 'Open menu' });

  const error = await activateHoverAction(action, list, { timeout: 2_500 })
    .then(() => null)
    .catch((caught: Error) => caught);
  expect(plain(error)).toMatch(/activating .* should move or resize .*, which should then settle/);
});
