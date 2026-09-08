import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const themeModes = ['light', 'dark'] as const;
const adjacentSurfaces = ['background', 'card', 'popover', 'sidebar'] as const;

function themeColor(css: string, mode: (typeof themeModes)[number], role: string): string {
  const match = css.match(new RegExp(`--theme-${mode}-${role}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing ${mode} ${role} token`);
  return match[1].trim();
}

function hslToRgb(value: string): [number, number, number] {
  const [hue, saturation, lightness] = value.match(/[\d.]+/g)?.map(Number) ?? [];
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = l - chroma / 2;
  const channels =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return channels.map((channel) => Math.round((channel + offset) * 255)) as [
    number,
    number,
    number,
  ];
}

function contrastRatio(first: string, second: string): number {
  const luminance = (value: string) => {
    const channels = hslToRgb(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function invalidControlContrastCases() {
  const css = readFileSync(resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
  return themeModes.flatMap((mode) => {
    const invalidBoundary = themeColor(css, mode, 'danger');
    return adjacentSurfaces.map((surface) => ({
      label: `${mode} invalid boundary on ${surface}`,
      ratio: contrastRatio(invalidBoundary, themeColor(css, mode, surface)),
    }));
  });
}
