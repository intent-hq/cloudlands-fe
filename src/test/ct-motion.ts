import type { test } from '@playwright/experimental-ct-svelte';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type MotionPage = Pick<Page, 'emulateMedia' | 'evaluate'>;

/** Supplement contextOptions (which applies before CT navigation) before hooks/mount. */
export async function applyAndVerifyMotion(
  page: MotionPage,
  requested: 'reduce' | 'no-preference' | null | undefined,
): Promise<void> {
  // Undefined keeps the runner default; null keeps its system-preference opt-out.
  if (requested === undefined || requested === null) return;
  await page.emulateMedia({ reducedMotion: requested });
  const actual = await page.evaluate(() => ({
    // eslint-disable-next-line intent/no-direct-reduced-motion-query -- verifies the CT emulation itself; the OS-level query is the point
    reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
    // eslint-disable-next-line intent/no-direct-reduced-motion-query -- verifies the CT emulation itself; the OS-level query is the point
    noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
  }));
  if (
    actual.reduce !== (requested === 'reduce') ||
    actual.noPreference !== (requested === 'no-preference')
  ) {
    throw new Error(
      `CT motion mismatch: requested ${requested}; matchMedia returned ${JSON.stringify(actual)}`,
    );
  }
}
