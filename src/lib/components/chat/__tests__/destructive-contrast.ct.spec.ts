import { expect, test } from '@playwright/experimental-ct-svelte';
import DestructiveContrastHost from './DestructiveContrastHost.svelte';

type Rgba = [number, number, number, number];

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

test('keeps destructive and operational secondary text readable in both themes', async ({
  mount,
}) => {
  const component = await mount(DestructiveContrastHost, { props: { theme: 'light' } });
  const targets = [
    { name: 'failed attachment chip', selector: '[data-placement-status="failed"]', alpha: 0.1 },
    { name: 'streaming error title', selector: '[data-testid="error-title"]', alpha: 0 },
    { name: 'turn-failure alert', selector: '.turn-failure-notice', alpha: 0.1 },
    {
      name: 'operational secondary',
      selector: '[data-testid="operational-secondary-surface"] [data-operational-icon-box]',
      alpha: 0,
    },
  ];
  const resolvedColors: Record<
    string,
    Record<string, { foreground: string; background: string }>
  > = {};

  for (const theme of ['light', 'dark'] as const) {
    await component.update({ props: { theme } });
    await expect(component).toHaveAttribute('data-theme', theme);
    await expect
      .poll(() => component.evaluate(() => document.documentElement.className))
      .toContain(theme);
    resolvedColors[theme] = {};
    for (const target of targets) {
      const measurement = await component.locator(target.selector).evaluate((element) => {
        type Color = [number, number, number, number];
        const parse = (value: string): Color => {
          const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [];
          if (value.startsWith('color(srgb')) {
            return [numbers[0] * 255, numbers[1] * 255, numbers[2] * 255, numbers[3] ?? 1];
          }
          if (numbers.length < 3) throw new Error(`Unsupported computed color: ${value}`);
          return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
        };
        const composite = (front: Color, back: Color): Color => {
          const alpha = front[3] + back[3] * (1 - front[3]);
          if (alpha === 0) return [0, 0, 0, 0];
          return [
            (front[0] * front[3] + back[0] * back[3] * (1 - front[3])) / alpha,
            (front[1] * front[3] + back[1] * back[3] * (1 - front[3])) / alpha,
            (front[2] * front[3] + back[2] * back[3] * (1 - front[3])) / alpha,
            alpha,
          ];
        };
        const layers: Color[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          layers.push(parse(getComputedStyle(node).backgroundColor));
        }
        const effectiveBackground = layers
          .reverse()
          .reduce((background, layer) => composite(layer, background), [0, 0, 0, 0] as Color);
        const style = getComputedStyle(element);
        const foreground = parse(style.color);
        return {
          foreground: style.color,
          surfaceBackground: style.backgroundColor,
          effectiveForeground: composite(foreground, effectiveBackground),
          effectiveBackground,
          surfaceAlpha: parse(style.backgroundColor)[3],
        };
      });

      expect(measurement.surfaceAlpha, `${target.name} surface alpha`).toBeCloseTo(target.alpha, 2);
      expect(
        contrastRatio(measurement.effectiveForeground, measurement.effectiveBackground),
        `${theme} ${target.name}: ${JSON.stringify(measurement)}`,
      ).toBeGreaterThanOrEqual(4.5);
      resolvedColors[theme][target.name] = {
        foreground: measurement.foreground,
        background: JSON.stringify(measurement.effectiveBackground),
      };
    }
  }

  for (const target of targets) {
    expect(
      resolvedColors.dark[target.name].foreground,
      `${target.name} must resolve a dark foreground utility`,
    ).not.toBe(resolvedColors.light[target.name].foreground);
    expect(
      resolvedColors.dark[target.name].background,
      `${target.name} must resolve a dark background utility`,
    ).not.toBe(resolvedColors.light[target.name].background);
  }
});
