import type { test } from './ct-test';

/**
 * A paused fake clock for Playwright component tests.
 *
 * Why: `page.clock.install()` alone fakes the timers but keeps them moving with real
 * time. Every slow step on a busy CI runner (a key press, a DOM read, a screenshot) lets
 * frame loops and timers run past the frames a test means to sample. Frame loops that
 * catch up to real time, like `createFrameLoop` in
 * `src/features/hud/utils/dock-shell-frames.ts` (it skips ahead to real time minus
 * `MAX_LAG_MS`), jump straight past a "part-way open" pose. `dock-edge-shell.ct.spec.ts`
 * failed 56 of 80 loaded runs that way and 0 of 200 once paused (cloudlands-fe#4148). It
 * had ejected unrelated PRs from the merge queue at least five times.
 *
 * Paused, page time moves only through `page.clock.runFor` / `fastForward` /
 * `runToLast`, so each step is one known amount of time however slow the machine is.
 *
 * - `installPausedClock(page)` installs the fake clock and pauses it right away.
 * - `installPausedClock(page, () => mount(...))` lets setup that needs time to pass (a
 *   mount, opening animations) run with the clock moving, then pauses. It returns what
 *   the callback returns.
 * - `pauseClock(page)` pauses a clock installed earlier, once the test reaches the
 *   point where it starts stepping time by hand.
 *
 * Pausing jumps the page `PAUSE_AHEAD_MS` ahead first, because `pauseAt` only accepts a
 * time in the future. Timers due in that window fire once, so setup started just before
 * the pause still finishes.
 *
 * The `intent/no-unpaused-clock-in-ct` lint rule flags a `page.clock.install()` in a
 * `*.ct.spec.ts` whose test never pauses the clock. A test that really needs time to
 * keep moving turns the rule off on that line and says why.
 */

// ct-svelte bundles its own Playwright, so derive Page from its fixtures (see menu-geometry.ts).
type CtPage = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];

/** How far ahead of the page's current fake time `pauseClock` jumps before pausing. */
export const PAUSE_AHEAD_MS = 1000;

/** Pause a fake clock installed earlier with `page.clock.install()`. */
export async function pauseClock(page: CtPage): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + PAUSE_AHEAD_MS);
}

/**
 * Install the fake clock and pause it. With `beforePause`, run it while time still moves
 * (to mount or let opening motion finish), then pause, and return its result.
 */
export async function installPausedClock(page: CtPage): Promise<void>;
export async function installPausedClock<T>(
  page: CtPage,
  beforePause: () => Promise<T>,
): Promise<T>;
export async function installPausedClock<T>(
  page: CtPage,
  beforePause?: () => Promise<T>,
): Promise<T | void> {
  await page.clock.install();
  const result = beforePause ? await beforePause() : undefined;
  await pauseClock(page);
  return result;
}
