import type { Page, TestInfo } from '@playwright/test';

/**
 * Per-test browser-context isolation for heavy Playwright CT specs
 * (intent-hq/intent#4373, intent-hq/intent#4783).
 *
 * `@playwright/experimental-ct-core` reuses one browser context + page per
 * worker. Specs whose zoom-200% cells leave a heavy document behind have
 * intermittently made the NEXT `mount()` on that reused page fail with
 * "Execution context was destroyed" on the merge queue — whether the next
 * mount belongs to another spec or to the next cell of the same spec. Calling
 * `isolateBrowserContextPerTest(test, issue)` at the top of such a spec runs
 * it in its own worker with a fresh browser context per test, so no teardown
 * of a heavy cell can race a later mount.
 */

interface IsolatableTest {
  beforeEach(hook: (fixtures: { page: Page }, testInfo: TestInfo) => Promise<void>): void;
}

const browserContextIdsSeenInWorker = new Set<string>();

export function isolateBrowserContextPerTest(test: IsolatableTest, issue: string): void {
  // `_optionContextReuseMode` is a boxed, worker-scoped Playwright-internal
  // option that is not in the public types; ct-core pins it to
  // 'when-possible' in its fixtures, so only a file-level `test.use` (which
  // this call is, when made while the spec file is loading) can override it.
  (test as unknown as { use(fixtures: Record<string, unknown>): void }).use({
    _optionContextReuseMode: 'none',
  });

  // Isolation guard for the private option above: if a Playwright upgrade
  // renames or drops `_optionContextReuseMode`, `test.use` silently becomes a
  // no-op and per-worker reuse (and the flake) come back with nothing failing
  // loudly. Under reuse every test in this worker mounts into the same browser
  // context; with isolation each test gets a new one. A page-side marker
  // cannot tell the two apart (the reuse reset navigates to about:blank and
  // clears origin storage), so compare the CDP browserContextId instead.
  test.beforeEach(async ({ page }) => {
    const session = await page.context().newCDPSession(page);
    try {
      const { targetInfo } = await session.send('Target.getTargetInfo');
      const browserContextId = targetInfo.browserContextId ?? '';
      if (browserContextId === '') {
        throw new Error('Target.getTargetInfo did not report a browserContextId');
      }
      if (browserContextIdsSeenInWorker.has(browserContextId)) {
        throw new Error(
          `browser context ${browserContextId} was already used by an earlier test in this worker: ` +
            "test.use({ _optionContextReuseMode: 'none' }) is no longer disabling context reuse " +
            `(${issue})`,
        );
      }
      browserContextIdsSeenInWorker.add(browserContextId);
    } finally {
      await session.detach();
    }
  });
}
