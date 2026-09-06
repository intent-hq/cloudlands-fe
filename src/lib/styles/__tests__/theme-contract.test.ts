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
  'danger',
  'danger-background',
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
  ['danger', 'danger-background'],
  ['info-foreground', 'info'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
] as const;

const COLOR_ROLE_SET = new Set<string>(COLOR_ROLES);

const DEFAULT_NEUTRAL_SOURCE = {
  light: {
    background: '0 0% 100%',
    foreground: '0 0% 0%',
    card: '0 0% 100%',
    'card-foreground': '0 0% 0%',
    popover: '60 5% 92.1568627451%',
    'popover-foreground': '0 0% 0%',
    secondary: '0 0% 89.8039215686%',
    'secondary-foreground': '0 0% 0%',
    accent: '20 4.7619047619% 87.6470588235%',
    'accent-foreground': '0 0% 0%',
    muted: '20 4.7619047619% 87.6470588235%',
    'muted-foreground': '60 0.826446281% 27.7254901961%',
    border: '20 4.7619047619% 87.6470588235%',
    input: '0 0% 0%',
    sidebar: '0 0% 96%',
    'sidebar-foreground': '0 0% 0%',
    'sidebar-accent': '20 4.7619047619% 87.6470588235%',
    'sidebar-accent-foreground': '0 0% 0%',
    'sidebar-border': '20 4.7619047619% 87.6470588235%',
    'app-background': '0 0% 100%',
  },
  dark: {
    background: '0 0% 10.1960784314%',
    foreground: '0 0% 100%',
    card: '0 0% 10.1960784314%',
    'card-foreground': '0 0% 100%',
    popover: '0 0% 14.9019607843%',
    'popover-foreground': '0 0% 100%',
    secondary: '0 0% 14.9019607843%',
    'secondary-foreground': '20 4.7619047619% 87.6470588235%',
    accent: '60 0.826446281% 23.7254901961%',
    'accent-foreground': '20 4.7619047619% 87.6470588235%',
    muted: '0 0% 14.9019607843%',
    'muted-foreground': '20 4.7619047619% 83.6470588235%',
    border: '60 0.826446281% 23.7254901961%',
    input: '20 4.7619047619% 87.6470588235%',
    sidebar: '0 0% 14.9019607843%',
    'sidebar-foreground': '0 0% 100%',
    'sidebar-accent': '60 0.826446281% 23.7254901961%',
    'sidebar-accent-foreground': '20 4.7619047619% 87.6470588235%',
    'sidebar-border': '60 0.826446281% 23.7254901961%',
    'app-background': '0 0% 10.1960784314%',
  },
} as const;

const PRESERVED_SEMANTIC_SOURCE = {
  'theme-light-primary': '145 67% 28%',
  'theme-light-primary-foreground': '0 0% 100%',
  'theme-light-danger': '0 63% 31%',
  'theme-light-danger-background': '0 65% 94%',
  'theme-light-ring': '217.2 91.2% 59.8%',
  'theme-light-info': '260 58% 46%',
  'theme-light-info-foreground': '0 0% 100%',
  'theme-light-success': '145 67% 28%',
  'theme-light-success-foreground': '0 0% 100%',
  'theme-light-warning': '42 91% 54%',
  'theme-light-warning-foreground': '154 44% 14%',
  'theme-light-agent-avatar-surface-completed': '145 14% 88%',
  'theme-light-agent-avatar-foreground-completed': '154 32% 24%',
  'theme-light-agent-avatar-surface-attention': '30.785 100% 62.549%',
  'theme-light-agent-avatar-surface-failed': '0 72% 62%',
  'theme-light-agent-avatar-surface-active': '66.892 71.845% 59.608%',
  'theme-light-workspace-status-unread': '217.2 91.2% 59.8%',
  'theme-light-agent-avatar-surface-waiting': '263.2 74.257% 80.196%',
  'theme-dark-primary': '145 58% 55%',
  'theme-dark-primary-foreground': '154 25% 9%',
  'theme-dark-danger': '0 70% 88%',
  'theme-dark-danger-background': '0 35% 22%',
  'theme-dark-ring': '213.1 93.9% 67.8%',
  'theme-dark-info': '260 80% 72%',
  'theme-dark-info-foreground': '154 25% 9%',
  'theme-dark-success': '145 58% 55%',
  'theme-dark-success-foreground': '154 25% 9%',
  'theme-dark-warning': '42 91% 63%',
  'theme-dark-warning-foreground': '154 25% 9%',
  'theme-dark-agent-avatar-surface-completed': '145 14% 24%',
  'theme-dark-agent-avatar-foreground-completed': '135 20% 86%',
  'theme-dark-agent-avatar-surface-attention': '31 100% 70%',
  'theme-dark-agent-avatar-surface-failed': '0 79% 70%',
  'theme-dark-agent-avatar-surface-active': '67 78% 68%',
  'theme-dark-workspace-status-unread': '213.1 93.9% 67.8%',
  'theme-dark-agent-avatar-surface-waiting': '259.024 64.063% 74.902%',
} as const;

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
      .map(([, role, value]) => [
        role,
        resolveTokenValue(css, value.trim().replace(/^hsl\((.*)\)$/, '$1')),
      ])
      .filter(([role]) => COLOR_ROLE_SET.has(role)),
  );
}

function tokenValue(css: string, name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing token --${name}`);
  return match[1].trim();
}

function resolveTokenValue(css: string, value: string, seen = new Set<string>()): string {
  const reference = value.match(/^var\(--([\w-]+)\)$/)?.[1];
  if (!reference) return value;
  if (seen.has(reference)) throw new Error(`Circular token reference: --${reference}`);
  return resolveTokenValue(css, tokenValue(css, reference), new Set(seen).add(reference));
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

  it.each(['light', 'dark'] as const)(
    'keeps %s muted text distinct and readable on normal surfaces',
    (mode) => {
      const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
      const values = tokenValues(css, mode);

      expect(values['muted-foreground']).not.toBe(values.foreground);
      for (const surface of ['background', 'card', 'muted', 'sidebar'] as const) {
        expect(
          contrast(values['muted-foreground'], values[surface]),
          `muted-foreground on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(['light', 'dark'] as const)(
    'keeps %s human-prompt text readable on the sidebar surface',
    (mode) => {
      const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
      const values = tokenValues(css, mode);

      expect(
        contrast(values['secondary-foreground'], values.sidebar),
        'secondary-foreground on sidebar',
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['light', 'dark'] as const)(
    'uses the exact approved %s neutral source values',
    (mode) => {
      const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');

      for (const [role, value] of Object.entries(DEFAULT_NEUTRAL_SOURCE[mode])) {
        expect(tokenValue(css, ['theme', mode, role].join('-')), role).toBe(value);
      }
      expect(tokenValue(css, ['theme', mode, 'agent-avatar-surface-neutral'].join('-'))).toBe(
        mode === 'light' ? 'var(--theme-light-muted)' : '145 12% 78%',
      );
    },
  );

  it.each(['light', 'dark'] as const)(
    'keeps the %s danger foreground readable on normal and danger surfaces',
    (mode) => {
      const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
      const values = tokenValues(css, mode);
      for (const surface of [
        'background',
        'card',
        'popover',
        'muted',
        'sidebar',
        'danger-background',
      ] as const) {
        expect(
          contrast(values.danger, values[surface]),
          `danger on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('maps danger content to the system text color in forced-colors mode', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
    expect(css).toMatch(
      /@media \(forced-colors: active\)\s*{\s*:where\(\.text-danger\)\s*{\s*color:\s*CanvasText !important;/,
    );
  });

  it('keeps canonical sidebar shells on the shared token without local color overrides', () => {
    const sidebar = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/ui/sidebar/sidebar.svelte'),
      'utf8',
    );
    const provider = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/ui/sidebar/sidebar-provider.svelte'),
      'utf8',
    );
    const skeleton = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/workspace/SidebarSkeleton.svelte'),
      'utf8',
    );
    const navigationPanel = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/layout/sidebar-nav/SidebarPanel.svelte'),
      'utf8',
    );

    expect(sidebar.match(/\bbg-sidebar\b/g)).toHaveLength(3);
    expect(sidebar).not.toMatch(/bg-\[#[\da-f]+\]/i);
    expect(provider).toContain('has-data-[variant=inset]:bg-sidebar');
    expect(skeleton).toContain('bg-sidebar text-sidebar-foreground');
    expect(navigationPanel).toContain(
      'sidebar-panel h-full flex flex-col relative text-sidebar-foreground',
    );
    for (const source of [sidebar, provider, skeleton, navigationPanel]) {
      expect(source).not.toMatch(/--sidebar\s*:/);
    }
  });

  it('keeps populated panels on the primary canvas and pristine empty panels on the sidebar surface', () => {
    const panel = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/layout/panel-system/Panel.svelte'),
      'utf8',
    );
    const panelTabBar = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/layout/panel-system/PanelTabBar.svelte'),
      'utf8',
    );
    const panelContainer = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/layout/panel-system/PanelContainer.svelte'),
      'utf8',
    );
    const panelEmpty = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/layout/panel-system/PanelEmptyState.svelte'),
      'utf8',
    );
    const chief = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/layout/sidebar-nav/cards/ChiefCard.svelte'),
      'utf8',
    );

    expect(panel).toContain('rounded-(--panel-shell-radius) text-foreground');
    expect(panel).toContain('--panel-shell-radius: var(--radius-large);');
    expect(panel).not.toContain('rounded-lg border border-border');
    expect(panel).toContain('class:bg-sidebar={panel.tabs.length === 0}');
    expect(panel).toContain('class:bg-background={panel.tabs.length > 0}');
    expect(panelTabBar).not.toContain('border-b border-border');
    expect(panelContainer).toContain('bg-background text-foreground');
    expect(panelEmpty).toContain('bg-sidebar px-6 py-8 text-foreground');
    expect(panelEmpty).not.toContain('bg-background px-6 py-8 text-foreground');
    for (const source of [panel, panelContainer, panelEmpty]) {
      expect(source).not.toContain('bg-sidebar text-sidebar-foreground');
      expect(source).not.toContain('bg-card text-card-foreground');
    }
    expect(chief).toMatch(
      /<div class="min-h-0 flex-1">\s*<ChatPanel[\s\S]*?agentName=\{m\.layout_chiefCard_title\(\)\}/,
    );
    expect(chief).not.toMatch(/<div class="[^"]*\bbg-card\b[^"]*">\s*<ChatPanel/);
  });

  it('keeps ModelPicker boundaries and avatar art on dedicated semantic roles', () => {
    const picker = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/components/chat/input/ModelPicker.svelte'),
      'utf8',
    );
    const avatar = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'src/features/agent/components/agent-avatar/AgentAvatarWithState.svelte',
      ),
      'utf8',
    );
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');

    expect(picker).toContain('border-border! focus-visible:border-ring!');
    expect(picker).toContain('focus-visible:ring-2 focus-visible:ring-ring/40');
    expect(picker).not.toMatch(/(?:border|ring)-\[#/);
    expect(avatar).toContain('color: hsl(var(--agent-avatar-foreground))');
    expect(avatar).not.toContain('color: #080808');
    for (const mode of ['light', 'dark']) {
      expect(tokenValue(css, `theme-${mode}-agent-avatar-foreground`)).toBe(
        'var(--theme-light-foreground)',
      );
    }
  });

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
    expect(css).not.toContain('--destructive');
    expect(css).not.toContain('--error-foreground');
  });

  it('exposes only the explicit danger roles through Tailwind', () => {
    const config = fs.readFileSync(path.resolve(process.cwd(), 'tailwind.config.js'), 'utf8');
    expect(config).toContain("danger: 'hsl(var(--danger) / <alpha-value>)'");
    expect(config).toContain(
      "'danger-background': 'hsl(var(--danger-background) / <alpha-value>)'",
    );
    expect(config).not.toMatch(/\bdestructive\s*:/);
    expect(config).not.toContain("'error-foreground'");
  });

  it('keeps primary, focus, and semantic status source values unchanged', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');

    for (const [token, value] of Object.entries(PRESERVED_SEMANTIC_SOURCE)) {
      expect(tokenValue(css, token), token).toBe(value);
    }
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
