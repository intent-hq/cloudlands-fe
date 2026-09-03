/**
 * VS Code Theme Parser
 *
 * Parses VS Code color theme JSON and converts it to:
 * 1. CSS variables (HSL format matching app.css convention)
 * 2. Monaco editor theme (IStandaloneThemeData)
 * 3. Terminal ANSI colors (xterm ITheme shape)
 */

import type { ITheme } from '@xterm/xterm';
import { m } from '$shared/paraglide/messages.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ParsedVSCodeTheme {
  name: string;
  type: 'light' | 'dark';
  cssVariables: Record<string, string>;
  monacoTheme: MonacoStandaloneThemeData;
  terminalColors: Partial<ITheme>;
  rawColors: Record<string, string>;
}

/** Mirrors monaco.editor.IStandaloneThemeData without importing monaco at runtime */
export interface MonacoStandaloneThemeData {
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  inherit: boolean;
  rules: MonacoTokenRule[];
  colors: Record<string, string>;
  encodedTokensColors?: string[];
}

interface MonacoTokenRule {
  token: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

interface VSCodeThemeJSON {
  name?: string;
  type?: string;
  colors?: Record<string, string>;
  tokenColors?: VSCodeTokenColor[];
}

interface VSCodeTokenColor {
  name?: string;
  scope?: string | string[];
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

// ── Color conversion ───────────────────────────────────────────────────────

/**
 * Convert a hex color (#RGB, #RRGGBB, or #RRGGBBAA) to the app's HSL format.
 * Returns a string like "210 50% 40%" (no hsl() wrapper, matching app.css).
 * The alpha channel is discarded since the CSS variable format doesn't use it.
 */
export function hexToHSL(hex: string): string {
  const cleaned = hex.replace(/^#/, '');

  let r: number, g: number, b: number;

  if (cleaned.length === 3 || cleaned.length === 4) {
    r = parseInt(cleaned[0] + cleaned[0], 16) / 255;
    g = parseInt(cleaned[1] + cleaned[1], 16) / 255;
    b = parseInt(cleaned[2] + cleaned[2], 16) / 255;
  } else if (cleaned.length === 6 || cleaned.length === 8) {
    r = parseInt(cleaned.slice(0, 2), 16) / 255;
    g = parseInt(cleaned.slice(2, 4), 16) / 255;
    b = parseInt(cleaned.slice(4, 6), 16) / 255;
  } else {
    return '0 0% 0%';
  }

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  const hDeg = Math.round(h * 360);
  const sPct = Math.round(s * 100);
  const lPct = Math.round(l * 100);

  return `${hDeg} ${sPct}% ${lPct}%`;
}

/**
 * Determine if a hex color is dark based on relative luminance.
 */
export function isHexDark(hex: string): boolean {
  const cleaned = hex.replace(/^#/, '');
  let r: number, g: number, b: number;

  if (cleaned.length >= 6) {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  } else if (cleaned.length >= 3) {
    r = parseInt(cleaned[0] + cleaned[0], 16);
    g = parseInt(cleaned[1] + cleaned[1], 16);
    b = parseInt(cleaned[2] + cleaned[2], 16);
  } else {
    return true;
  }

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

// ── VS Code → CSS variable mapping ────────────────────────────────────────

/**
 * Maps VS Code theme color keys to the app's CSS variable names.
 * The first match wins when multiple VS Code keys map to the same CSS variable.
 */
const VSCODE_TO_CSS_MAP: [string, string][] = [
  ['editor.background', '--background'],
  ['editor.foreground', '--foreground'],
  ['sideBar.background', '--sidebar'],
  ['sideBar.foreground', '--sidebar-foreground'],
  ['sideBar.border', '--sidebar-border'],
  ['editorWidget.background', '--card'],
  ['editorWidget.foreground', '--card-foreground'],
  ['dropdown.background', '--popover'],
  ['dropdown.foreground', '--popover-foreground'],
  ['focusBorder', '--ring'],
  ['input.background', '--input'],
  ['panel.border', '--border'],
  ['editorGroup.border', '--border'],
  ['button.background', '--primary'],
  ['button.foreground', '--primary-foreground'],
  // --accent and --accent-foreground are derived in buildCSSVariables
  // (badge colors are inverted: bright bg + dark fg, which doesn't work
  //  for hover-state backgrounds and interactive text).
  ['list.activeSelectionBackground', '--secondary'],
  ['list.activeSelectionForeground', '--secondary-foreground'],
  // --muted is derived separately in buildCSSVariables to ensure
  // a perceptible lightness difference from --background.
  ['errorForeground', '--danger'],
  ['inputValidation.errorBackground', '--danger-background'],
];

/**
 * Parse a hex color to [r, g, b] in 0-255 range.
 */
function hexToRGB(hex: string): [number, number, number] {
  const cleaned = hex.replace(/^#/, '');
  if (cleaned.length >= 6) {
    return [
      parseInt(cleaned.slice(0, 2), 16),
      parseInt(cleaned.slice(2, 4), 16),
      parseInt(cleaned.slice(4, 6), 16),
    ];
  }
  if (cleaned.length >= 3) {
    return [
      parseInt(cleaned[0] + cleaned[0], 16),
      parseInt(cleaned[1] + cleaned[1], 16),
      parseInt(cleaned[2] + cleaned[2], 16),
    ];
  }
  return [0, 0, 0];
}

/**
 * Convert [r, g, b] (0-255) to a hex string like "#rrggbb".
 */
function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

/**
 * Compute WCAG relative luminance from an [r, g, b] tuple (0-255).
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * WCAG contrast ratio between two colors (each as [r,g,b] 0-255).
 * Returns a value ≥ 1.  WCAG AA large-text requires ≥ 3:1.
 */
function contrastRatio(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const l1 = relativeLuminance(...rgb1);
  const l2 = relativeLuminance(...rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function hslToRGB(value: string): [number, number, number] {
  const match = value.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!match) return [0, 0, 0];
  const hue = Number(match[1]);
  const saturation = Number(match[2]) / 100;
  const lightness = Number(match[3]) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
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

function ensureContrast(foreground: string, background: string): string {
  const foregroundRGB = hslToRGB(foreground);
  const backgroundRGB = hslToRGB(background);
  if (contrastRatio(foregroundRGB, backgroundRGB) >= 4.55) return foreground;
  const black: [number, number, number] = [0, 0, 0];
  const white: [number, number, number] = [255, 255, 255];
  const target =
    contrastRatio(black, backgroundRGB) > contrastRatio(white, backgroundRGB) ? black : white;
  for (let step = 1; step <= 20; step++) {
    const amount = step / 20;
    const candidate = foregroundRGB.map(
      (channel, index) => channel * (1 - amount) + target[index] * amount,
    ) as [number, number, number];
    if (contrastRatio(candidate, backgroundRGB) >= 4.55) return hexToHSL(rgbToHex(...candidate));
  }
  return hexToHSL(rgbToHex(...target));
}

/** Select one source-hue color that has the best joint contrast across all supplied surfaces. */
function ensureContrastAgainstSurfaces(foreground: string, backgrounds: string[]): string {
  const foregroundRGB = hslToRGB(foreground);
  const backgroundRGBs = backgrounds.map(hslToRGB);
  const minimumRatio = (candidate: [number, number, number]) =>
    Math.min(...backgroundRGBs.map((background) => contrastRatio(candidate, background)));
  const MIN_CONTRAST = 4.55;

  if (minimumRatio(foregroundRGB) >= MIN_CONTRAST) return foreground;

  const match = foreground.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!match) return foreground;

  const hue = Number(match[1]);
  let bestPassing: { value: string; distance: number } | undefined;
  let bestFallback = { value: foreground, ratio: minimumRatio(foregroundRGB), distance: 0 };

  for (let saturation = 0; saturation <= 100; saturation++) {
    for (let lightness = 0; lightness <= 100; lightness++) {
      const value = `${hue} ${saturation}% ${lightness}%`;
      const candidate = hslToRGB(value);
      const ratio = minimumRatio(candidate);
      const distance = candidate.reduce(
        (total, channel, index) => total + (channel - foregroundRGB[index]) ** 2,
        0,
      );

      if (ratio >= MIN_CONTRAST) {
        if (!bestPassing || distance < bestPassing.distance) {
          bestPassing = { value, distance };
        }
      } else if (
        ratio > bestFallback.ratio ||
        (ratio === bestFallback.ratio && distance < bestFallback.distance)
      ) {
        bestFallback = { value, ratio, distance };
      }
    }
  }

  return bestPassing?.value ?? bestFallback.value;
}

/**
 * Derive --muted-foreground with contrast enforcement.
 *
 * Strategy:
 * 1. Start with `descriptionForeground` if available (theme author's intent).
 * 2. Fall back to a 60/40 blend of foreground toward background.
 * 3. Verify the candidate has ≥ 3.5:1 contrast against every supplied background
 *    surface (editor bg, sidebar bg, etc.).
 * 4. If it fails, nudge the candidate toward the foreground color in small steps
 *    until the minimum contrast is met.
 */
function deriveMutedForeground({
  fgHex,
  bgHexes,
  descriptionHex,
}: {
  fgHex: string;
  bgHexes: string[];
  descriptionHex?: string;
}): string {
  const fgRGB = hexToRGB(fgHex);
  const bgRGBs = bgHexes.map(hexToRGB);

  // Starting candidate: descriptionForeground or a 60/40 blend
  let candidate: [number, number, number];
  if (descriptionHex) {
    candidate = hexToRGB(descriptionHex);
  } else {
    const [bR, bG, bB] = bgRGBs[0]; // editor.background
    candidate = [fgRGB[0] * 0.6 + bR * 0.4, fgRGB[1] * 0.6 + bG * 0.4, fgRGB[2] * 0.6 + bB * 0.4];
  }

  const MIN_CONTRAST = 4.5; // WCAG AA normal text
  const MAX_STEPS = 20;

  // Check contrast against all background surfaces
  const passesContrast = (c: [number, number, number]) =>
    bgRGBs.every((bg) => contrastRatio(c, bg) >= MIN_CONTRAST);

  // Nudge toward foreground until contrast is met.
  // Blend from the original candidate so each step is a clean interpolation.
  const origin: [number, number, number] = [...candidate];
  for (let step = 0; step < MAX_STEPS && !passesContrast(candidate); step++) {
    const t = (step + 1) / MAX_STEPS; // 0.05, 0.10, … 1.0
    candidate = [
      origin[0] * (1 - t) + fgRGB[0] * t,
      origin[1] * (1 - t) + fgRGB[1] * t,
      origin[2] * (1 - t) + fgRGB[2] * t,
    ];
  }

  return hexToHSL(rgbToHex(...candidate));
}

/**
 * Derive --muted (a background tint) that is perceptibly different from --background.
 *
 * Uses `tab.inactiveBackground` as the starting point. If its lightness is too
 * close to `editor.background`, nudges it away by a minimum delta (6% lightness).
 * Direction is preserved: if the theme intended muted to be darker, it stays darker
 * (and vice-versa). For identical values, dark themes go darker, light themes go lighter.
 */
function deriveMutedBackground(mutedHex: string, bgHex: string, isDark: boolean): string {
  const mutedRGB = hexToRGB(mutedHex);
  const bgRGB = hexToRGB(bgHex);

  const mutedL = relativeLuminance(...mutedRGB);
  const bgL = relativeLuminance(...bgRGB);

  // Minimum perceptible luminance contrast ratio (~6% lightness shift).
  // 1.0 = identical; we want at least 1.12 difference.
  const MIN_RATIO = 1.12;
  const ratio = (Math.max(mutedL, bgL) + 0.05) / (Math.min(mutedL, bgL) + 0.05);

  if (ratio >= MIN_RATIO) {
    // Already distinct enough — use the theme's value as-is
    return hexToHSL(mutedHex);
  }

  // Determine direction: push muted away from bg.
  // If they're nearly identical, dark themes push darker, light themes push lighter.
  const goLighter = mutedL > bgL || (mutedL === bgL && !isDark);

  // Blend toward black or white to increase the difference
  const target: [number, number, number] = goLighter ? [255, 255, 255] : [0, 0, 0];
  const MAX_STEPS = 20;

  let candidate: [number, number, number] = [...mutedRGB];
  for (let step = 1; step <= MAX_STEPS; step++) {
    const t = step / MAX_STEPS; // 0.05 … 1.0
    candidate = [
      mutedRGB[0] * (1 - t) + target[0] * t,
      mutedRGB[1] * (1 - t) + target[1] * t,
      mutedRGB[2] * (1 - t) + target[2] * t,
    ];
    const candL = relativeLuminance(...candidate);
    const candRatio = (Math.max(candL, bgL) + 0.05) / (Math.min(candL, bgL) + 0.05);
    if (candRatio >= MIN_RATIO) break;
  }

  return hexToHSL(rgbToHex(...candidate));
}

/** Derive a quiet decorative hairline from the surface it borders. */
function deriveDecorativeBoundaryColor(surfaceHex: string): string {
  const surfaceRGB = hexToRGB(surfaceHex);
  const target: [number, number, number] = isHexDark(surfaceHex) ? [255, 255, 255] : [0, 0, 0];
  const MIN_RATIO = 1.2;
  const MAX_STEPS = 20;

  let candidate: [number, number, number] = [...surfaceRGB];
  for (let step = 1; step <= MAX_STEPS; step++) {
    const t = step / MAX_STEPS;
    candidate = [
      surfaceRGB[0] * (1 - t) + target[0] * t,
      surfaceRGB[1] * (1 - t) + target[1] * t,
      surfaceRGB[2] * (1 - t) + target[2] * t,
    ];
    if (contrastRatio(candidate, surfaceRGB) >= MIN_RATIO) break;
  }

  return hexToHSL(rgbToHex(...candidate));
}

/**
 * Ensure a control boundary is perceptibly different from every surface it can touch.
 *
 * Boundaries need at least 3:1 contrast against every surface they can touch.
 * If a theme color is too close, nudge it away while preserving its hue direction.
 */
function deriveControlBoundaryColor(
  borderHex: string,
  surfaceHexes: string[],
  isDark: boolean,
): string {
  const borderRGB = hexToRGB(borderHex);
  const surfaceRGBs = surfaceHexes.map(hexToRGB);

  const MIN_RATIO = 3.1;
  const minimumRatio = (candidate: [number, number, number]) =>
    Math.min(...surfaceRGBs.map((surface) => contrastRatio(candidate, surface)));

  if (minimumRatio(borderRGB) >= MIN_RATIO) {
    return hexToHSL(borderHex);
  }

  // A theme-relative direction guarantees enough contrast at the luminance extremes.
  const goLighter = isDark;
  const target: [number, number, number] = goLighter ? [255, 255, 255] : [0, 0, 0];
  const MAX_STEPS = 20;

  let candidate: [number, number, number] = [...borderRGB];
  for (let step = 1; step <= MAX_STEPS; step++) {
    const t = step / MAX_STEPS;
    candidate = [
      borderRGB[0] * (1 - t) + target[0] * t,
      borderRGB[1] * (1 - t) + target[1] * t,
      borderRGB[2] * (1 - t) + target[2] * t,
    ];
    if (minimumRatio(candidate) >= MIN_RATIO) break;
  }

  return hexToHSL(rgbToHex(...candidate));
}

/**
 * Derive --accent (subtle hover background) and --accent-foreground (interactive text)
 * from the theme's focus/accent color.
 *
 * VS Code badge colors are inverted (bright bg + dark fg) which doesn't work for
 * the app's accent pattern (subtle bg + readable fg). Instead we use focusBorder
 * (or button.background as fallback) as the accent hue source:
 *   --accent:            a low-opacity tint of the accent color blended with the bg
 *   --accent-foreground: the accent color itself, contrast-enforced against the bg
 */
function deriveAccentColors(
  colors: Record<string, string>,
): { accent: string; accentForeground: string } | null {
  const bg = colors['editor.background'];
  if (!bg) return null;

  // Pick the theme's interactive accent color
  const accentSource =
    colors['focusBorder'] ?? colors['button.background'] ?? colors['badge.background'];
  if (!accentSource) return null;

  const bgRGB = hexToRGB(bg);
  const accentRGB = hexToRGB(accentSource);
  const isDark = isHexDark(bg);

  // --accent: subtle tint — blend 10-12% of the accent color into the background
  const tintAmount = isDark ? 0.12 : 0.08;
  const accentBg: [number, number, number] = [
    bgRGB[0] * (1 - tintAmount) + accentRGB[0] * tintAmount,
    bgRGB[1] * (1 - tintAmount) + accentRGB[1] * tintAmount,
    bgRGB[2] * (1 - tintAmount) + accentRGB[2] * tintAmount,
  ];

  // --accent-foreground: the accent color, nudged toward fg if contrast is too low
  const fgRGB = hexToRGB(colors['editor.foreground'] ?? (isDark ? '#ffffff' : '#000000'));
  let candidate: [number, number, number] = [...accentRGB];

  const MIN_CONTRAST = 4.5; // WCAG AA
  const MAX_STEPS = 20;

  // Check contrast against both the page background and the accent background
  const passesContrast = (c: [number, number, number]) =>
    contrastRatio(c, bgRGB) >= MIN_CONTRAST && contrastRatio(c, accentBg) >= 3.0;

  const origin: [number, number, number] = [...candidate];
  for (let step = 0; step < MAX_STEPS && !passesContrast(candidate); step++) {
    const t = (step + 1) / MAX_STEPS;
    candidate = [
      origin[0] * (1 - t) + fgRGB[0] * t,
      origin[1] * (1 - t) + fgRGB[1] * t,
      origin[2] * (1 - t) + fgRGB[2] * t,
    ];
  }

  return {
    accent: hexToHSL(rgbToHex(...accentBg)),
    accentForeground: hexToHSL(rgbToHex(...candidate)),
  };
}

/**
 * Build CSS variable map from VS Code colors.
 * Returns Record<string, string> where keys are CSS variable names (e.g. "--background")
 * and values are HSL strings (e.g. "210 50% 40%").
 */
function buildCSSVariables(
  colors: Record<string, string>,
  isDark: boolean,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [vsKey, cssVar] of VSCODE_TO_CSS_MAP) {
    // Skip if we already mapped this CSS variable (first match wins)
    if (result[cssVar]) continue;

    const hex = colors[vsKey];
    if (hex) {
      result[cssVar] = hexToHSL(hex);
    }
  }

  // Derive --accent and --accent-foreground from the theme's interactive accent color
  const accentColors = deriveAccentColors(colors);
  if (accentColors) {
    result['--accent'] = accentColors.accent;
    result['--accent-foreground'] = accentColors.accentForeground;
  }

  // Derive --muted-foreground using the theme's descriptionForeground as a
  // starting point, with contrast enforcement against all background surfaces.
  const fg = colors['editor.foreground'];
  const bg = colors['editor.background'];
  if (fg && bg) {
    const bgHexes = [bg];
    if (colors['sideBar.background']) bgHexes.push(colors['sideBar.background']);
    if (colors['editorWidget.background']) bgHexes.push(colors['editorWidget.background']);
    result['--muted-foreground'] = deriveMutedForeground({
      fgHex: fg,
      bgHexes,
      descriptionHex: colors['descriptionForeground'],
    });

    // Derive --muted background tint from tab.inactiveBackground (or sideBar.background
    // as fallback), ensuring a perceptible lightness shift from --background.
    const mutedSource = colors['tab.inactiveBackground'] ?? colors['sideBar.background'] ?? bg;
    const isDark = isHexDark(bg);
    result['--muted'] = deriveMutedBackground(mutedSource, bg, isDark);

    // Preserve decorative borders from the source theme; normalize only controls and focus.
    const boundarySurfaces = [
      bg,
      colors['editorWidget.background'],
      colors['dropdown.background'],
      colors['sideBar.background'],
    ].filter((color): color is string => Boolean(color));
    const borderSource = colors['panel.border'] ?? colors['editorGroup.border'];
    const inputSource = colors['input.border'] ?? colors['input.background'] ?? borderSource ?? bg;
    result['--input'] = deriveControlBoundaryColor(inputSource, boundarySurfaces, isDark);
    const ringSource = colors['focusBorder'] ?? colors['button.background'] ?? borderSource ?? bg;
    result['--ring'] = deriveControlBoundaryColor(ringSource, boundarySurfaces, isDark);

    // Derive --text-subtle and --text-ghost from the theme's fg/bg.
    // --text-subtle: readable secondary text between muted-foreground and foreground (≥4.5:1 contrast).
    // --text-ghost: decorative/faint text between muted-foreground and background.
    const fgRGB = hexToRGB(fg);
    const bgRGB = hexToRGB(bg);

    // --text-subtle: blend 40% from fg toward bg, then nudge toward fg until contrast ≥ 4.5:1
    {
      const subtleBlend: [number, number, number] = [
        fgRGB[0] * 0.6 + bgRGB[0] * 0.4,
        fgRGB[1] * 0.6 + bgRGB[1] * 0.4,
        fgRGB[2] * 0.6 + bgRGB[2] * 0.4,
      ];
      let candidate: [number, number, number] = [...subtleBlend];
      const MIN_CONTRAST = 4.5;
      const MAX_STEPS = 20;
      for (let step = 0; step < MAX_STEPS; step++) {
        if (contrastRatio(candidate, bgRGB) >= MIN_CONTRAST) break;
        const t = (step + 1) / MAX_STEPS;
        candidate = [
          subtleBlend[0] * (1 - t) + fgRGB[0] * t,
          subtleBlend[1] * (1 - t) + fgRGB[1] * t,
          subtleBlend[2] * (1 - t) + fgRGB[2] * t,
        ];
      }
      result['--text-subtle'] = hexToHSL(rgbToHex(...candidate));
    }

    // --text-ghost: blend 65% from bg toward fg (faint), ensure ≥ 2:1 contrast for minimal visibility
    {
      const ghostBlend: [number, number, number] = [
        bgRGB[0] * 0.65 + fgRGB[0] * 0.35,
        bgRGB[1] * 0.65 + fgRGB[1] * 0.35,
        bgRGB[2] * 0.65 + fgRGB[2] * 0.35,
      ];
      let candidate: [number, number, number] = [...ghostBlend];
      const MIN_CONTRAST = 2.0;
      const MAX_STEPS = 15;
      for (let step = 0; step < MAX_STEPS; step++) {
        if (contrastRatio(candidate, bgRGB) >= MIN_CONTRAST) break;
        const t = (step + 1) / MAX_STEPS;
        candidate = [
          ghostBlend[0] * (1 - t) + fgRGB[0] * t,
          ghostBlend[1] * (1 - t) + fgRGB[1] * t,
          ghostBlend[2] * (1 - t) + fgRGB[2] * t,
        ];
      }
      result['--text-ghost'] = hexToHSL(rgbToHex(...candidate));
    }
  } else if (colors['descriptionForeground']) {
    result['--muted-foreground'] = hexToHSL(colors['descriptionForeground']);
  }

  if (bg) {
    result['--border'] ??= deriveDecorativeBoundaryColor(bg);
    result['--sidebar-border'] ??= deriveDecorativeBoundaryColor(
      colors['sideBar.background'] ?? bg,
    );
  }

  const defaults = isDark
    ? {
        background: '#1f1f24',
        foreground: '#f7f7f7',
        primary: '#009966',
        primaryForeground: '#171717',
        secondary: '#1c1c1c',
        secondaryForeground: '#f7f7f7',
        muted: '#121217',
        mutedForeground: '#b8b5c2',
        accent: '#182c25',
        accentForeground: '#7de3bd',
        danger: '#f38b8b',
        dangerBackground: '#361010',
        border: '#4d4a52',
        input: '#121217',
        ring: '#6eddb4',
        info: '#72d2fa',
        infoForeground: '#171717',
        success: '#22c55e',
        successForeground: '#171717',
        warning: '#facc15',
        warningForeground: '#171717',
        sidebar: '#0d0d10',
        sidebarForeground: '#f7f7f7',
        sidebarAccent: '#242424',
        sidebarBorder: '#4d4a52',
      }
    : {
        background: '#ffffff',
        foreground: '#171717',
        primary: '#007a4d',
        primaryForeground: '#ffffff',
        secondary: '#f5f5f5',
        secondaryForeground: '#171717',
        muted: '#e8e8e8',
        mutedForeground: '#474747',
        accent: '#e7f3ee',
        accentForeground: '#00663f',
        danger: '#930b0b',
        dangerBackground: '#fde7e7',
        border: '#d9d9d9',
        input: '#e6e6e6',
        ring: '#006ac2',
        info: '#006ac2',
        infoForeground: '#ffffff',
        success: '#117a37',
        successForeground: '#ffffff',
        warning: '#dc9400',
        warningForeground: '#171717',
        sidebar: '#f7f7f8',
        sidebarForeground: '#171717',
        sidebarAccent: '#e8e8e8',
        sidebarBorder: '#d9d9d9',
      };
  const value = (name: keyof typeof defaults) => hexToHSL(defaults[name]);
  result['--background'] ??= value('background');
  result['--foreground'] ??= value('foreground');
  result['--card'] ??= result['--background'];
  result['--card-foreground'] ??= result['--foreground'];
  result['--popover'] ??= result['--card'];
  result['--popover-foreground'] ??= result['--card-foreground'];
  result['--primary'] ??= value('primary');
  result['--primary-foreground'] ??= value('primaryForeground');
  result['--secondary'] ??= value('secondary');
  result['--secondary-foreground'] ??= value('secondaryForeground');
  result['--muted'] ??= value('muted');
  result['--muted-foreground'] ??= value('mutedForeground');
  result['--accent'] ??= value('accent');
  result['--accent-foreground'] ??= value('accentForeground');
  result['--danger'] ??= value('danger');
  result['--danger-background'] ??= value('dangerBackground');
  result['--border'] ??= value('border');
  result['--input'] ??= value('input');
  result['--ring'] ??= value('ring');
  result['--info'] = hexToHSL(colors['editorInfo.foreground'] ?? defaults.info);
  result['--info-foreground'] = value('infoForeground');
  result['--success'] = hexToHSL(
    colors['testing.iconPassed'] ??
      colors['gitDecoration.addedResourceForeground'] ??
      defaults.success,
  );
  result['--success-foreground'] = value('successForeground');
  result['--warning'] = hexToHSL(colors['editorWarning.foreground'] ?? defaults.warning);
  result['--warning-foreground'] = value('warningForeground');
  result['--sidebar'] ??= value('sidebar');
  result['--sidebar-foreground'] ??= value('sidebarForeground');
  result['--sidebar-accent'] = result['--secondary'] ?? value('sidebarAccent');
  result['--sidebar-accent-foreground'] = result['--sidebar-foreground'];
  result['--sidebar-border'] ??= value('sidebarBorder');

  const pairs = [
    ['--foreground', '--background'],
    ['--card-foreground', '--card'],
    ['--popover-foreground', '--popover'],
    ['--primary-foreground', '--primary'],
    ['--secondary-foreground', '--secondary'],
    ['--accent-foreground', '--accent'],
    ['--muted-foreground', '--muted'],
    ['--info-foreground', '--info'],
    ['--success-foreground', '--success'],
    ['--warning-foreground', '--warning'],
    ['--sidebar-foreground', '--sidebar'],
    ['--sidebar-accent-foreground', '--sidebar-accent'],
  ] as const;
  for (const [foreground, background] of pairs) {
    result[foreground] = ensureContrast(result[foreground], result[background]);
  }
  const dangerSurfaces = [
    '--danger-background',
    '--background',
    '--card',
    '--popover',
    '--muted',
    '--sidebar',
  ] as const;
  const dangerSource = result['--danger'];
  result['--danger'] = ensureContrastAgainstSurfaces(
    dangerSource,
    dangerSurfaces.map((surface) => result[surface]),
  );
  const dangerRGB = hslToRGB(result['--danger']);
  const hasLegibleDanger = dangerSurfaces.every(
    (surface) => contrastRatio(dangerRGB, hslToRGB(result[surface])) >= 4.55,
  );
  if (!hasLegibleDanger) {
    // A neutral supporting surface makes extreme mixed light/dark imports solvable.
    result['--danger-background'] = result['--background'];
    result['--danger'] = ensureContrastAgainstSurfaces(
      dangerSource,
      dangerSurfaces.map((surface) => result[surface]),
    );
  }
  return result;
}

// ── Terminal ANSI color mapping ────────────────────────────────────────────

const TERMINAL_COLOR_MAP: [string, keyof ITheme][] = [
  ['terminal.background', 'background'],
  ['terminal.foreground', 'foreground'],
  ['terminal.selectionBackground', 'selectionBackground'],
  ['terminal.selectionForeground', 'selectionForeground'],
  ['terminalCursor.foreground', 'cursor'],
  ['terminalCursor.background', 'cursorAccent'],
  ['terminal.ansiBlack', 'black'],
  ['terminal.ansiRed', 'red'],
  ['terminal.ansiGreen', 'green'],
  ['terminal.ansiYellow', 'yellow'],
  ['terminal.ansiBlue', 'blue'],
  ['terminal.ansiMagenta', 'magenta'],
  ['terminal.ansiCyan', 'cyan'],
  ['terminal.ansiWhite', 'white'],
  ['terminal.ansiBrightBlack', 'brightBlack'],
  ['terminal.ansiBrightRed', 'brightRed'],
  ['terminal.ansiBrightGreen', 'brightGreen'],
  ['terminal.ansiBrightYellow', 'brightYellow'],
  ['terminal.ansiBrightBlue', 'brightBlue'],
  ['terminal.ansiBrightMagenta', 'brightMagenta'],
  ['terminal.ansiBrightCyan', 'brightCyan'],
  ['terminal.ansiBrightWhite', 'brightWhite'],
];

/**
 * Build terminal theme from VS Code colors.
 * Returns hex colors (not HSL) since xterm expects hex/CSS color strings.
 */
function buildTerminalColors(colors: Record<string, string>): Partial<ITheme> {
  const result: Partial<ITheme> = {};

  for (const [vsKey, xtermKey] of TERMINAL_COLOR_MAP) {
    const hex = colors[vsKey];
    if (hex) {
      (result as Record<string, string>)[xtermKey] = hex;
    }
  }

  return result;
}

// ── Monaco theme builder ───────────────────────────────────────────────────

/**
 * Strip the leading '#' from a hex color for Monaco token rules.
 * Monaco expects foreground/background as bare hex digits (e.g. "569cd6").
 */
function stripHash(hex: string): string {
  return hex.replace(/^#/, '');
}

/**
 * Build a Monaco IStandaloneThemeData from VS Code theme JSON.
 */
function buildMonacoTheme(themeJSON: VSCodeThemeJSON, isDark: boolean): MonacoStandaloneThemeData {
  const base: MonacoStandaloneThemeData['base'] = isDark ? 'vs-dark' : 'vs';

  // Convert tokenColors to Monaco rules
  const rules: MonacoTokenRule[] = [];

  if (themeJSON.tokenColors) {
    for (const tc of themeJSON.tokenColors) {
      const scopes = Array.isArray(tc.scope) ? tc.scope : tc.scope ? [tc.scope] : [''];

      for (const scope of scopes) {
        const rule: MonacoTokenRule = { token: scope };

        if (tc.settings.foreground) {
          rule.foreground = stripHash(tc.settings.foreground);
        }
        if (tc.settings.background) {
          rule.background = stripHash(tc.settings.background);
        }
        if (tc.settings.fontStyle) {
          rule.fontStyle = tc.settings.fontStyle;
        }

        rules.push(rule);
      }
    }
  }

  // Pass through all colors from the VS Code theme to Monaco
  const colors: Record<string, string> = {};
  if (themeJSON.colors) {
    for (const [key, value] of Object.entries(themeJSON.colors)) {
      colors[key] = value;
    }
  }

  return { base, inherit: true, rules, colors };
}

// ── JSONC stripping ───────────────────────────────────────────────────────

/**
 * Strip JSONC (JSON with Comments) syntax to produce valid JSON.
 *
 * Removes:
 * - Single-line comments (`// ...` to end of line)
 * - Block comments (`/* ... *​/`)
 * - Trailing commas before `]` or `}`
 *
 * Uses a character-by-character state machine so that comment-like sequences
 * inside JSON string values (e.g. `"url": "https://example.com"`) are preserved.
 */
export function stripJSONC(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const ch = text[i];

    // Inside a JSON string — pass through, watching for escapes and closing quote
    if (inString) {
      if (ch === '\\') {
        // Escaped character — copy both the backslash and the next char
        result += ch + (text[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      result += ch;
      i++;
      continue;
    }

    // Not in a string
    if (ch === '"') {
      inString = true;
      result += ch;
      i++;
      continue;
    }

    // Check for single-line comment
    if (ch === '/' && text[i + 1] === '/') {
      // Skip until end of line
      i += 2;
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Check for block comment
    if (ch === '/' && text[i + 1] === '*') {
      // Skip until closing */
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      // Skip past the closing */
      i += 2;
      continue;
    }

    result += ch;
    i++;
  }

  // Remove trailing commas before ] or } (with optional whitespace between)
  result = result.replace(/,(\s*[}\]])/g, '$1');

  return result;
}

// ── Main parser ────────────────────────────────────────────────────────────

/**
 * Parse a VS Code color theme JSON object and produce all three theme artifacts.
 *
 * @param json - The raw VS Code theme JSON (must contain at least `colors` or `tokenColors`)
 * @returns ParsedVSCodeTheme with cssVariables, monacoTheme, and terminalColors
 * @throws Error if the input is not a valid VS Code theme
 */
export function parseVSCodeTheme(json: unknown): ParsedVSCodeTheme {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid theme: expected an object');
  }

  const themeJSON = json as VSCodeThemeJSON;

  if (!themeJSON.colors && !themeJSON.tokenColors) {
    throw new Error('Invalid theme: must contain "colors" or "tokenColors"');
  }

  const colors = themeJSON.colors ?? {};

  // Detect theme type
  let isDark: boolean;
  if (themeJSON.type === 'light' || themeJSON.type === 'hc-light') {
    isDark = false;
  } else if (themeJSON.type === 'dark' || themeJSON.type === 'hc-black') {
    isDark = true;
  } else if (colors['editor.background']) {
    isDark = isHexDark(colors['editor.background']);
  } else {
    isDark = true; // default to dark
  }

  const name = themeJSON.name ?? m.settings_themeImport_fallbackName_label();

  return {
    name,
    type: isDark ? 'dark' : 'light',
    cssVariables: buildCSSVariables(colors, isDark),
    monacoTheme: buildMonacoTheme(themeJSON, isDark),
    terminalColors: buildTerminalColors(colors),
    rawColors: { ...colors },
  };
}
