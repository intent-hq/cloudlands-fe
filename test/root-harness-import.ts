import type { Page } from '@playwright/test';

/** Load the harness graph before mounting into a document that Vite may replace. */
export async function prepareRootHarnessModules(page: Page, baseUrl: string, modules: string[]) {
  await page.addInitScript(() => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
  });
  await page.goto(`${baseUrl}src/app.html`);
  const originalDocument = await page.evaluate(() => performance.timeOrigin);
  const load = () =>
    page.evaluate(async (paths) => {
      await Promise.all(paths.map((path) => import(path)));
    }, modules);
  try {
    await load();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed')) {
      throw error;
    }
    try {
      // A cold optimizer can replace the document during import. Recover only
      // after a different document has run our initializer, never on a module
      // error or by replaying the assertion-bearing mount.
      const replacement = await page.waitForFunction(
        (previousOrigin) =>
          performance.timeOrigin !== previousOrigin &&
          document.readyState !== 'loading' &&
          Reflect.get(globalThis, 'process')?.env?.NODE_ENV === 'test',
        originalDocument,
        { timeout: 10_000 },
      );
      await replacement.dispose();
    } catch (replacementError) {
      throw new AggregateError(
        [error, replacementError],
        'Root harness import lost its document and replacement initialization failed',
        { cause: error },
      );
    }
    // One observed document replacement is recoverable. A second failure is
    // final, including another navigation or a persistent HTTP/module error.
    await load();
  }
}
