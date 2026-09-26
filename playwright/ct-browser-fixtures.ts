import { test as base } from '@playwright/experimental-ct-svelte';
import { existsSync } from 'node:fs';
import {
  assertCtRuntime,
  CT_BROWSER,
  ctSourceIdentity,
  resolveCtBrowser,
  resolveCtAlignedPlaywrightCli,
} from '../scripts/ct-browser.mjs';

export interface CtBrowserOptions {
  // Only the explicit lifetime diagnostic config supplies this option.
  _ctDiagnosticBrowser: { executablePath: string; expectedVersion: string } | undefined;
}

type RuntimeIdentity = {
  expected: typeof CT_BROWSER;
  runnerVersion: string;
  diagnostic: boolean;
  expectedVersion: string;
  runtime: {
    product: string;
    revision: string;
    jsVersion: string;
    userAgent: string;
    protocolVersion: string;
  };
  source: ReturnType<typeof ctSourceIdentity>;
};

export const browserTest = base.extend<
  { _ctRuntimeEvidence: void },
  CtBrowserOptions & { _ctRuntimeIdentity: RuntimeIdentity; _ctExecutable: string }
>({
  _ctDiagnosticBrowser: [undefined, { scope: 'worker', option: true }],
  _ctExecutable: [
    async ({ headless, _ctDiagnosticBrowser }, use) => {
      const executablePath =
        _ctDiagnosticBrowser?.executablePath ?? resolveCtBrowser({ headless }).executablePath;
      if (!existsSync(executablePath))
        throw new Error(`Missing CT diagnostic browser: ${executablePath}`);
      await use(executablePath);
    },
    { scope: 'worker' },
  ],

  browser: [
    async (
      { playwright, browserName, launchOptions, headless, connectOptions, _ctExecutable },
      use,
    ) => {
      if (browserName !== 'chromium' || connectOptions) {
        throw new Error('CT requires the locally installed pinned Chromium browser');
      }
      if (launchOptions.executablePath && launchOptions.executablePath !== _ctExecutable) {
        throw new Error('CT executable overrides require the explicit lifetime diagnostic config');
      }
      const browser = await playwright.chromium.launch({
        ...launchOptions,
        headless,
        executablePath: _ctExecutable,
      });
      try {
        await use(browser);
      } finally {
        await browser.close({ reason: 'Test ended.' });
      }
    },
    { scope: 'worker', timeout: 0 },
  ],

  _ctRuntimeIdentity: [
    async ({ browser, _ctExecutable, _ctDiagnosticBrowser }, use) => {
      const session = await browser.newBrowserCDPSession();
      let runtime: RuntimeIdentity['runtime'];
      try {
        runtime = await session.send('Browser.getVersion');
      } finally {
        await session.detach();
      }
      const identity = {
        expected: CT_BROWSER,
        runnerVersion: resolveCtAlignedPlaywrightCli().version,
        diagnostic: Boolean(_ctDiagnosticBrowser),
        expectedVersion: _ctDiagnosticBrowser?.expectedVersion ?? CT_BROWSER.chromiumVersion,
        runtime,
        source: ctSourceIdentity(_ctExecutable),
      };
      await use(identity);
    },
    { scope: 'worker' },
  ],

  _ctRuntimeEvidence: [
    async ({ _ctRuntimeIdentity }, use, testInfo) => {
      // Before the body/page: first-attempt identity survives an assertion failure,
      // timeout or context-guard failure, including when the retry passes.
      await testInfo.attach('ct-runtime.json', {
        contentType: 'application/json',
        body: JSON.stringify(
          { ..._ctRuntimeIdentity, retry: testInfo.retry, workerIndex: testInfo.workerIndex },
          null,
          2,
        ),
      });
      assertCtRuntime(_ctRuntimeIdentity.runtime, _ctRuntimeIdentity.expectedVersion);
      await use();
    },
    { auto: true, box: true },
  ],
});
