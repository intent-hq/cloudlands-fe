import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';
import { readDiagramPaint } from './diagram-painted-bounds';
import { expectDrawingReachable } from './diagram-scroll-reachability';

const externalBaseUrl = process.env.UI_PREVIEW_BASE_URL;
let baseUrl = externalBaseUrl ?? '';
let server: ViteDevServer | undefined;

test.describe.configure({ mode: 'default', timeout: 120_000 });

test.beforeAll(async () => {
  if (externalBaseUrl) return;
  const ownedServer = await createServer({
    cacheDir: viteHarnessCacheDir('diagram-shared-scene'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  server = ownedServer;
  try {
    await ownedServer.listen();
    baseUrl = ownedServer.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? '';
    expect(baseUrl).not.toBe('');
  } catch (error) {
    await ownedServer.close().catch(() => undefined);
    server = undefined;
    throw error;
  }
});

test.afterAll(async () => {
  const ownedServer = server;
  server = undefined;
  await ownedServer?.close();
});

test('Architecture navigation preserves authored scene membership and reachable content', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=light&width=960&motion=reduced`,
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
    timeout: 90_000,
  });
  const root = page.locator('#custom-architecture .diagram-renderer');
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  await expectDrawingReachable(root);
  await root.locator('[data-diagram-step-index="1"]').click();
  await expect(root).toHaveAttribute('data-diagram-state', 'connect');
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  expect(
    await root
      .locator('[data-node-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id')).sort()),
  ).toEqual(['daemon', 'notes', 'renderer', 'user']);
  expect(
    await root
      .locator('.diagram-edge')
      .evaluateAll((edges) => edges.map((edge) => edge.getAttribute('data-edge-id')).sort()),
  ).toEqual(['a1', 'a2', 'a3']);
  for (const id of ['user', 'renderer']) {
    await expect(root.locator(`[data-node-id="${id}"]`)).toBeVisible();
  }
  await expect(root.locator('.diagram-edge[data-edge-id="a1"] path.edge-path')).toBeVisible();
  const paint = await root.evaluate(readDiagramPaint);
  expect(paint.finite).toBe(true);
  expect(paint.overflow).toBeLessThanOrEqual(1);
  await expectDrawingReachable(root);
  await root.screenshot({ path: testInfo.outputPath('connect.png') });
  await root.locator('[data-diagram-step-index="0"]').click();
  await expect(root).toHaveAttribute('data-diagram-state', 'orient');
  await expect(root).toHaveAttribute('data-diagram-settled', 'true');
  await expectDrawingReachable(root);
});
