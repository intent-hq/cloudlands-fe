import { applyAndVerifyMotion } from './ct-motion';
import { expect, test as base } from './ct-test';

declare global {
  interface Window {
    __ctMotionAtDocumentStart: { reduce: boolean; noPreference: boolean; scripts: number };
  }
}

// Observe the CT document before any host script/component import runs.
const observedTest = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      window.__ctMotionAtDocumentStart = {
        reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
        noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
        scripts: document.scripts.length,
      };
    });
    await use(context);
  },
});

// Poison after CT navigation but before the shared auto fixture and beforeEach.
// contextOptions alone cannot pass: the runtime guard must repair this state.
const test = observedTest.extend({
  page: async ({ page, contextOptions }, use) => {
    await page.emulateMedia({
      reducedMotion: contextOptions.reducedMotion === 'reduce' ? 'no-preference' : 'reduce',
    });
    await use(page);
  },
});

for (const requested of ['reduce', 'no-preference'] as const) {
  test.describe(requested, () => {
    test.use({ contextOptions: { reducedMotion: requested } });
    // The first two tests share only evidence of ordered execution.
    test.describe.configure({ mode: 'default' });
    const expected = {
      reduce: requested === 'reduce',
      noPreference: requested === 'no-preference',
    };
    const opposite = requested === 'reduce' ? 'no-preference' : 'reduce';
    let previous: { workerIndex: number; contextId: string } | undefined;

    test.beforeEach(async ({ page }) => {
      expect(await page.evaluate(() => window.__ctMotionAtDocumentStart)).toEqual({
        ...expected,
        scripts: 0,
      });
      expect(
        await page.evaluate(() => ({
          reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
          noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
        })),
      ).toEqual(expected);
    });

    for (const sample of [1, 2]) {
      test(`restores requested media before hooks, fresh context ${sample}`, async ({
        page,
      }, testInfo) => {
        const session = await page.context().newCDPSession(page);
        const { targetInfo } = await session.send('Target.getTargetInfo');
        await session.detach();
        const contextId = targetInfo.browserContextId!;
        expect(contextId).toBeTruthy();
        if (sample === 2) {
          expect(previous).toBeDefined();
          expect(testInfo.workerIndex).toBe(previous!.workerIndex);
          expect(contextId).not.toBe(previous!.contextId);
        }
        previous = { workerIndex: testInfo.workerIndex, contextId };
        await page.emulateMedia({ reducedMotion: opposite });
        await applyAndVerifyMotion(page, requested);
        expect(
          await page.evaluate(() => ({
            reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
            noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
          })),
        ).toEqual(expected);
        // Leave the opposite state behind for the next test's fresh context.
        await page.emulateMedia({ reducedMotion: opposite });
        expect(
          await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
        ).toBe(!expected.reduce);
        await testInfo.attach('motion-isolation.json', {
          contentType: 'application/json',
          body: JSON.stringify({
            requested,
            sample,
            ...previous,
            early: await page.evaluate(() => window.__ctMotionAtDocumentStart),
            poisoned: opposite,
          }),
        });
      });
    }

    test('rejects broken application against actual browser media', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: opposite });
      await expect(
        applyAndVerifyMotion(
          {
            emulateMedia: async () => {},
            evaluate: page.evaluate.bind(page),
          },
          requested,
        ),
      ).rejects.toThrow(
        `CT motion mismatch: requested ${requested}; matchMedia returned ${JSON.stringify({ reduce: !expected.reduce, noPreference: !expected.noPreference })}`,
      );
    });
  });
}

for (const requested of [undefined, null]) {
  observedTest.describe(`unforced motion ${String(requested)}`, () => {
    observedTest.use({ contextOptions: { reducedMotion: requested } });
    observedTest(
      'preserves initial browser semantics and leaves overrides alone',
      async ({ page }) => {
        const initial = await page.evaluate(() => window.__ctMotionAtDocumentStart);
        expect(initial.scripts).toBe(0);
        expect(
          await page.evaluate(() => ({
            reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
            noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
          })),
        ).toEqual({ reduce: initial.reduce, noPreference: initial.noPreference });
        // Null is system-dependent; only the runner's undefined default is normal motion.
        if (requested === undefined) expect(initial.reduce).toBe(false);
        for (const reducedMotion of ['reduce', 'no-preference'] as const) {
          await page.emulateMedia({ reducedMotion });
          await applyAndVerifyMotion(page, requested);
          expect(
            await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
          ).toBe(reducedMotion === 'reduce');
        }
      },
    );
  });
}
