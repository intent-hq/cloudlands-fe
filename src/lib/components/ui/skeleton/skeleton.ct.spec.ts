import { expect, test } from '@playwright/experimental-ct-svelte';
import SkeletonMotionHost from './SkeletonMotionHost.svelte';

for (const theme of ['light', 'dark']) {
  test(`keeps ${theme} placeholders subdued and preserves layout when motion changes`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const component = await mount(SkeletonMotionHost);
    await page.evaluate((value) => {
      document.documentElement.classList.toggle('dark', value === 'dark');
      document.documentElement.classList.toggle('light', value === 'light');
    }, theme);
    const skeletons = component.locator('[data-slot="skeleton"]');
    const first = skeletons.first();
    await expect(first).not.toHaveCSS('animation-name', 'none');
    const initialBounds = await skeletons.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().toJSON()),
    );
    const contrast = await first.evaluate((node) => {
      const surface = getComputedStyle(node.closest('[data-skeleton-surface]')!).backgroundColor;
      const style = getComputedStyle(node);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      function luminance(...layers: string[]) {
        context.clearRect(0, 0, 1, 1);
        for (const color of layers) {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
        }
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((byte) => {
          const value = byte / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }
      const backdrop = luminance(surface);
      const ratio = (value: number) =>
        (Math.max(backdrop, value) + 0.05) / (Math.min(backdrop, value) + 0.05);
      const peakColor = style.backgroundImage.match(
        /((?:color|oklab|oklch|lab|lch|rgb|rgba|hsl|hsla)\([^)]*\))\s+50%/,
      )?.[1];
      if (!peakColor) throw new Error('Expected a resolved shimmer color');
      return {
        base: ratio(luminance(surface, style.backgroundColor)),
        peak: ratio(luminance(surface, style.backgroundColor, peakColor)),
      };
    });
    // Decorative placeholders should be visible without competing with loaded content.
    expect(contrast.base).toBeGreaterThan(1.03);
    expect(contrast.base).toBeLessThan(1.5);
    expect(contrast.peak).toBeGreaterThan(1.01);
    expect(contrast.peak).toBeLessThan(contrast.base);

    for (const source of ['OS', 'battery']) {
      if (source === 'OS') await page.emulateMedia({ reducedMotion: 'reduce' });
      else
        await page.evaluate(() => document.documentElement.setAttribute('data-reduce-motion', ''));
      await expect(first).toHaveCSS('animation-name', 'none');
      await expect(first).toHaveCSS('background-image', 'none');
      expect(
        await skeletons.evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().toJSON()),
        ),
      ).toEqual(initialBounds);
      if (source === 'OS') await page.emulateMedia({ reducedMotion: 'no-preference' });
      else
        await page.evaluate(() => document.documentElement.removeAttribute('data-reduce-motion'));
      await expect(first).not.toHaveCSS('animation-name', 'none');
      await expect(first).not.toHaveCSS('background-image', 'none');
    }
  });
}
