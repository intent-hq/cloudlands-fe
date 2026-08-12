import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';

const artifactDir = path.resolve('test-results/manual-catalog-review');
const slugs = [
  'badge',
  'breadcrumb',
  'button',
  'button-group',
  'card',
  'checkbox',
  'combobox',
  'dialog',
  'file-input',
  'input',
  'label',
  'list',
  'menu',
  'proposal-card',
  'scroll-area',
  'select',
  'separator',
  'settings-field-row',
  'settings-page-shell',
  'settings-section',
  'sheet',
  'sidebar',
  'skeleton',
  'slider',
  'spinner',
  'switch',
  'textarea',
  'toggle',
  'toggle-group',
  'tooltip',
] as const;

let server: ViteDevServer;
let baseUrl: string;

async function screenshotDetail(
  page: Page,
  outputPath: string,
  viewport: { width: number; height: number },
) {
  const detail = page.locator('.catalog-detail');
  await page.addStyleTag({
    content: `html { scroll-behavior: auto !important; } body { padding-bottom: ${viewport.height}px !important; } .catalog-topbar { position: static !important; }`,
  });
  const box = await detail.boundingBox();
  if (!box) throw new Error('Catalog detail has no bounding box');
  const documentTop = box.y + (await page.evaluate(() => window.scrollY));
  const segmentHeight = viewport.height;
  const segments: Buffer[] = [];
  for (let offset = 0; offset < box.height; offset += segmentHeight) {
    await page.evaluate(
      (top) => window.scrollTo({ top, behavior: 'instant' }),
      documentTop + offset,
    );
    await page.waitForTimeout(100);
    const screenshot = await page.screenshot();
    const height = Math.min(segmentHeight, Math.ceil(box.height - offset));
    const sharp = (await import('sharp')).default;
    segments.push(
      await sharp(screenshot)
        .extract({ left: Math.round(box.x), top: 0, width: Math.round(box.width), height })
        .toBuffer(),
    );
  }
  const sharp = (await import('sharp')).default;
  await sharp({
    create: {
      width: Math.round(box.width),
      height: Math.ceil(box.height),
      channels: 4,
      background: 'transparent',
    },
  })
    .composite(segments.map((input, index) => ({ input, left: 0, top: index * segmentHeight })))
    .png()
    .toFile(outputPath);
}

test.beforeAll(async () => {
  mkdirSync(artifactDir, { recursive: true });
  server = await createServer({
    server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
});

test.afterAll(async () => server?.close());

test('capture every catalog entry for manual review', async ({ browser }) => {
  test.setTimeout(900_000);
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'compact', width: 390, height: 844 },
  ] as const) {
    for (const theme of ['light', 'dark'] as const) {
      for (const slug of slugs) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await page.goto(`${baseUrl}sandbox/${slug}`, { waitUntil: 'domcontentloaded' });
        const themeControl = page.getByRole('radio', {
          name: theme === 'dark' ? 'Dark' : 'Light',
          exact: true,
        });
        if ((await themeControl.getAttribute('aria-checked')) !== 'true')
          await themeControl.click();
        if (slug === 'menu') {
          await page.getByRole('button', { name: 'Open catalog menu' }).click();
          await page.getByRole('menuitem', { name: 'More actions' }).hover();
        } else if (slug === 'dialog') {
          await page.getByRole('button', { name: 'Open catalog dialog' }).click();
        } else if (slug === 'sheet') {
          await page.getByRole('button', { name: 'Open catalog sheet' }).click();
        } else if (slug === 'sidebar') {
          await page.locator('[data-sidebar="trigger"]').click({ force: true });
        }
        await expect(page.locator(`[data-catalog-preview="${slug}"]`).first()).toBeVisible();
        if (slug === 'tooltip') {
          await expect(page.getByRole('tooltip')).toBeVisible();
          await page.waitForTimeout(200);
        }
        const outputPath = path.join(artifactDir, `${slug}--${viewport.name}-${theme}.png`);
        if (slug === 'menu' || slug === 'dialog' || slug === 'sheet' || slug === 'tooltip') {
          await page.screenshot({ path: outputPath });
        } else {
          await screenshotDetail(page, outputPath, viewport);
        }
        await context.close();
      }
    }
  }
});
