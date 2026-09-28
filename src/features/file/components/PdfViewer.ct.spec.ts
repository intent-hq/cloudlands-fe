import { test, expect } from '../../../test/ct-test';
import PdfViewer from './PdfViewer.svelte';
import { createPdfFixture } from '../__tests__/pdf-fixture';

const bytes = createPdfFixture();
const chunk = {
  content: Buffer.from(bytes).toString('base64'),
  bytesRead: bytes.length,
  size: bytes.length,
};

test('renders real binary PDF pages, navigates, zooms, and releases the view', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(PdfViewer, {
    props: { workspaceId: 'ws-pdf', filePath: 'docs/report.pdf' },
    hooksConfig: { mockBackend: { 'file.readChunk': chunk } },
  });
  const canvas = page.getByRole('img', { name: 'docs/report.pdf, page 1' });
  await expect(canvas).toBeVisible();
  const pixel = () =>
    page
      .locator('canvas')
      .evaluate((node: HTMLCanvasElement) =>
        Array.from(node.getContext('2d')!.getImageData(5, 5, 1, 1).data),
      );
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  // Text must also be painted: count dark pixels inside the expected text region.
  expect(
    await canvas.evaluate((node: HTMLCanvasElement) => {
      const pixels = node.getContext('2d')!.getImageData(0, 0, node.width, node.height).data;
      let dark = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 50 && pixels[i + 1] < 50 && pixels[i + 2] < 50) dark++;
      }
      return dark;
    }),
  ).toBeGreaterThan(100);
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  const width = await page.locator('canvas').evaluate((node) => node.getBoundingClientRect().width);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect
    .poll(() => page.locator('canvas').evaluate((node) => node.getBoundingClientRect().width))
    .toBeGreaterThan(width);
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.screenshot({ path: testInfo.outputPath('inline-pdf.png') });
  await component.unmount();
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('reports malformed PDF data and allows retry', async ({ mount, page }) => {
  await mount(PdfViewer, {
    props: { workspaceId: 'ws-pdf', filePath: 'broken.pdf' },
    hooksConfig: {
      mockBackend: { 'file.readChunk': { content: 'bm90IGEgcGRm', bytesRead: 9, size: 9 } },
    },
  });
  await expect(page.getByRole('alert')).toContainText('damaged or unsupported');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('alert')).toContainText('damaged or unsupported');
});
