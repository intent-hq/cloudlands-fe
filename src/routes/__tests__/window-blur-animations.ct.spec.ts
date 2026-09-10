import { expect, test } from '@playwright/experimental-ct-svelte';
import WindowBlurAnimationProbe from './WindowBlurAnimationProbe.svelte';

test.afterEach(async ({ page }) => {
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
});

test('pauses ambient animations while the window-blurred attribute is present', async ({
  mount,
  page,
}) => {
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await mount(WindowBlurAnimationProbe);
  const probe = page.getByTestId('ambient-animation-probe');
  const playState = () => probe.evaluate((node) => node.getAnimations()[0]?.playState);

  await expect(probe).toBeVisible();
  const initial = await probe.evaluate((node) => ({
    animation: getComputedStyle(node).animationName,
    count: node.getAnimations().length,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));
  expect(initial.animation).not.toBe('none');
  expect(initial.count).toBe(1);
  expect(initial.reducedMotion).toBe(false);
  await expect.poll(playState).toBe('running');
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await expect.poll(playState).toBe('paused');
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect.poll(playState).toBe('running');
});
