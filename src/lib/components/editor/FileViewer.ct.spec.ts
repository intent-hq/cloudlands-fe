import { test, expect, wheelUntilScrolled } from '../../../test/ct-test';
import FileViewer from './FileViewer.svelte';

test('zooms and rotates images while retaining scrolling, download, and clipboard controls', async ({
  mount,
  page,
}) => {
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
  await page.getByTitle('Zoom in').click();
  await page.getByTitle('Zoom in').click();
  await page.getByTitle('Rotate').click();
  await expect(image).toHaveCSS('transform', 'matrix(0, 1.5, -1.5, 0, 0, 0)');
  await wheelUntilScrolled(viewport, { deltaY: 100 });
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

test('zooms SVG images and switches viewer types', async ({ mount, page }) => {
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
  await page.getByTitle('Zoom in').click();
  await page.getByTitle('Zoom in').click();
  await expect(page.getByText('150%', { exact: true })).toBeVisible();
  await expect(image).toHaveCSS('transform', 'matrix(1.5, 0, 0, 1.5, 0, 0)');
  await component.update({
    props: { filePath: 'next.png', sourceUrl: (await image.getAttribute('src'))! },
  });
  await expect(page.getByRole('img', { name: 'next.png' })).toBeVisible();
});
