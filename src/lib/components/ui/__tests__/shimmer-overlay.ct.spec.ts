import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import ShimmerOverlayHost from './ShimmerOverlayHost.svelte';

async function readShimmer(text: Locator, overlay: Locator) {
  return {
    text: await text.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        animationName: style.animationName,
        backgroundImage: style.backgroundImage,
        textFillColor: style.webkitTextFillColor,
        color: style.color,
      };
    }),
    overlay: await overlay.evaluate((element) => {
      const style = getComputedStyle(element);
      return { animationName: style.animationName, opacity: style.opacity };
    }),
  };
}

for (const source of ['OS', 'battery'] as const) {
  test(`${source} preference suppresses both shimmer modes and restores authored motion`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const component = await mount(ShimmerOverlayHost);
    const text = component.getByTestId('shimmer-text').locator('span');
    const overlay = component.getByTestId('shimmer-overlay').locator('div');
    const initial = await readShimmer(text, overlay);
    expect(initial.text.animationName).not.toBe('none');
    expect(initial.overlay.animationName).not.toBe('none');

    if (source === 'OS') await page.emulateMedia({ reducedMotion: 'reduce' });
    else await page.evaluate(() => document.documentElement.setAttribute('data-reduce-motion', ''));
    // The global motion blanket gives every property a 0.01ms transition.
    // Wait for its endpoint rather than sampling opacity before the next paint.
    await expect(overlay).toHaveCSS('opacity', '0');
    const reduced = await readShimmer(text, overlay);
    expect(reduced.text.animationName).toBe('none');
    expect(reduced.text.backgroundImage).toBe('none');
    expect(reduced.text.textFillColor).toBe(reduced.text.color);
    expect(reduced.overlay).toEqual({ animationName: 'none', opacity: '0' });

    if (source === 'OS') await page.emulateMedia({ reducedMotion: 'no-preference' });
    else await page.evaluate(() => document.documentElement.removeAttribute('data-reduce-motion'));
    await expect.poll(() => readShimmer(text, overlay)).toEqual(initial);
  });
}
