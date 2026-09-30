import { expect, test } from '@playwright/test';
import type { ServerResponse } from 'node:http';
import { createSidebarShellServer } from './sidebar-shell-server';
import { prepareSidebarShell } from './sidebar-shell-import';

const fixture = '/test/fixtures/SidebarShellBackgroundHost.svelte';

test('recovers an actual in-flight fixture import across document replacement', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  let interrupted: ServerResponse | undefined;
  let notifyRequest!: () => void;
  const requested = new Promise<void>((resolve) => {
    notifyRequest = resolve;
  });
  let fixtureRequests = 0;
  const server = await createSidebarShellServer(info.workerIndex, 'sidebar-import-controls', [
    {
      name: 'hold-first-fixture-request',
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] === fixture && ++fixtureRequests === 1) {
            interrupted = res;
            notifyRequest();
            return;
          }
          next();
        });
      },
    },
  ]);
  let preparation: Promise<unknown> | undefined;
  try {
    await server.listen();
    const base = server.resolvedUrls!.local[0];
    // No Page method replacement or synthetic module: the production helper
    // evaluates the real Svelte fixture over HTTP through the real Vite server.
    preparation = prepareSidebarShell(page, base).then(
      () => null,
      (error) => error,
    );
    await requested;
    const aborted = page.waitForEvent('requestfailed', (request) =>
      request.url().includes(fixture),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const failedRequest = await aborted;
    interrupted?.destroy();
    expect(await preparation).toBeNull();
    expect(failedRequest.failure()?.errorText).toBeTruthy();
    expect(fixtureRequests).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => Reflect.get(globalThis, 'process').env.NODE_ENV)).toBe('test');
    expect(
      await page.evaluate(
        async () =>
          typeof (await import('/test/fixtures/SidebarShellBackgroundHost.svelte')).default,
      ),
    ).toBe('function');
    await info.attach('import-replacement', {
      body: JSON.stringify({
        fixtureRequests,
        failure: failedRequest.failure(),
        url: failedRequest.url(),
      }),
      contentType: 'application/json',
    });
  } finally {
    interrupted?.destroy();
    await page.close();
    await preparation;
    await server.close();
  }
});

test('permanent HTTP fixture failure remains an import failure and never mounts', async ({
  page,
}, info) => {
  let requests = 0;
  const server = await createSidebarShellServer(info.workerIndex, 'sidebar-import-failure', [
    {
      name: 'permanent-fixture-failure',
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] !== fixture) return next();
          requests += 1;
          res.statusCode = 503;
          res.end('CONTROLLED_FIXTURE_UNAVAILABLE');
        });
      },
    },
  ]);
  try {
    await server.listen();
    const failure = await prepareSidebarShell(page, server.resolvedUrls!.local[0]).then(
      () => null,
      (error) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain('Failed to fetch dynamically imported module');
    // Browser module failures are cached; retrying evaluate must not manufacture success.
    expect(requests).toBe(1);
    await expect(page.locator('.sidebar-panel')).toHaveCount(0);
  } finally {
    await page.close();
    await server.close();
  }
});
