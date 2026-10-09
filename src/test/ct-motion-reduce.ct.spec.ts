import { expect, test } from './ct-test';

const requested = 'reduce' as const;
// Reproduce the unsupported top-level option used by the historical geometry test.
// @ts-expect-error Playwright 1.58.2 accepts this only inside contextOptions.
test.use({ reducedMotion: requested });
test.describe.configure({ mode: 'default' });

for (const sample of [1, 2]) {
  test(`file-level ${requested}: browser media sample ${sample}`, async ({
    page,
    contextOptions,
  }, testInfo) => {
    const readMedia = () =>
      page.evaluate(() => ({
        reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
        noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
      }));
    const session = await page.context().newCDPSession(page);
    const { targetInfo } = await session.send('Target.getTargetInfo');
    await session.detach();
    const initial = await readMedia();
    await page.emulateMedia({ reducedMotion: requested });
    const directRequested = await readMedia();
    const opposite = requested === 'reduce' ? 'no-preference' : 'reduce';
    // Leave the opposite state behind so the next test must start independently.
    await page.emulateMedia({ reducedMotion: opposite });
    const directOpposite = await readMedia();
    const evidence = {
      requested,
      sample,
      workerIndex: testInfo.workerIndex,
      contextReuse: process.env.CT_CONTEXT_REUSE ?? 'unset',
      contextOption: contextOptions.reducedMotion ?? 'unset',
      browserContextId: targetInfo.browserContextId,
      initial,
      directRequested,
      directOpposite,
    };
    console.log('motion-probe', JSON.stringify(evidence));
    await testInfo.attach('motion-probe.json', {
      contentType: 'application/json',
      body: JSON.stringify(evidence, null, 2),
    });
    const expected = {
      reduce: requested === 'reduce',
      noPreference: requested === 'no-preference',
    };
    expect(directRequested).toEqual(expected);
    expect(directOpposite).toEqual({
      reduce: !expected.reduce,
      noPreference: !expected.noPreference,
    });
    expect(initial).toEqual(expected);
  });
}

// Control: the same file-level API with Playwright's documented option nesting.
test.describe('contextOptions control', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });
  test('nested reduce reaches the browser without direct emulation', async ({ page }) => {
    const actual = await page.evaluate(() => ({
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
      noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
    }));
    console.log('motion-probe-nested-control', JSON.stringify(actual));
    expect(actual).toEqual({ reduce: true, noPreference: false });
  });
});
