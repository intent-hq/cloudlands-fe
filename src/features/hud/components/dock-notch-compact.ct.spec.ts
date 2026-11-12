import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

test('collapsed notch controls avoid the camera exclusion', async ({ mount, page }) => {
  await page.setViewportSize({ width: 900, height: 400 });
  await page.mouse.move(890, 390);
  const component = await mount(DockRailPreview, {
    props: dockRailPreview.states['notch-many-updates'].props,
  });
  await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-expanded', 'false');
  const glyphs = component.locator('.notch-status-glyph');
  await expect(glyphs.first()).toBeVisible();
  const camera = (await component.getByTestId('dock-camera-exclusion').boundingBox())!;
  const grip = (await component.locator('.dock-grip').boundingBox())!;
  expect(grip.x + grip.width).toBeLessThanOrEqual(camera.x + 0.5);
  for (const glyph of await glyphs.all()) {
    const box = (await glyph.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(camera.x + camera.width - 0.5);
  }
});
