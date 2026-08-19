import { stringToSeededRandom } from '$lib/utils/hash';

export const agentColorPalette = [
  '#FFA2A3',
  '#FFD574',
  '#DAF294',
  '#5EEAB4',
  '#75D4FF',
  '#A3B4FF',
  '#DAB2FF',
  '#FEA5D5',
  '#CAD5E2',
] as const;

type Hsl = { h: number; s: number; l: number };

function hexToHsl(hex: string): Hsl | null {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return null;
  const [r, g, b] = match.slice(1).map((value) => parseInt(value, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const channel =
    max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return { h: channel / 6, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const hue = (p: number, q: number, t: number) => {
    const wrapped = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
    if (wrapped < 1 / 2) return q;
    if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
    return p;
  };
  const channels =
    s === 0
      ? [l, l, l]
      : (() => {
          const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
          const p = 2 * l - q;
          return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
        })();
  return `#${channels
    .map((value) =>
      Math.round(value * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function transformColor(
  hex: string,
  hueShift: number,
  brightness: number,
  saturation: number,
): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  return hslToHex({
    h: (hsl.h + hueShift / 360 + 1) % 1,
    s: Math.min(1, Math.max(0, hsl.s * saturation)),
    l: Math.min(1, Math.max(0, hsl.l * brightness)),
  });
}

export function getAgentColorsWithSeed(seed: string, darkMode = false): [string, string] {
  if (!seed) return ['#fff', '#fff'];
  const base = stringToSeededRandom(seed).pick([...agentColorPalette]);
  const shifted = transformColor(base, 30, 1, 1);
  const brightness = darkMode ? 0.7 : 1;
  const saturation = darkMode ? 0.6 : 0.8;
  return [
    transformColor(base, 0, brightness, saturation),
    transformColor(shifted, 0, brightness, saturation),
  ];
}
