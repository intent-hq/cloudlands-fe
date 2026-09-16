import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/experimental-ct-svelte';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import ContextImagesSection from './ContextImagesSection.svelte';
import { preview } from './context-images.preview';

defineGeometrySnapshotSuite({
  scene: 'context-images',
  component: ContextImagesSection,
  states: ['grid'],
  widths: [320],
  selector: '[data-context-image-grid] button',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/context-images.geometry.json', import.meta.url),
  ),
});

test('sidebar images form square three-column rows and support keyboard previews', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 600 });
  const component = await mount(ContextImagesSection, { props: preview.states.grid.props });
  const thumbnails = component.locator('[data-context-image-grid] button');
  const boxes = await thumbnails.evaluateAll((buttons) =>
    buttons.map((button) => {
      const { x, y, width, height } = button.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  expect(boxes).toHaveLength(4);
  for (const box of boxes) expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
  expect(boxes[1].y).toBe(boxes[0].y);
  expect(boxes[2].y).toBe(boxes[0].y);
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
  expect(boxes[3].y).toBeGreaterThan(boxes[0].y);
  await thumbnails.first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(thumbnails.first()).toBeFocused();
});
