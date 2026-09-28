import type { Page } from '@playwright/test';

export async function prepareSidebarShell(page: Page, baseUrl: string) {
  // Install before navigation so replacement documents get setup before module evaluation.
  await page.addInitScript(() => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
  });
  await page.goto(`${baseUrl}src/app.html`);
  await page.evaluate(() => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
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
        await page.waitForLoadState('domcontentloaded');
        await page.evaluate(() => {
          Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
        });
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
