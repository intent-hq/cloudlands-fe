import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { themePresets } from '../../utils/theme-presets';
import { parseVSCodeTheme } from '../../utils/vscode-theme-parser';

const COLOR_ROLES = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'accent',
  'accent-foreground',
  'muted',
  'muted-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'info',
  'info-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'sidebar',
  'sidebar-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
] as const;

const CONTRAST_PAIRS = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['muted-foreground', 'muted'],
  ['destructive-foreground', 'destructive'],
  ['info-foreground', 'info'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
] as const;

const COLOR_ROLE_SET = new Set<string>(COLOR_ROLES);

function hslChannels(value: string): [number, number, number] {
  const match = value.match(/^(?:hsl\()?([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)?$/);
  if (!match) throw new Error(`Invalid HSL color: ${value}`);
  return match.slice(1).map(Number) as [number, number, number];
}

function parseHsl(value: string): [number, number, number] {
  const [hue, saturation, lightness] = hslChannels(value);
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

function contrast(first: string, second: string): number {
  const luminance = (value: string) => {
    const channels = parseHsl(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function tokenValues(css: string, mode: 'light' | 'dark'): Record<string, string> {
  return Object.fromEntries(
    [...css.matchAll(new RegExp(`--theme-${mode}-([\\w-]+):\\s*([^;]+);`, 'g'))]
      .map(([, role, value]) => [role, value.trim().replace(/^hsl\((.*)\)$/, '$1')])
      .filter(([role]) => COLOR_ROLE_SET.has(role)),
  );
}

function tokenValue(css: string, name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing token --${name}`);
  return match[1].trim();
}

function expectCompleteAndLegible(values: Record<string, string>): void {
  expect(Object.keys(values).sort()).toEqual([...COLOR_ROLES].sort());
  for (const [foreground, background] of CONTRAST_PAIRS) {
    expect(
      contrast(values[foreground], values[background]),
      `${foreground} on ${background}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
  for (const control of ['input', 'ring'] as const) {
    for (const surface of ['background', 'card', 'popover', 'sidebar'] as const) {
      expect(
        contrast(values[control], values[surface]),
        `${control} on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
}

describe('theme color contract', () => {
  it('loads every stylesheet before Tailwind directives so PostCSS does not drop imports', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/app.css'), 'utf8');
    const lastImport = css.lastIndexOf('@import ');

    expect(css).toContain("@import '$lib/styles/tokens.css';");
    expect(lastImport).toBeLessThan(css.indexOf('@plugin '));
    expect(lastImport).toBeLessThan(css.indexOf('@custom-variant '));
  });

  it.each(['light', 'dark'] as const)(
    'defines computed %s colors for every approved role',
    (mode) => {
      const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
      expectCompleteAndLegible(tokenValues(css, mode));
    },
  );

  it('lets light, dark, and system modes select the same semantic contract', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
    expect(css).toMatch(/:root\s*{[^}]*color-scheme:\s*light dark/s);
    expect(css).toMatch(/\.light\s*{[^}]*color-scheme:\s*light/s);
    expect(css).toMatch(/\.dark\s*{[^}]*color-scheme:\s*dark/s);
    expect(css).not.toContain('@media (prefers-color-scheme: dark)');
    for (const role of COLOR_ROLES) {
      expect(css.match(new RegExp(`--${role}:`, 'g'))).toHaveLength(1);
      expect(css).toContain(`--color-${role}: hsl(var(--${role}))`);
    }
  });

  it('uses the Operate forest, sage, green, and violet families with ordered surfaces', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
    const light = tokenValues(css, 'light');
    const dark = tokenValues(css, 'dark');
    const [lightForegroundHue, lightForegroundSaturation, lightForegroundLightness] = hslChannels(
      light.foreground,
    );
    expect(lightForegroundHue).toBeGreaterThanOrEqual(140);
    expect(lightForegroundHue).toBeLessThanOrEqual(165);
    expect(lightForegroundSaturation).toBeGreaterThanOrEqual(25);
    expect(lightForegroundLightness).toBeLessThanOrEqual(20);
    for (const values of [light, dark]) {
      for (const role of ['primary', 'success'] as const) {
        const [hue, saturation] = hslChannels(values[role]);
        expect(hue, role).toBeGreaterThanOrEqual(130);
        expect(hue, role).toBeLessThanOrEqual(165);
        expect(saturation, role).toBeGreaterThanOrEqual(45);
      }
      for (const role of ['ring', 'info'] as const) {
        const [hue, saturation] = hslChannels(values[role]);
        expect(hue, role).toBeGreaterThanOrEqual(250);
        expect(hue, role).toBeLessThanOrEqual(285);
        expect(saturation, role).toBeGreaterThanOrEqual(45);
      }
    }
    expect(hslChannels(light.background)[2]).toBe(100);
    expect(hslChannels(light.card)[2]).toBeGreaterThanOrEqual(hslChannels(light.background)[2]);
    expect(hslChannels(light.background)[2]).toBeGreaterThan(hslChannels(light.sidebar)[2]);
    expect(hslChannels(light.accent)[2]).toBeLessThan(hslChannels(light.sidebar)[2]);
    expect(hslChannels(dark.popover)[2]).toBeGreaterThan(hslChannels(dark.card)[2]);
    expect(hslChannels(dark.card)[2]).toBeGreaterThan(hslChannels(dark.background)[2]);
  });

  it.each(['light', 'dark'] as const)('keeps %s control boundaries and focus at 3:1', (mode) => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
    const values = tokenValues(css, mode);
    for (const control of ['input', 'ring'] as const) {
      for (const surface of ['background', 'card', 'popover', 'sidebar'] as const) {
        expect(
          contrast(values[control], values[surface]),
          `${control} on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it.each(['light', 'dark'] as const)('keeps %s decorative borders quiet', (mode) => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
    const values = tokenValues(css, mode);
    expect(values.border).not.toBe(values.input);
    for (const surface of ['background', 'card', 'popover'] as const) {
      expect(contrast(values.border, values[surface]), `border on ${surface}`).toBeGreaterThan(1.1);
      expect(contrast(values.border, values[surface]), `border on ${surface}`).toBeLessThan(2.25);
    }
    expect(
      contrast(values['sidebar-border'], values.sidebar),
      'sidebar-border on sidebar',
    ).toBeGreaterThan(1.1);
    expect(
      contrast(values['sidebar-border'], values.sidebar),
      'sidebar-border on sidebar',
    ).toBeLessThan(2.25);
  });

  it.each(themePresets.flatMap((preset) => [preset.dark, preset.light]))(
    'maps preset $name to complete computed colors without changing terminal colors',
    (theme) => {
      const parsed = parseVSCodeTheme(theme);
      expectCompleteAndLegible(
        Object.fromEntries(COLOR_ROLES.map((role) => [role, parsed.cssVariables[`--${role}`]])),
      );
      expect(parsed.terminalColors.background).toBe(theme.colors['terminal.background']);
      expect(parsed.terminalColors.red).toBe(theme.colors['terminal.ansiRed']);
    },
  );

  it('makes a sparse, low-contrast imported theme complete while keeping terminal colors separate', () => {
    const parsed = parseVSCodeTheme({
      type: 'hc-black',
      colors: {
        'editor.background': '#000000',
        'editor.foreground': '#111111',
        'terminal.background': '#010203',
        'terminal.ansiRed': '#aabbcc',
      },
    });
    expectCompleteAndLegible(
      Object.fromEntries(COLOR_ROLES.map((role) => [role, parsed.cssVariables[`--${role}`]])),
    );
    expect(parsed.terminalColors).toMatchObject({ background: '#010203', red: '#aabbcc' });
    expect(parsed.cssVariables['--background']).not.toBe(parsed.terminalColors.background);
  });

  it('defines the centralized typography, density, shape, elevation, motion, and layer scales', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
    for (const token of [
      'font-ui',
      'font-code',
      'text-caption-size',
      'text-caption-line-height',
      'text-caption-weight',
      'text-caption-tracking',
      'text-label-size',
      'text-label-line-height',
      'text-label-weight',
      'text-label-tracking',
      'text-body-size',
      'text-body-line-height',
      'text-body-weight',
      'text-body-tracking',
      'text-body-strong-size',
      'text-body-strong-line-height',
      'text-body-strong-weight',
      'text-title-size',
      'text-title-line-height',
      'text-title-weight',
      'text-display-size',
      'text-display-line-height',
      'text-display-weight',
      'control-height-compact',
      'control-height-small',
      'control-height-medium',
      'control-height-large',
      'radius-small',
      'radius-medium',
      'radius-large',
      'radius-full',
      'elevation-raised',
      'elevation-overlay',
      'motion-fast',
      'motion-standard',
      'motion-slow',
      'ease-standard',
      'ease-emphasized-out',
      'layer-base',
      'layer-sticky',
      'layer-chrome',
      'layer-popover',
      'layer-modal',
      'layer-toast',
      'layer-tooltip',
      'layer-drag-overlay',
      'space-1',
      'space-2',
      'space-3',
      'space-4',
      'space-5',
      'space-6',
      'space-7',
      'content-measure-reading',
      'content-measure-form',
      'content-measure-wide',
      'surface-hatch',
    ])
      expect(css).toContain(`--${token}:`);
    expect(tokenValue(css, 'control-height-compact')).toBe('1.75rem');
    expect(tokenValue(css, 'control-height-small')).toBe('1.75rem');
    expect(tokenValue(css, 'control-height-medium')).toBe('2rem');
    expect(tokenValue(css, 'control-height-large')).toBe('2.25rem');
    expect(tokenValue(css, 'radius-small')).toBe('5px');
    expect(tokenValue(css, 'radius-medium')).toBe('7px');
    expect(tokenValue(css, 'radius-large')).toBe('9px');
    expect(tokenValue(css, 'surface-hatch')).toContain('repeating-linear-gradient');
    for (const role of ['background', 'muted', 'border']) {
      expect(tokenValue(css, 'surface-hatch')).toContain(`var(--${role})`);
    }
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0\.01ms/,
    );
  });

  it('uses distinct black elevation shadows for light and dark surfaces', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
    const lightRaised = tokenValue(css, 'theme-light-elevation-raised');
    const lightOverlay = tokenValue(css, 'theme-light-elevation-overlay');
    const darkRaised = tokenValue(css, 'theme-dark-elevation-raised');
    const darkOverlay = tokenValue(css, 'theme-dark-elevation-overlay');

    for (const shadow of [lightRaised, lightOverlay, darkRaised, darkOverlay]) {
      expect(shadow).toContain('rgb(0 0 0 /');
      expect(shadow).not.toContain('var(--foreground)');
    }
    expect(lightRaised).not.toBe(lightOverlay);
    expect(darkRaised).not.toBe(darkOverlay);
    expect(tokenValue(css, 'elevation-raised')).toBe('var(--theme-light-elevation-raised)');
    expect(tokenValue(css, 'elevation-overlay')).toBe('var(--theme-light-elevation-overlay)');
    expect(css).toMatch(
      /\.dark\s*{[^}]*--elevation-raised:\s*var\(--theme-dark-elevation-raised\)/s,
    );
    expect(css).toMatch(
      /\.dark\s*{[^}]*--elevation-overlay:\s*var\(--theme-dark-elevation-overlay\)/s,
    );
  });

  it('limits product typography to five canonical styles with compatibility aliases', () => {
    const tokens = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/styles/tokens.css'),
      'utf8',
    );
    const appCss = fs.readFileSync(path.resolve(process.cwd(), 'src/app.css'), 'utf8');

    for (const role of ['caption', 'body', 'title', 'display', 'code']) {
      expect(appCss).toContain(`.type-${role} {`);
      expect(tokens).toContain(`--text-${role}-size:`);
    }
    expect(tokens).toContain('--text-label-size: var(--text-caption-size);');
    expect(tokens).toContain('--text-body-strong-size: var(--text-body-size);');
    expect(tokens).toContain('--text-display-large-size: var(--text-display-size);');
    expect(tokens).toContain('--text-body-size: 0.9375rem;');
    expect(tokens).toContain('--text-caption-tracking: -0.01em;');
    for (const role of ['body', 'title', 'display']) {
      expect(tokens).toContain(`--text-${role}-tracking: -0.016em;`);
    }
    expect(appCss).toMatch(/body\s*\{[^}]*font-size:\s*var\(--text-body-size\)/s);
    expect(appCss).not.toMatch(/html,\s*body\s*\{[^}]*font-size:/s);
  });
});
