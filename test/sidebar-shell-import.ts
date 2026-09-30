import type { Page } from '@playwright/test';

export async function prepareSidebarShell(page: Page, baseUrl: string) {
  // Install before navigation so replacement documents get setup before module evaluation.
  await page.addInitScript(() => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
  });
  await page.goto(`${baseUrl}src/app.html`);
  let documentOrigin = await page.evaluate(() => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    return performance.timeOrigin;
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(async () => {
        await import('/test/fixtures/SidebarShellBackgroundHost.svelte');
      });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      try {
        if (error instanceof Error && error.message.includes('Execution context was destroyed')) {
          // waitForLoadState can still resolve against the departing document.
          // Poll across navigation until a DIFFERENT document has run our init script.
          const replacement = await page.waitForFunction(
            (previousOrigin) =>
              performance.timeOrigin !== previousOrigin &&
              document.readyState !== 'loading' &&
              Reflect.get(globalThis, 'process')?.env?.NODE_ENV === 'test' &&
              performance.timeOrigin,
            documentOrigin,
            { timeout: 10_000 },
          );
          try {
            documentOrigin = (await replacement.jsonValue()) as number;
          } finally {
            await replacement.dispose();
          }
        } else {
          await page.waitForLoadState('domcontentloaded');
          documentOrigin = await page.evaluate(() => {
            Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
            return performance.timeOrigin;
          });
        }
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          `Sidebar fixture import failed: ${String(error)}; recovery failed: ${String(recoveryError)}`,
          { cause: error },
        );
      }
    }
  }
}
