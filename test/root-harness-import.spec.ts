import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { createServer } from 'vite';
import { prepareRootHarnessModules } from './root-harness-import';

const fixture = '/root-harness-fixture.js';

async function controlServer(respond: (response: ServerResponse, request: number) => void) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'root-import-'));
  let requests = 0;
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir,
    optimizeDeps: { entries: [] },
    plugins: [
      {
        name: 'root-import-control',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url?.split('?')[0] !== fixture) return next();
            respond(response, ++requests);
          });
        },
      },
    ],
    server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  return {
    server,
    baseUrl: server.resolvedUrls!.local[0],
    requests: () => requests,
    async close() {
      await server.close();
      await rm(cacheDir, { recursive: true, force: true });
    },
  };
}

for (const unavailableAfterReload of [false, true]) {
  test(`prepares the replacement document while preserving import failure=${unavailableAfterReload}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    let held: ServerResponse | undefined;
    let releaseRequest!: () => void;
    const requested = new Promise<void>((resolve) => (releaseRequest = resolve));
    const control = await controlServer((response, count) => {
      if (count === 1) {
        held = response;
        releaseRequest();
      } else {
        response.statusCode = unavailableAfterReload ? 503 : 200;
        response.setHeader('Content-Type', 'application/javascript');
        response.end(
          unavailableAfterReload
            ? 'UNAVAILABLE_AFTER_RELOAD'
            : 'globalThis.__rootHarnessModuleReady = true; export default 42;',
        );
      }
    });
    let preparation: Promise<unknown> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      preparation = prepareRootHarnessModules(page, control.baseUrl, [fixture]).then(
        () => null,
        (error) => error,
      );
      await Promise.race([
        requested,
        preparation.then((error) => {
          throw error ?? new Error('Preparation ended before the controlled import');
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Controlled import was never requested')),
            20_000,
          );
        }),
      ]);
      clearTimeout(timer);
      const previousOrigin = await page.evaluate(() => performance.timeOrigin);
      const replaced = page.waitForEvent('framenavigated', {
        predicate: (frame) => frame === page.mainFrame(),
        timeout: 10_000,
      });
      control.server.ws.send({ type: 'full-reload' });
      await replaced;
      held?.destroy();
      const result = await preparation;
      if (unavailableAfterReload) {
        expect(result).toBeInstanceOf(Error);
        expect(String(result)).toContain('Failed to fetch dynamically imported module');
      } else {
        expect(result).toBeNull();
      }
      expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(previousOrigin);
      expect(await page.evaluate(() => Reflect.get(globalThis, '__rootHarnessModuleReady'))).toBe(
        true,
      );
      expect(await page.evaluate(() => Reflect.get(globalThis, 'process').env.NODE_ENV)).toBe(
        'test',
      );
      expect(control.requests()).toBe(2);
      await info.attach('document-replacement', {
        body: JSON.stringify({
          previousOrigin,
          replacementOrigin: await page.evaluate(() => performance.timeOrigin),
          requests: control.requests(),
        }),
        contentType: 'application/json',
      });
    } finally {
      clearTimeout(timer);
      held?.destroy();
      await page.close();
      await preparation;
      await control.close();
    }
  });
}

for (const failure of ['http', 'evaluation'] as const) {
  test(`preserves a permanent ${failure} import failure without mounting or another request`, async ({
    page,
  }) => {
    const control = await controlServer((response) => {
      response.statusCode = failure === 'http' ? 503 : 200;
      response.setHeader('Content-Type', 'application/javascript');
      response.end(
        failure === 'http' ? 'UNAVAILABLE' : 'throw new Error("PERMANENT_MODULE_FAILURE");',
      );
    });
    let mounted = false;
    try {
      const error = await prepareRootHarnessModules(page, control.baseUrl, [fixture])
        .then(() => {
          mounted = true;
          return null;
        })
        .catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain(
        failure === 'http'
          ? 'Failed to fetch dynamically imported module'
          : 'PERMANENT_MODULE_FAILURE',
      );
      expect(mounted).toBe(false);
      expect(control.requests()).toBe(1);
    } finally {
      await page.close();
      await control.close();
    }
  });
}
