import { expect, test } from '../../../../test/ct-test';
import type { Locator, Page } from '@playwright/experimental-ct-svelte';
import ChatImageBlock from '../ChatImageBlock.svelte';

// A §5.5 slim thumbnail (256×144) standing in for a 640×360 original whose
// intrinsic dimensions ride the §7.1 image dimension sidecar.
const ORIGINAL = { width: 640, height: 360 };
const THUMBNAIL = { width: 256, height: 144 };

async function thumbnailData(page: Page): Promise<string> {
  return page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#2772df';
    context.fillRect(0, 0, width, height);
    return canvas.toDataURL().split(',')[1];
  }, THUMBNAIL);
}

type Box = { x: number; y: number; width: number; height: number };

function expectSameBox(actual: Box, frame: Box) {
  expect(Math.abs(actual.x - frame.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.y - frame.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.width - frame.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.height - frame.height)).toBeLessThanOrEqual(1);
}

// The image fills the button's content box: the frame minus the tile border.
async function expectImageFillsFrame(image: Locator, button: Locator, frame: Box) {
  const border = await button.evaluate(
    (node) => parseFloat(getComputedStyle(node).borderTopWidth) || 0,
  );
  expectSameBox((await image.boundingBox())!, {
    x: frame.x + border,
    y: frame.y + border,
    width: frame.width - border * 2,
    height: frame.height - border * 2,
  });
}

test('a sized slim thumbnail fills its reserved 640×360 frame in a wide container', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const data = await thumbnailData(page);
  const component = await mount(ChatImageBlock, {
    props: { data, mimeType: 'image/png', dataIsThumbnail: true, ...ORIGINAL },
  });
  const frame = component.locator('[data-image-sized]');
  const button = component.getByRole('button', { name: /view .* full size/i });
  const image = component.getByRole('img');

  await expect(frame).toBeVisible();
  const frameBefore = (await frame.boundingBox())!;
  expect(frameBefore.width).toBe(ORIGINAL.width);
  expect(frameBefore.height).toBe(ORIGINAL.height);

  await image.evaluate((node: HTMLImageElement) => node.decode());
  await expect(frame).toHaveAttribute('data-loaded', 'true');
  await page.evaluate(() => document.fonts.ready);

  const frameAfter = (await frame.boundingBox())!;
  expect(frameAfter).toEqual(frameBefore);
  expectSameBox((await button.boundingBox())!, frameAfter);
  await expectImageFillsFrame(image, button, frameAfter);
  expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(THUMBNAIL.width);
});

test('a sized slim thumbnail scales with a narrow container and keeps its aspect', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 500 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const data = await thumbnailData(page);
  const component = await mount(ChatImageBlock, {
    props: { data, mimeType: 'image/png', dataIsThumbnail: true, ...ORIGINAL },
  });
  const frame = component.locator('[data-image-sized]');
  const button = component.getByRole('button', { name: /view .* full size/i });
  const image = component.getByRole('img');

  await expect(frame).toBeVisible();
  const frameBefore = (await frame.boundingBox())!;
  expect(frameBefore.width).toBeLessThan(ORIGINAL.width);
  expect(frameBefore.width).toBeGreaterThan(THUMBNAIL.width);
  expect(
    Math.abs(frameBefore.height - (frameBefore.width * ORIGINAL.height) / ORIGINAL.width),
  ).toBeLessThanOrEqual(1);

  await image.evaluate((node: HTMLImageElement) => node.decode());
  await expect(frame).toHaveAttribute('data-loaded', 'true');

  const frameAfter = (await frame.boundingBox())!;
  expect(frameAfter).toEqual(frameBefore);
  expectSameBox((await button.boundingBox())!, frameAfter);
  await expectImageFillsFrame(image, button, frameAfter);
});

test('the frame geometry survives a thumbnail → original hydration swap', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const thumbnail = await thumbnailData(page);
  const original = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#df7227';
    context.fillRect(0, 0, width, height);
    return canvas.toDataURL().split(',')[1];
  }, ORIGINAL);
  const component = await mount(ChatImageBlock, {
    props: {
      data: thumbnail,
      mimeType: 'image/png',
      dataTruncated: true,
      dataIsThumbnail: true,
      onHydrate: () => {},
      ...ORIGINAL,
    },
  });
  const frame = component.locator('[data-image-sized]');
  const image = component.getByRole('img');
  await image.evaluate((node: HTMLImageElement) => node.decode());
  await expect(frame).toHaveAttribute('data-loaded', 'true');
  const before = (await frame.boundingBox())!;

  await component.update({
    props: {
      data: original,
      mimeType: 'image/png',
      dataTruncated: false,
      dataIsThumbnail: false,
      onHydrate: undefined,
      ...ORIGINAL,
    },
  });
  await expect(image).toHaveAttribute('src', `data:image/png;base64,${original}`);
  await image.evaluate((node: HTMLImageElement) => node.decode());

  expect(await frame.boundingBox()).toEqual(before);
  const button = component.getByRole('button', { name: /view .* full size/i });
  expectSameBox((await button.boundingBox())!, before);
  await expectImageFillsFrame(image, button, before);
  expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(ORIGINAL.width);
});

test('an image block without dimensions keeps the legacy square tile', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const data = await thumbnailData(page);
  const component = await mount(ChatImageBlock, { props: { data, mimeType: 'image/png' } });
  const button = component.getByRole('button', { name: /view .* full size/i });
  const image = component.getByRole('img');
  await image.evaluate((node: HTMLImageElement) => node.decode());

  await expect(component.locator('[data-image-sized]')).toHaveCount(0);
  const buttonBox = (await button.boundingBox())!;
  expect(buttonBox.width).toBeGreaterThanOrEqual(24);
  expect(buttonBox.height).toBe(buttonBox.width);
  const imageBox = (await image.boundingBox())!;
  expect(imageBox.x).toBeGreaterThanOrEqual(buttonBox.x);
  expect(imageBox.y).toBeGreaterThanOrEqual(buttonBox.y);
  expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(buttonBox.x + buttonBox.width);
  expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(buttonBox.y + buttonBox.height);
});
