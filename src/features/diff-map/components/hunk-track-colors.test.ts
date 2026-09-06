import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HUNK_TRACK_COLOR_ROLES } from './hunk-track-colors';

function themeToken(css: string, theme: 'light' | 'dark', role: string) {
  const match = css.match(new RegExp(`--theme-${theme}-${role}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing ${theme} ${role} theme token`);
  return match[1];
}

function luminance(hsl: string) {
  const [hue, saturationPercent, lightnessPercent] = hsl
    .split(/[%\s]+/)
    .filter(Boolean)
    .map(Number);
  const saturation = saturationPercent / 100;
  const lightness = lightnessPercent / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
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
  const offset = lightness - chroma / 2;
  const linear = channels.map((channel) => {
    const value = channel + offset;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('hunk track colors', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');

  it.each(['light', 'dark'] as const)('keeps %s segment marks distinguishable', (theme) => {
    const background = themeToken(css, theme, HUNK_TRACK_COLOR_ROLES.background);

    for (const segment of ['old', 'new'] as const) {
      const color = themeToken(css, theme, HUNK_TRACK_COLOR_ROLES[segment]);
      expect(contrast(color, background), `${segment} segment`).toBeGreaterThanOrEqual(3);
    }
  });
});
