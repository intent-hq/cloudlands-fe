/**
 * Deliberately red, opt-in timeout controls. Never part of the default CT lane.
 * Run through scripts/run-ct-tests.mjs with playwright-ct-lifetime.config.ts,
 * CT_LIFETIME_TIMEOUT_CASES=1, workers=1, retries=0 and a global timeout.
 * Acceptance: two timedOut results, one passed result, clean process exit 1.
 * A generic failure, passing late response, or global timeout is not success.
 */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect } from '../../src/test/ct-test';

type Outcome = { status: string; value?: unknown; error?: string };
type Probe = { pending?: Promise<Outcome> };

const test = base.extend<{ lifetime: Probe }>({
  lifetime: async ({ page }, use, testInfo) => {
    const probe: Probe = {};
    const session = await page.context().newCDPSession(page);
    const record = (event: string, details: unknown) => {
      appendFileSync(
        resolve(process.env.CT_LIFETIME_OUTPUT!, 'timeout-events.jsonl'),
        `${JSON.stringify({ test: testInfo.title, event, details, at: new Date().toISOString() })}\n`,
      );
    };
    page.on('close', () => record('page-closed', {}));
    await use(probe);
    record('test-body-ended', { status: testInfo.status });
    if (testInfo.title.includes('late completion')) {
      const released = await session.send('Runtime.evaluate', {
        expression: 'globalThis.lifetimeResolve(42); "late resolver executed"',
        returnByValue: true,
      });
      record('late-resolver', released);
      expect(released.result.value).toBe('late resolver executed');
      // The test has already timed out. Settling its browser operation must
      // not erase that result or prevent the runner from closing its context.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race([
          probe.pending,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('late response did not settle')), 5_000);
          }),
        ]);
        record('late-response', outcome);
      } finally {
        clearTimeout(timer);
      }
    }
    probe.pending?.then((outcome) => record('evaluation-settled', outcome));
    await session.detach();
    // Leave context closure to the real CT fixtures; do not emulate teardown.
  },
});

for (const scenario of ['pending evaluation', 'late completion']) {
  test(`real test timeout with ${scenario}`, async ({ page, lifetime }, testInfo) => {
    lifetime.pending = page
      .evaluate(`new Promise(resolve => { globalThis.lifetimeResolve = resolve; })`)
      .then(
        (value) => ({ status: 'fulfilled', value }),
        (error: unknown) => ({ status: 'rejected', error: String(error) }),
      );
    await page.waitForFunction('typeof globalThis.lifetimeResolve === "function"');
    testInfo.setTimeout(testInfo.duration + 1_500);
    await lifetime.pending;
    if (testInfo.status !== 'timedOut') {
      throw new Error('The pending operation completed before the real test timeout');
    }
  });
}

test('fresh CT context still works after the timed out workers', async ({ page }) => {
  expect(await page.evaluate(() => 6 * 7)).toBe(42);
  expect(await page.evaluate('typeof globalThis.lifetimeResolve')).toBe('undefined');
});
