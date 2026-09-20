import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/experimental-ct-svelte';
import { defineGeometrySnapshotSuite } from '$lib/component-catalog/geometry-snapshot';
import ContextAttachmentsSection from './ContextAttachmentsSection.svelte';
import { preview } from './context-attachments.preview';

defineGeometrySnapshotSuite({
  scene: 'context-attachments',
  component: ContextAttachmentsSection,
  states: ['grid'],
  widths: [320],
  selector: '[data-context-attachment-grid] button',
  snapshotPath: fileURLToPath(
    new URL('./__geometry__/context-attachments.geometry.json', import.meta.url),
  ),
});

test('sidebar images form square three-column rows and support keyboard previews', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 600 });
  const component = await mount(ContextAttachmentsSection, { props: preview.states.grid.props });
  const thumbnails = component.locator('[data-context-attachment-grid] button');
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

test('mixed attachment tiles fit the narrow sidebar and skip unavailable files by keyboard', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 600 });
  const component = await mount(ContextAttachmentsSection, { props: preview.states.mixed.props });
  const tiles = component.locator('[data-context-attachment-grid] button');
  const geometry = await tiles.evaluateAll((buttons) =>
    buttons.map((button) => {
      const { width, height } = button.getBoundingClientRect();
      return { width, height, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth };
    }),
  );
  for (const tile of geometry) {
    expect(Math.abs(tile.width - tile.height)).toBeLessThanOrEqual(1);
    expect(tile.scrollWidth).toBeLessThanOrEqual(tile.clientWidth);
  }
  await tiles.nth(3).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(tiles.nth(2)).toBeFocused();
  await tiles.nth(3).focus();
  await page.keyboard.press('Tab');
  await expect(tiles.nth(4)).not.toBeFocused();
  await expect(tiles.nth(5)).not.toBeFocused();
});
