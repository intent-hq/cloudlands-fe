import { expect, test, type Page } from '@playwright/test';
import { prepareSidebarShell } from './sidebar-shell-import';

test('sets up each document before importing the sidebar fixture after controlled replacement', async ({
  page,
}, testInfo) => {
  const baseUrl = 'http://sidebar-import.test/';
  const documentEnvironments: unknown[] = [];
  let replacements = 0;
  let evaluations = 0;
  let fixtureRequests = 0;
  await page.route(`${baseUrl}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/src/app.html') {
      await route.fulfill({
        contentType: 'text/html',
        body: `<script>
          globalThis.__environmentAtDocumentStart = globalThis.process?.env?.NODE_ENV ?? null;
        </script>`,
      });
    } else if (path === '/test/fixtures/SidebarShellBackgroundHost.svelte') {
      fixtureRequests += 1;
      await route.fulfill({
        contentType: 'text/javascript',
        body: `
          if (globalThis.process?.env?.NODE_ENV !== 'test') throw new Error('FIXTURE_SETUP_MISSING');
          globalThis.__sidebarFixtureImported = true;
          export {};
        `,
      });
    } else {
      await route.abort();
    }
  });

  const evaluate = page.evaluate.bind(page);
  // Delegate to the real Page; replace its document just before the first import operation.
  // This is a controlled navigation, not a reproduction of a natural optimizer reload.
  page.evaluate = (async (fn, arg) => {
    evaluations += 1;
    if (evaluations === 2) {
      documentEnvironments.push(
        await evaluate(() => Reflect.get(globalThis, '__environmentAtDocumentStart')),
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      replacements += 1;
      documentEnvironments.push(
        await evaluate(() => Reflect.get(globalThis, '__environmentAtDocumentStart')),
      );
    }
    return evaluate(fn, arg);
  }) as Page['evaluate'];

  let failure: unknown;
  const failures: unknown[] = [];
  try {
    await prepareSidebarShell(page, baseUrl).catch((error: unknown) => {
      failure = error;
    });
    expect(replacements).toBe(1);
    expect(documentEnvironments).toEqual(['test', 'test']);
    expect(failure).toBeUndefined();
    expect(fixtureRequests).toBe(1);
    expect(await evaluate(() => Reflect.get(globalThis, '__sidebarFixtureImported'))).toBe(true);
  } catch (error) {
    failures.push(error);
    if (failure !== undefined && failure !== error) failures.push(failure);
  } finally {
    page.evaluate = evaluate;
    try {
      await testInfo.attach('controlled-document-replacement', {
        body: JSON.stringify({
          replacements,
          documentEnvironments,
          fixtureRequests,
          failure: String(failure),
        }),
        contentType: 'application/json',
      });
    } catch (error) {
      failures.push(new Error('Attaching document replacement evidence failed', { cause: error }));
    }
    try {
      await page.unrouteAll({ behavior: 'wait' });
    } catch (error) {
      failures.push(new Error('Removing document replacement routes failed', { cause: error }));
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Document replacement control and finalization failed', {
      cause: failures[0],
    });
  }
});
