import { expect, test } from '@playwright/experimental-ct-svelte';
import MapTabTypeHost from './MapTabTypeHost.svelte';

for (const width of [320, 420, 640, 960]) {
  test(`map panel preserves usable canvas geometry at ${width}px`, async ({ mount }) => {
    const component = await mount(MapTabTypeHost, { props: { width } });
    const layout = component.locator('[data-semantic-map-layout]');
    const canvasPanel = component.locator('[data-semantic-map-canvas-panel]');
    const filters = component.locator('[data-semantic-map-sidebar="filters"]');
    const details = component.locator('[data-semantic-map-sidebar="details"]');
    const emptyAgents = filters.getByText('Agents will appear here when work is delegated.');
    const emptyDetails = details.getByText(
      'Select a region or agent to understand what is changing and why.',
    );
    const compact = width < 768;

    await expect(layout).toHaveAttribute('data-compact-breakpoint', '48rem');
    await expect
      .poll(async () => (await canvasPanel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(compact ? width - 2 : 400);
    await expect
      .poll(async () => (await filters.boundingBox())?.width ?? 0)
      .toBe(compact ? width : 256);
    await expect
      .poll(async () => (await details.boundingBox())?.width ?? 0)
      .toBe(compact ? width : 256);
    await expect(emptyAgents).toBeVisible({ visible: !compact });
    await expect(emptyDetails).toBeVisible({ visible: !compact });
  });
}
