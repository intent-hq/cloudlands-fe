import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Page } from '@playwright/test';
import { hugeDiffMapFixture, typicalDiffMapFixture } from '../model/fixtures';
import DiffMapPreview from './DiffMapPreview.svelte';

async function nextResizeFrame(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

test('reflows every block while narrowing from 900px to 280px in 20px steps', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(DiffMapPreview, {
    props: { document: typicalDiffMapFixture.document, onOpen: () => {} },
  });
  await component.evaluate((root) => {
    (root as HTMLElement).style.width = '900px';
    const frame = root.querySelector<HTMLElement>('.preview-frame');
    if (frame) frame.style.height = '500px';
  });
  await nextResizeFrame(page);

  for (let width = 880; width >= 280; width -= 20) {
    await component.evaluate((root, nextWidth) => {
      (root as HTMLElement).style.width = `${nextWidth}px`;
    }, width);
    await nextResizeFrame(page);
  }

  const geometry = await component.evaluate((root) => {
    const viewport = root.querySelector<HTMLElement>('.viewport')!.getBoundingClientRect();
    const blocks = [...root.querySelectorAll<HTMLElement>('[data-group-id]')].map((block) => {
      const bounds = block.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right };
    });
    return {
      viewport: { left: viewport.left, right: viewport.right, width: viewport.width },
      blocks,
    };
  });
  expect(geometry.viewport.width).toBeCloseTo(280, 0);
  expect(geometry.blocks.length).toBeGreaterThan(1);
  expect(
    geometry.blocks.every(
      (block) =>
        block.left >= geometry.viewport.left - 1 && block.right <= geometry.viewport.right + 1,
    ),
  ).toBe(true);
});

test('keeps the overflow rail inside the viewport after scrolling', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(DiffMapPreview, {
    props: { document: hugeDiffMapFixture.document, onOpen: () => {} },
  });
  await component.evaluate((root) => {
    (root as HTMLElement).style.width = '280px';
    const frame = root.querySelector<HTMLElement>('.preview-frame');
    if (frame) frame.style.height = '500px';
  });
  await nextResizeFrame(page);

  const viewport = component.locator('.viewport');
  const rail = component.getByRole('scrollbar');
  await expect(rail).toBeVisible();
  const initialRail = await rail.boundingBox();
  await viewport.evaluate((element) => {
    element.scrollTop = 1000;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await nextResizeFrame(page);

  const viewportBounds = await viewport.boundingBox();
  const railBounds = await rail.boundingBox();
  expect(viewportBounds).not.toBeNull();
  expect(initialRail).not.toBeNull();
  expect(railBounds).not.toBeNull();
  expect(railBounds!.y).toBeCloseTo(initialRail!.y, 0);
  expect(railBounds!.y).toBeGreaterThanOrEqual(viewportBounds!.y);
  expect(railBounds!.y + railBounds!.height).toBeLessThanOrEqual(
    viewportBounds!.y + viewportBounds!.height,
  );
});
