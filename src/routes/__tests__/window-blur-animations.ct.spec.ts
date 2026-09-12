import { expect, test } from '@playwright/experimental-ct-svelte';
import IntentMarkLoader from '$lib/components/ui/indicators/IntentMarkLoader.svelte';
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

test('stops the main-thread mark pose driver while the window-blurred attribute is present', async ({
  mount,
  page,
}) => {
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await mount(IntentMarkLoader, { props: { variant: 'bloom', size: 128, playing: true } });
  const root = page.getByRole('status', { name: 'Loading' });
  const animationCount = () =>
    root.evaluate((node) => node.getAnimations({ subtree: true }).length);
  const poseWritesOver = (windowMs: number) =>
    root.evaluate(
      (node, duration) =>
        new Promise<number>((resolve) => {
          const arm = node.querySelector<SVGSVGElement>('[data-mark-arm-box]')!;
          let writes = 0;
          let last = arm.style.transform;
          const observer = new MutationObserver(() => {
            if (arm.style.transform === last) return;
            last = arm.style.transform;
            writes += 1;
          });
          observer.observe(arm, { attributes: true, attributeFilter: ['style'] });
          window.setTimeout(() => {
            observer.disconnect();
            resolve(writes);
          }, duration);
        }),
      windowMs,
    );

  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await expect.poll(() => poseWritesOver(200)).toBeGreaterThan(0);
  await page.evaluate(() => document.documentElement.setAttribute('data-window-blurred', ''));
  await expect(root).toHaveAttribute('data-motion-state', 'neutral');
  await expect.poll(animationCount).toBe(0);
  expect(await poseWritesOver(500)).toBe(0);
  await page.evaluate(() => document.documentElement.removeAttribute('data-window-blurred'));
  await expect(root).toHaveAttribute('data-motion-state', 'playing');
  await expect.poll(() => poseWritesOver(200)).toBeGreaterThan(0);
});
