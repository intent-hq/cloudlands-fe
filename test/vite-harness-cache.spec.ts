import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
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
        for (const name of ['alpha', 'anchor', 'beta']) {
          const dir = join(root, 'node_modules', name);
          await mkdir(dir, { recursive: true });
          await writeFile(
            join(dir, 'package.json'),
            JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'index.js' }),
          );
          await writeFile(join(dir, 'index.js'), `export const value = '${name}';`);
          await writeFile(join(root, `${name}.js`), `export { value } from '${name}';`);
        }
        const urls: string[] = [];
        const caches: string[] = [];
        let lazyFile = '';
        let lazyUrl = '';
        let firstBase = '';
        let lazyBefore: { ino: number; dev: number; sha256: string } | undefined;
        for (const [workerIndex, name] of ['anchor', 'beta'].entries()) {
          const cacheDir = viteHarnessCacheDir('control', {
            root,
            workerIndex: isolated ? workerIndex : undefined,
          });
          caches.push(cacheDir);
          const server = await createServer({
            configFile: false,
            root,
            cacheDir,
            optimizeDeps: {
              entries: [],
              include: workerIndex === 0 ? ['alpha', 'anchor'] : ['beta'],
            },
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
          const imported = page
            .evaluate(async (name) => (await import(`/${name}.js`)).value, name)
            .then(
              (value) => ({ value, error: null }),
              (error) => ({ value: null, error: String(error) }),
            );
          const response = await optimized;
          const source = await response.text();
          expect(source.length).toBeLessThan(65_536);
          await info.attach(`optimized-${name}`, {
            body: JSON.stringify({ url: response.url(), status: response.status(), source }),
            contentType: 'application/json',
          });
          expect(response.status()).toBe(200);
          expect(await imported).toEqual({ value: name, error: null });
          urls.push(response.url());
          if (workerIndex === 0) {
            firstBase = base;
            // Alpha is optimized but deliberately never fetched by this server/browser.
            // A previously served dep can survive on Vite's in-memory transform cache.
            const metadata = JSON.parse(
              await readFile(join(cacheDir, 'deps/_metadata.json'), 'utf8'),
            );
            lazyFile = resolve(cacheDir, 'deps', metadata.optimized.alpha.file);
            expect(lazyFile.startsWith(resolve(cacheDir) + '/')).toBe(true);
            const file = await stat(lazyFile);
            lazyBefore = {
              ino: file.ino,
              dev: file.dev,
              sha256: createHash('sha256')
                .update(await readFile(lazyFile))
                .digest('hex'),
            };
            lazyUrl = new URL(relative(root, lazyFile) + '?v=' + metadata.browserHash, base).href;
          }
        }
        const lazyAfter = await stat(lazyFile).then(
          (file) => ({ ino: file.ino, dev: file.dev }),
          (error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          },
        );
        const oldModule = await context.request.get(lazyUrl);
        const freshPage = await context.newPage();
        await freshPage.goto(firstBase);
        const lateImport = await freshPage
          .evaluate(async (url) => (await import(url)).value, '/alpha.js')
          .then(
            (value) => ({ value, error: null }),
            (error) => ({ value: null, error: String(error) }),
          );
        await info.attach('optimizer-publication', {
          body: JSON.stringify({
            isolated,
            caches,
            urls,
            lazyUrl,
            lazyBefore,
            lazyAfter,
            firstModuleStatus: oldModule.status(),
            lateImport,
          }),
          contentType: 'application/json',
        });
        if (isolated) {
          expect(caches[0]).not.toBe(caches[1]);
          expect(lazyAfter).toEqual({ ino: lazyBefore!.ino, dev: lazyBefore!.dev });
          expect(
            createHash('sha256')
              .update(await readFile(lazyFile))
              .digest('hex'),
          ).toBe(lazyBefore!.sha256);
          expect(oldModule.status()).toBe(200);
          expect(lateImport).toEqual({ value: 'alpha', error: null });
        } else {
          expect(caches[0]).toBe(caches[1]);
          expect(lazyAfter).toBeNull();
          expect(oldModule.status()).not.toBe(200);
          expect(lateImport.value).toBeNull();
          expect(lateImport.error).toContain('Failed to fetch dynamically imported module');
        }
      } finally {
        await context.close();
        const closed = await Promise.allSettled(servers.map((server) => server.close()));
        await rm(root, { recursive: true, force: true });
        for (const result of closed) if (result.status === 'rejected') throw result.reason;
      }
    },
  );
}
