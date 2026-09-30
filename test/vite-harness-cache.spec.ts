import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

// Deliberately different dependency graphs exercise Vite's real cache publication.
// This is a mechanism control, not a reconstruction of the historical fetch failure.
for (const isolated of [false, true]) {
  test(
    isolated
      ? 'worker-owned caches preserve a live optimized module'
      : 'control: a shared cache invalidates another live optimizer graph',
    async ({ browser }, info) => {
      test.setTimeout(60_000);
      const root = await mkdtemp(join(tmpdir(), 'vite-cache-control-'));
      const servers: ViteDevServer[] = [];
      const context = await browser.newContext();
      try {
        await writeFile(
          join(root, 'index.html'),
          '<!doctype html><title>Optimizer control</title>',
        );
        await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
        for (const name of ['alpha', 'beta']) {
          const dir = join(root, 'node_modules', name);
          await mkdir(dir, { recursive: true });
          await writeFile(
            join(dir, 'package.json'),
            JSON.stringify({ name, version: '1.0.0', main: 'index.cjs' }),
          );
          await writeFile(join(dir, 'index.cjs'), `module.exports = { value: '${name}' };`);
          await writeFile(
            join(root, `${name}.js`),
            `import dep from '${name}'; export const value = dep.value;`,
          );
        }
        const urls: string[] = [];
        const caches: string[] = [];
        for (const [workerIndex, name] of ['alpha', 'beta'].entries()) {
          const cacheDir = viteHarnessCacheDir('control', {
            root,
            workerIndex: isolated ? workerIndex : undefined,
          });
          caches.push(cacheDir);
          const server = await createServer({
            configFile: false,
            root,
            cacheDir,
            optimizeDeps: { entries: [], include: [name] },
            server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/*'] } },
          });
          servers.push(server);
          await server.listen();
          const page = await context.newPage();
          const base = server.resolvedUrls!.local[0];
          const optimized = page.waitForResponse((response) =>
            new URL(response.url()).pathname.endsWith(`/deps/${name}.js`),
          );
          await page.goto(base);
          expect(
            await page.evaluate(async (name) => (await import(`/${name}.js`)).value, name),
          ).toBe(name);
          const response = await optimized;
          expect(response.status()).toBe(200);
          urls.push(response.url());
        }
        // A fresh HTTP request cannot be satisfied by Chromium's module cache.
        const oldModule = await context.request.get(urls[0]);
        if (isolated) {
          expect(caches[0]).not.toBe(caches[1]);
          expect(oldModule.status()).toBe(200);
          expect(await oldModule.text()).toContain('alpha');
        } else {
          expect(caches[0]).toBe(caches[1]);
          expect(oldModule.status()).not.toBe(200);
        }
        await info.attach('optimizer-publication', {
          body: JSON.stringify({ isolated, caches, urls, firstModuleStatus: oldModule.status() }),
          contentType: 'application/json',
        });
      } finally {
        await context.close();
        const closed = await Promise.allSettled(servers.map((server) => server.close()));
        await rm(root, { recursive: true, force: true });
        for (const result of closed) if (result.status === 'rejected') throw result.reason;
      }
    },
  );
}
