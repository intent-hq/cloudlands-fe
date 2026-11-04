import SettleProbeHarness from './__tests__/SettleProbeHarness.svelte';
import { PAUSE_AHEAD_MS } from './ct-clock';
import { expect, installPausedClock, pauseClock, test } from './ct-test';

// Real (Node-side) time passing between two reads of the page clock, standing in for a
// slow CI step. The page clock must not see it once paused.
const realDelay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('installPausedClock stops page time until the test steps it', async ({ mount, page }) => {
  await mount(SettleProbeHarness);
  await installPausedClock(page);
  const start = await page.evaluate(() => Date.now());
  await realDelay(250);
  expect(await page.evaluate(() => Date.now())).toBe(start);

  await page.clock.runFor(16);
  expect(await page.evaluate(() => Date.now())).toBe(start + 16);
});

test('installPausedClock runs beforePause while time moves and returns its result', async ({
  mount,
  page,
}) => {
  const before = await page.evaluate(() => Date.now());
  const component = await installPausedClock(page, async () => {
    const mounted = await mount(SettleProbeHarness);
    // A page timer only fires here if fake time still moves with real time.
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    return mounted;
  });
  await expect(component.getByTestId('js-toggle')).toBeVisible();

  const paused = await page.evaluate(() => Date.now());
  expect(paused).toBeGreaterThanOrEqual(before + PAUSE_AHEAD_MS);
  await realDelay(250);
  expect(await page.evaluate(() => Date.now())).toBe(paused);
});

test('pauseClock pauses a clock installed earlier', async ({ mount, page }) => {
  await page.clock.install();
  await mount(SettleProbeHarness);
  const flowing = await page.evaluate(() => Date.now());
  await realDelay(100);
  expect(await page.evaluate(() => Date.now())).toBeGreaterThan(flowing);

  await pauseClock(page);
  const paused = await page.evaluate(() => Date.now());
  await realDelay(250);
  expect(await page.evaluate(() => Date.now())).toBe(paused);
});
