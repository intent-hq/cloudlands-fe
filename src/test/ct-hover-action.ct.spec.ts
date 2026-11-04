import HoverActionProbeHarness from './__tests__/HoverActionProbeHarness.svelte';
import { activateHoverAction, expect, expectMotionToSettle, motionSnapshot, test } from './ct-test';

// Playwright highlights parts of its error messages with ANSI colour codes.
const plain = (error: Error | null) => error?.message.replace(/\u001b\[[0-9;]*m/g, '');

test('a pointer click on a hover-only action works while its row stays put', async ({ mount }) => {
  const component = await mount(HoverActionProbeHarness);
  const row = component.getByTestId('target-row');
  const action = row.getByRole('button', { name: 'Expand' });

  await row.hover();
  // eslint-disable-next-line intent/no-hover-then-click-in-ct -- checks the fixture's pointer path while nothing moves
  await action.click();
  await expect(component.getByTestId('details')).toBeVisible();
});

test('reproduces the hang: the row moves after the hover and the click never lands', async ({
  mount,
}) => {
  const component = await mount(HoverActionProbeHarness, { props: { growOnHover: true } });
  const list = component.getByTestId('list');
  const row = component.getByTestId('target-row');
  const action = row.getByRole('button', { name: 'Expand' });

  const before = await motionSnapshot(list);
  await row.hover();
  await expect(component.getByTestId('spacer')).toHaveAttribute('data-grown', 'true');
  await expectMotionToSettle(list, { changedFrom: before });

  // The pointer is now over the spacer, so the row is not hovered and the action still
  // lets pointer events through to the row text: the click retries until it times out.
  const error = await action
    // eslint-disable-next-line intent/no-hover-then-click-in-ct -- proves the hazard activateHoverAction avoids
    .click({ timeout: 2_000 })
    .then(() => null)
    .catch((caught: Error) => caught);
  expect(plain(error)).toMatch(/Timeout 2000ms exceeded/);
  expect(plain(error)).toMatch(/intercepts pointer events/);
  await expect(action).toHaveAttribute('data-activations', '0');
});

test('activates the action after the row moved out from under the pointer', async ({ mount }) => {
  const component = await mount(HoverActionProbeHarness, { props: { growOnHover: true } });
  const list = component.getByTestId('list');
  const row = component.getByTestId('target-row');
  const action = row.getByRole('button', { name: 'Expand' });

  await row.hover();
  const settled = await activateHoverAction(action, list);

  await expect(component.getByTestId('spacer')).toHaveAttribute('data-grown', 'true');
  await expect(component.getByTestId('details')).toBeVisible();
  await expect(action).toHaveAttribute('data-activations', '1');
  // The region settled after the expansion, so the details are already in place.
  expect(settled.height).toBe((await list.boundingBox())!.height);
});

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
