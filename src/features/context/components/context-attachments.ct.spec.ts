import { expect, test } from '../../../test/ct-test';
import ContextAttachmentsSection from './ContextAttachmentsSection.svelte';
import { preview } from './context-attachments.preview';

test('sidebar images support keyboard previews and restore focus', async ({ mount, page }) => {
  await page.setViewportSize({ width: 320, height: 600 });
  const component = await mount(ContextAttachmentsSection, { props: preview.states.grid.props });
  const thumbnails = component.locator('[data-context-attachment-grid] button');
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
      return { scrollWidth: button.scrollWidth, clientWidth: button.clientWidth };
    }),
  );
  for (const tile of geometry) {
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
