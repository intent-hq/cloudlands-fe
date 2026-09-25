import { expect, test } from '../../../test/ct-test';
import ViewerPreview, { OFFLINE_HOST } from './browser-viewer-tab.preview.svelte';

type Rgba = [number, number, number, number];

const mirror = {
  url: 'https://staging.example.com/dashboard',
  title: 'Staging dashboard',
  host: OFFLINE_HOST,
};

function luminance([red, green, blue]: Rgba): number {
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first: Rgba, second: Rgba): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

for (const theme of ['light', 'dark'] as const) {
  test(`host-offline banner text and icon stay readable on the warning surface in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    await mount(ViewerPreview, { props: { mirror, width: 720 } });

    const banner = page.locator('[data-browser-viewer-offline-banner]');
    await expect(banner).toBeVisible();

    // Tailwind emits the soft warning tint as a color-mix(), which Chromium serializes in
    // oklab rather than rgb(); a canvas composites every layer in sRGB regardless of the
    // computed color syntax, so the measured pixel is what the user sees.
    const measurement = await banner.evaluate((element) => {
      type Color = [number, number, number, number];
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2d canvas context unavailable');
      const paint = (colors: string[]): Color => {
        context.clearRect(0, 0, 1, 1);
        for (const color of colors) {
          context.fillStyle = '#010203';
          context.fillStyle = color;
          if (context.fillStyle === '#010203' && color !== '#010203') {
            throw new Error(`Unsupported computed color: ${color}`);
          }
          context.fillRect(0, 0, 1, 1);
        }
        const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
        return [red, green, blue, alpha / 255];
      };
      const layers: string[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        layers.unshift(getComputedStyle(node).backgroundColor);
      }
      const text = element.querySelector('span');
      const icon = element.querySelector('svg');
      if (!text || !icon) throw new Error('offline banner is missing its text or icon');
      const textColor = getComputedStyle(text).color;
      const iconColor = getComputedStyle(icon).color;
      return {
        surfaceAlpha: paint([getComputedStyle(element).backgroundColor])[3],
        effectiveBackground: paint(layers),
        text: paint([...layers, textColor]),
        icon: paint([...layers, iconColor]),
        textColor,
        iconColor,
      };
    });

    expect(measurement.surfaceAlpha, 'banner keeps its soft warning tint').toBeCloseTo(0.1, 1);
    expect(measurement.effectiveBackground[3], 'opaque backing').toBe(1);
    expect(
      contrastRatio(measurement.text, measurement.effectiveBackground),
      `${theme} banner text: ${JSON.stringify(measurement)}`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(measurement.icon, measurement.effectiveBackground),
      `${theme} banner icon: ${JSON.stringify(measurement)}`,
    ).toBeGreaterThanOrEqual(4.5);
  });
}
