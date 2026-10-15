import { test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

export function useDiagramPreviewServer(name: string) {
  const externalUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
  let url = externalUrl ?? '';
  let server: ViteDevServer | undefined;

  test.beforeAll(async () => {
    if (externalUrl) return;
    const ownedServer = await createServer({
      cacheDir: viteHarnessCacheDir(`${name}-${test.info().parallelIndex}`),
      server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
    });
    server = ownedServer;
    try {
      await ownedServer.listen();
      url = ownedServer.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? '';
      if (!url) throw new Error('Diagram preview server did not publish a local URL.');
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

  return {
    get url() {
      return url;
    },
  };
}
