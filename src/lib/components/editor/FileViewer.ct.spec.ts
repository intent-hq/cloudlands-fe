import { test, expect } from '../../../test/ct-test';
import FileViewer from './FileViewer.svelte';

test('pans zoomed and rotated images with native capture, releases outside, and keeps wheel scrolling', async ({
  mount,
  page,
}, testInfo) => {
  const sourceUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#164e63';
    context.fillRect(0, 0, 640, 400);
    context.fillStyle = '#fbbf24';
    context.fillRect(80, 60, 220, 180);
    return canvas.toDataURL();
  });
  const component = await mount(FileViewer, { props: { filePath: 'pan-test.png', sourceUrl } });
  await component.evaluate((node) => {
    node.style.width = '640px';
    node.style.height = '440px';
    node.style.margin = '80px';
  });
  const image = page.getByRole('img', { name: 'pan-test.png' });
  const viewport = image.locator('..');
  await expect(image).toBeVisible();
  await expect(viewport).toHaveCSS('cursor', 'grab');
  const before = (await image.boundingBox())!;
  await image.hover();
  await page.mouse.down();
  await expect(viewport).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(before.x + before.width / 2 + 50, before.y + before.height / 2 + 30);
  await expect
    .poll(async () => {
      const box = (await image.boundingBox())!;
      return [Math.round(box.x - before.x), Math.round(box.y - before.y)];
    })
    .toEqual([50, 30]);
  await page.mouse.up();

  // Start on exposed checkerboard, then leave the viewport while still holding the button.
  const bounds = (await viewport.boundingBox())!;
  await page.mouse.move(bounds.x + 8, bounds.y + 8);
  await page.mouse.down();
  await expect.poll(() => viewport.evaluate((node) => node.hasPointerCapture(1))).toBe(true);
  await page.mouse.move(bounds.x - 35, bounds.y - 25);
  await page.mouse.up();
  await expect(viewport).toHaveCSS('cursor', 'grab');
  await expect.poll(() => viewport.evaluate((node) => node.hasPointerCapture(1))).toBe(false);
  const released = await image.boundingBox();
  await page.mouse.move(bounds.x + 100, bounds.y + 100);
  expect(await image.boundingBox()).toEqual(released);
  await page.screenshot({ path: testInfo.outputPath('released-outside-viewport.png') });

  await page.getByTitle('Zoom in').click();
  await page.getByTitle('Zoom in').click();
  await page.getByTitle('Rotate').click();
  await expect(image).toHaveCSS('transform', 'matrix(0, 1.5, -1.5, 0, 0, 0)');
  const zoomed = (await image.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 40);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const box = (await image.boundingBox())!;
      return [Math.round(box.x - zoomed.x), Math.round(box.y - zoomed.y)];
    })
    .toEqual([60, 40]);
  await page.screenshot({ path: testInfo.outputPath('zoomed-rotated-pan.png') });

  const scrollBefore = await viewport.evaluate((node) => node.scrollTop);
  await viewport.hover();
  await page.mouse.wheel(0, 100);
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(scrollBefore);
  await expect(page.getByText('150%', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTitle('Download').click();
  expect((await download).suggestedFilename()).toBe('pan-test.png');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTitle('Copy image').click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        return items.flatMap((item) => item.types);
      }),
    )
    .toContain('image/png');
});

test('zooms and pans SVG images and checkerboard with native capture and resets when switching viewer types', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(FileViewer, {
    props: {
      filePath: 'drawing.svg',
      fileContent:
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="teal"/><circle cx="160" cy="100" r="60" fill="gold"/></svg>',
    },
  });
  await component.evaluate((node) => {
    node.style.width = '640px';
    node.style.height = '440px';
    node.style.margin = '80px';
  });
  const image = page.getByRole('img', { name: 'drawing.svg' });
  const viewport = image.locator('..');
  await expect(viewport).toHaveCSS('cursor', 'grab');
  const original = (await image.boundingBox())!;
  await page.getByTitle('Zoom in').click();
  await page.getByTitle('Zoom in').click();
  await expect(page.getByText('150%', { exact: true })).toBeVisible();
  await expect(image).toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)');
  const before = (await image.boundingBox())!;
  expect(before.width).toBeCloseTo(original.width * 1.5);
  await image.hover();
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 40, before.y + before.height / 2 + 25);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const box = (await image.boundingBox())!;
      return [Math.round(box.x - before.x), Math.round(box.y - before.y)];
    })
    .toEqual([40, 25]);
  await page.screenshot({ path: testInfo.outputPath('svg-zoomed-panned.png') });
  const bounds = (await viewport.boundingBox())!;
  await page.mouse.move(bounds.x + 8, bounds.y + 8);
  await page.mouse.down();
  await expect.poll(() => viewport.evaluate((node) => node.hasPointerCapture(1))).toBe(true);
  await page.mouse.move(bounds.x - 25, bounds.y - 25);
  await page.mouse.up();
  await expect(viewport).toHaveCSS('cursor', 'grab');
  const released = await image.boundingBox();
  await page.mouse.move(bounds.x + 100, bounds.y + 100);
  expect(await image.boundingBox()).toEqual(released);
  await component.update({
    props: { filePath: 'next.png', sourceUrl: (await image.getAttribute('src'))! },
  });
  await expect(page.getByRole('img', { name: 'next.png' })).toHaveCSS(
    'translate',
    /^0px(?: 0px)?$/,
  );
});

for (const format of ['png', 'svg'] as const) {
  test(`pans ${format} after scrolling to the bottom-right edge`, async ({
    mount,
    page,
  }, testInfo) => {
    const sourceUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 400;
      return canvas.toDataURL();
    });
    const component = await mount(FileViewer, {
      props: {
        filePath: `scroll-pan.${format}`,
        ...(format === 'png'
          ? { sourceUrl }
          : {
              fileContent:
                '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="teal"/></svg>',
            }),
      },
    });
    await component.evaluate((node) => {
      node.style.width = '640px';
      node.style.height = '440px';
      node.style.margin = '80px';
    });
    const image = page.getByRole('img', { name: `scroll-pan.${format}` });
    const viewport = image.locator('..');
    for (let step = 0; step < 8; step++) await page.getByTitle('Zoom in').click();
    await expect(image).toHaveCSS('transform', 'matrix(3, 0, 0, 3, 0, 0)');
    await viewport.hover();
    await page.mouse.wheel(2000, 2000);
    await expect
      .poll(() =>
        viewport.evaluate((node) => [
          node.scrollLeft > 0 && node.scrollLeft === node.scrollWidth - node.clientWidth,
          node.scrollTop > 0 && node.scrollTop === node.scrollHeight - node.clientHeight,
        ]),
      )
      .toEqual([true, true]);
    const before = (await image.boundingBox())!;
    const bounds = (await viewport.boundingBox())!;
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    expect(await image.boundingBox()).toEqual(before);
    await page.mouse.move(start.x - 60, start.y - 60, { steps: 3 });
    await expect
      .poll(async () => {
        const box = (await image.boundingBox())!;
        return [Math.round(box.x - before.x), Math.round(box.y - before.y)];
      })
      .toEqual([-60, -60]);
    await page.mouse.move(start.x + 30, start.y + 20, { steps: 3 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const box = (await image.boundingBox())!;
        return [Math.round(box.x - before.x), Math.round(box.y - before.y)];
      })
      .toEqual([30, 20]);
    await expect(viewport).toHaveCSS('cursor', 'grab');
    await page.screenshot({ path: testInfo.outputPath(`${format}-scroll-then-pan.png`) });
    const released = (await image.boundingBox())!;
    await page.mouse.wheel(-100, -100);
    await expect
      .poll(async () => {
        const box = (await image.boundingBox())!;
        return [Math.round(box.x - released.x), Math.round(box.y - released.y)];
      })
      .toEqual([100, 100]);
  });
}
