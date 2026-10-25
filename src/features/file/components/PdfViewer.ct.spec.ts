import { test, expect } from '../../../test/ct-test';
import PdfViewer from '../__tests__/PdfViewerHarness.svelte';
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
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('img', { name: 'docs/report.pdf, page 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
  const width = await page.locator('canvas').evaluate((node) => node.getBoundingClientRect().width);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect
    .poll(() => page.locator('canvas').evaluate((node) => node.getBoundingClientRect().width))
    .toBeGreaterThan(width);
  await expect(page.getByRole('img', { name: 'docs/report.pdf, page 2' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('inline-pdf.png') });
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('img', { name: 'docs/report.pdf, page 2' })).toBeVisible();
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
