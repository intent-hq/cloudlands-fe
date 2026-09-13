// @verify-changed-triggers: ../syntax-highlighting.css, ../tokens.css
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Every light-theme highlight.js token color must stay readable (WCAG AA,
// ≥ 4.5:1) on the light code surface — intent-hq/intent#4647. The surface is
// `bg-background`, i.e. `--theme-light-background` from tokens.css.
const AA_MINIMUM = 4.5;
const LIGHT_SELECTOR = ':root:not(.dark)';

const read = (file: string) =>
  fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles', file), 'utf8');

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Unsupported color literal: ${hex}`);
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function hslToRgb(value: string): [number, number, number] {
  const parts = value
    .trim()
    .split(/\s+/)
    .map((part) => Number.parseFloat(part));
  const [hue, saturation, lightness] = parts as [number, number, number];
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = l - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const rgb1 = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][sector]!;
  return rgb1.map((channel) => Math.round((channel + offset) * 255)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(
  foreground: [number, number, number],
  background: [number, number, number],
): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}

/** Light-theme `.hljs-*` token → declared color, parsed from the production stylesheet. */
function lightTokenColors(css: string): Map<string, string> {
  const colors = new Map<string, string>();
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1]!.split(',').map((selector) => selector.trim());
    const color = /(?:^|;)\s*color:\s*([^;!]+)/.exec(rule[2]!)?.[1]?.trim();
    if (!color) continue;
    for (const selector of selectors) {
      if (!selector.startsWith(LIGHT_SELECTOR)) continue;
      const token = /\.(hljs-[\w-]+)$/.exec(selector)?.[1];
      if (token) colors.set(token, color);
    }
  }
  return colors;
}

function lightCodeSurface(tokensCss: string): [number, number, number] {
  const hsl = /--theme-light-background:\s*([^;]+);/.exec(tokensCss)?.[1];
  if (!hsl) throw new Error('tokens.css no longer declares --theme-light-background');
  return hslToRgb(hsl);
}

function audit(css: string, surface: [number, number, number]): Map<string, number> {
  return new Map(
    [...lightTokenColors(css)].map(([token, color]) => [token, contrast(hexToRgb(color), surface)]),
  );
}

describe('syntax-highlighting light palette contrast', () => {
  const surface = lightCodeSurface(read('tokens.css'));
  const css = read('syntax-highlighting.css');

  it('declares a light override for every dark token color', () => {
    const darkTokens = new Set<string>();
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(?:^|;)\s*color:/.test(rule[2]!)) continue;
      for (const selector of rule[1]!.split(',')) {
        const token = /^\s*\.(hljs-[\w-]+)\s*$/.exec(selector)?.[1];
        if (token) darkTokens.add(token);
      }
    }
    expect(darkTokens.size).toBeGreaterThan(0);
    expect([...lightTokenColors(css).keys()].sort()).toEqual([...darkTokens].sort());
  });

  it('keeps every light token at or above WCAG AA against the light code surface', () => {
    const ratios = audit(css, surface);
    expect(ratios.size).toBeGreaterThan(20);
    const failing = [...ratios].filter(([, ratio]) => ratio < AA_MINIMUM);
    expect(failing, 'light tokens below 4.5:1').toEqual([]);
  });

  it('flags a token whose light color is lowered below AA', () => {
    const mutated = css.replace(
      /(:root:not\(\.dark\) \.hljs-keyword \{\s*color:\s*)#[0-9a-f]{6}/i,
      '$1#c084fc',
    );
    expect(mutated).not.toBe(css);
    const ratios = audit(mutated, surface);
    expect(ratios.get('hljs-keyword')).toBeLessThan(AA_MINIMUM);
    expect([...ratios].filter(([, ratio]) => ratio < AA_MINIMUM).map(([token]) => token)).toEqual([
      'hljs-keyword',
    ]);
  });
});
