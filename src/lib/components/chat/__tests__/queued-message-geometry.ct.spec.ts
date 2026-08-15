import { expect, test } from '@playwright/experimental-ct-svelte';
import QueuedMessageGeometryHost from './QueuedMessageGeometryHost.svelte';

for (const state of [
  { name: 'narrow', width: 240, zoom: 1 },
  { name: 'narrow at 200% zoom', width: 120, zoom: 2 },
]) {
  test(`keeps queued-message row height stable at ${state.name}`, async ({ mount }) => {
    const component = await mount(QueuedMessageGeometryHost, { props: state });
    const row = component.getByTestId('queued-message-row');
    const content = component.getByTestId('queued-message-content');
    const actions = component.getByTestId('queued-message-actions');
    const initialHeight = (await row.boundingBox())!.height;
    const initialPadding = await content.evaluate((node) => getComputedStyle(node).paddingRight);

    await row.hover();
    const hoverHeight = (await row.boundingBox())!.height;
    await actions.getByRole('button').first().focus();
    const focusHeight = (await row.boundingBox())!.height;

    expect(initialPadding).toBe('96px');
    expect(hoverHeight).toBeCloseTo(initialHeight, 1);
    expect(focusHeight).toBeCloseTo(initialHeight, 1);
  });
}
