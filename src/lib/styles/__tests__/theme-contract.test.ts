import fs from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { store as appStore } from '$store/renderer/store';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { openPanel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { setAgentsLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import type { PanelState } from '$store/renderer/slices/panel-layout/panel-layout-types';
import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
import Panel from '$lib/components/layout/panel-system/Panel.svelte';
import PanelContainer from '$lib/components/layout/panel-system/PanelContainer.svelte';
import PanelEmptyState from '$lib/components/layout/panel-system/PanelEmptyState.svelte';
import ChiefCard from '$lib/components/layout/sidebar-nav/cards/ChiefCard.svelte';
import SidebarPanelHarness from '$lib/components/layout/sidebar-nav/__tests__/mocks/SidebarPanelHarness.svelte';
import SidebarHarness from '$lib/components/ui/sidebar/SidebarHarness.svelte';
import SidebarSkeleton from '$lib/components/workspace/SidebarSkeleton.svelte';
import { themePresets } from '../../utils/theme-presets';
import { parseVSCodeTheme } from '../../utils/vscode-theme-parser';

vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (
    await import('$lib/components/layout/sidebar-nav/__tests__/mocks/MockChiefChatPanel.svelte')
  ).default,
}));

const COLOR_ROLES = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-ink',
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
  'warning-ink',
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
  ['primary-ink', 'background'],
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
    popover: '0 0% 100%',
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
    popover: '0 0% 10.1960784314%',
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
  'theme-light-primary': '66.4 67% 64.3%',
  'theme-light-primary-ink': '66 60% 28%',
  'theme-light-primary-foreground': '67 40% 12%',
  'theme-light-danger': '0 63% 31%',
  'theme-light-danger-background': '0 65% 94%',
  'theme-light-ring': '217.2 91.2% 59.8%',
  'theme-light-info': '260 58% 46%',
  'theme-light-info-foreground': '0 0% 100%',
  'theme-light-success': '145 67% 28%',
  'theme-light-success-foreground': '0 0% 100%',
  'theme-light-warning': '42 91% 54%',
  'theme-light-warning-foreground': '154 44% 14%',
  'theme-light-warning-ink': 'var(--theme-light-warning-foreground)',
  'theme-light-agent-avatar-surface-completed': '145 14% 88%',
  'theme-light-agent-avatar-foreground-completed': '154 32% 24%',
  'theme-light-agent-avatar-surface-attention': '30.785 100% 62.549%',
  'theme-light-agent-avatar-surface-failed': '0 72% 62%',
  'theme-light-agent-avatar-surface-active': '66.892 71.845% 59.608%',
  'theme-light-workspace-status-unread': '217.2 91.2% 59.8%',
  'theme-light-agent-avatar-surface-waiting': '263.2 74.257% 80.196%',
  'theme-dark-primary': '67 78% 68%',
  'theme-dark-primary-ink': 'var(--theme-dark-primary)',
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
  'theme-dark-warning-ink': 'var(--theme-dark-warning)',
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

function contrastChannels(first: number[], second: number[]): number {
  const luminance = (channels: number[]) => {
    const linear = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function contrast(first: string, second: string): number {
  return contrastChannels(parseHsl(first), parseHsl(second));
}

function blend(foreground: string, background: string, opacity: number): number[] {
  const foregroundRGB = parseHsl(foreground);
  const backgroundRGB = parseHsl(background);
  return backgroundRGB.map(
    (channel, index) => channel * (1 - opacity) + foregroundRGB[index] * opacity,
  );
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
    'keeps %s primary ink readable on neutral surfaces',
    (mode) => {
      const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
      const values = tokenValues(css, mode);
      for (const surface of ['background', 'card'] as const) {
        expect(
          contrast(values['primary-ink'], values[surface]),
          `primary-ink on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(['light', 'dark'] as const)(
    'keeps %s warning ink readable on neutral surfaces',
    (mode) => {
      const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
      const values = tokenValues(css, mode);
      for (const surface of ['background', 'card'] as const) {
        expect(
          contrast(values['warning-ink'], values[surface]),
          `warning-ink on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastChannels(
            parseHsl(values['warning-ink']),
            blend(values.warning, values[surface], 0.1),
          ),
          `warning-ink on soft ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(['light', 'dark'] as const)(
    'keeps %s primary foreground readable on the primary fill',
    (mode) => {
      const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
      const values = tokenValues(css, mode);

      expect(
        contrast(values['primary-foreground'], values.primary),
        'primary-foreground on primary',
      ).toBeGreaterThanOrEqual(4.5);
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

  it('keeps the avatar foreground on the shared light foreground token in both modes', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');

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

  it('uses the exact neutral interaction roles in light and dark themes', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
    expect(tokenValue(css, 'theme-light-overlay')).toBe('0 0 0');
    expect(tokenValue(css, 'theme-light-hover')).toBe('rgb(var(--theme-light-overlay) / 0.04)');
    expect(tokenValue(css, 'theme-light-active')).toBe('rgb(var(--theme-light-overlay) / 0.07)');
    expect(tokenValue(css, 'theme-light-selected')).toBe('0 0% 94%');
    expect(tokenValue(css, 'theme-dark-overlay')).toBe('255 255 255');
    expect(tokenValue(css, 'theme-dark-hover')).toBe('rgb(var(--theme-dark-overlay) / 0.06)');
    expect(tokenValue(css, 'theme-dark-active')).toBe('rgb(var(--theme-dark-overlay) / 0.1)');
    expect(tokenValue(css, 'theme-dark-selected')).toBe('0 0% 18%');
    expect(tokenValue(css, 'focus-ring')).toBe('var(--ring)');
    expect(tokenValue(css, 'overlay')).toBe('var(--theme-overlay)');
    expect(tokenValue(css, 'hover')).toBe('var(--theme-hover)');
    expect(tokenValue(css, 'active')).toBe('var(--theme-active)');
    expect(tokenValue(css, 'selected')).toBe('var(--theme-selected)');
    expect(css).toMatch(/\.dark\s*{[^}]*--theme-overlay:\s*var\(--theme-dark-overlay\);/s);
  });

  it('keeps primary, focus, and semantic status source values unchanged', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');

    for (const [token, value] of Object.entries(PRESERVED_SEMANTIC_SOURCE)) {
      expect(tokenValue(css, token), token).toBe(value);
    }
  });

  it.each(['light', 'dark'] as const)(
    'uses the %s focus color for built-in focus while keeping information purple',
    (mode) => {
      const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
      const primary = tokenValue(css, `theme-${mode}-primary`);
      const ring = tokenValue(css, `theme-${mode}-ring`);
      const info = tokenValue(css, `theme-${mode}-info`);

      expect(ring).toBe(mode === 'light' ? '217.2 91.2% 59.8%' : '213.1 93.9% 67.8%');
      expect(ring).not.toBe(primary);
      expect(info).toBe(mode === 'light' ? '260 58% 46%' : '260 80% 72%');
      expect(ring).not.toBe(info);
    },
  );

  it('keeps imported focusBorder colors in control of custom theme focus rings', () => {
    const colors = {
      'editor.background': '#000000',
      'editor.foreground': '#ffffff',
      'button.background': '#22c55e',
    };
    const yellowFocus = parseVSCodeTheme({ colors: { ...colors, focusBorder: '#ffff00' } });
    const cyanFocus = parseVSCodeTheme({ colors: { ...colors, focusBorder: '#00ffff' } });

    expect(yellowFocus.cssVariables['--ring']).not.toBe(cyanFocus.cssVariables['--ring']);
    expect(yellowFocus.cssVariables['--primary']).toBe(cyanFocus.cssVariables['--primary']);
    expect(yellowFocus.cssVariables['--info']).toBe(cyanFocus.cssVariables['--info']);
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

  it.each(['light', 'dark'] as const)(
    'applies the contrast-safe %s theme ring as the keyboard focus color',
    (mode) => {
      const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
      expect(tokenValue(css, 'focus-ring')).toBe('var(--ring)');
      const applied = resolveTokenValue(css, tokenValue(css, `theme-${mode}-ring`));
      const values = tokenValues(css, mode);
      expect(applied).toBe(values.ring);
      for (const surface of ['background', 'card', 'popover', 'sidebar'] as const) {
        expect(
          contrast(applied, values[surface]),
          `focus-ring on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it('keeps the applied focus ring legible on an imported light surface', () => {
    const parsed = parseVSCodeTheme({
      type: 'light',
      colors: {
        'editor.background': '#7c9cff',
        'editor.foreground': '#111111',
        focusBorder: '#7c9cff',
      },
    });
    const ring = parsed.cssVariables['--ring'];
    expect(ring).toBeDefined();
    for (const surface of ['--background', '--card', '--popover', '--sidebar'] as const) {
      expect(
        contrast(ring, parsed.cssVariables[surface]),
        `focus-ring on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
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
      'spring-fast',
      'spring-fast-exit',
      'spring-fast-ease',
      'spring-moderate',
      'spring-moderate-exit',
      'spring-moderate-ease',
      'spring-slow',
      'spring-slow-exit',
      'spring-slow-ease',
      'press-inset',
      'ease-standard',
      'ease-emphasized-out',
      'layer-chrome',
      'layer-popover',
      'layer-modal',
      'layer-tooltip',
      'layer-drag-overlay',
      'space-1',
      'space-2',
      'space-3',
      'space-4',
      'space-5',
      'space-6',
      'space-7',
      'content-measure-form',
      'content-measure-wide',
    ])
      expect(css).toContain(`--${token}:`);
    for (const tier of ['fast', 'moderate', 'slow']) {
      const springToken = ['var(', '--spring-', tier, ')'].join('');
      const springExitToken = ['var(', '--spring-', tier, '-exit)'].join('');
      const springEaseToken = ['var(', '--spring-', tier, '-ease)'].join('');
      expect(tokenValue(css, `transition-duration-spring-${tier}`)).toBe(springToken);
      expect(tokenValue(css, `transition-duration-spring-${tier}-exit`)).toBe(springExitToken);
      expect(tokenValue(css, `ease-spring-${tier}`)).toBe(springEaseToken);
    }
    expect(tokenValue(css, 'ease-spring-exit')).toBe('var(--spring-exit-ease)');
    expect(tokenValue(css, 'spring-exit-ease')).toBe('cubic-bezier(0.33, 1, 0.68, 1)');
    expect(tokenValue(css, 'motion-fast')).toBe('var(--spring-fast)');
    expect(tokenValue(css, 'motion-standard')).toBe('var(--spring-moderate)');
    expect(tokenValue(css, 'motion-slow')).toBe('var(--spring-slow)');
    expect(tokenValue(css, 'press-inset')).toBe('1px');
    expect(tokenValue(css, 'control-height-compact')).toBe('1.75rem');
    expect(tokenValue(css, 'control-height-small')).toBe('1.75rem');
    expect(tokenValue(css, 'control-height-medium')).toBe('2rem');
    expect(tokenValue(css, 'control-height-large')).toBe('2.25rem');
    expect(tokenValue(css, 'radius-small')).toBe('8px');
    expect(tokenValue(css, 'radius-medium')).toBe('8px');
    expect(tokenValue(css, 'radius-large')).toBe('8px');
    expect(tokenValue(css, 'radius-row')).toBe('8px');
    expect(tokenValue(css, 'radius-pill')).toBe('8px');
    for (const token of ['content-measure-reading', 'layer-base', 'layer-sticky', 'layer-toast']) {
      expect(css).not.toContain(`--${token}:`);
    }
    expect(css).not.toContain(['--surface', 'hatch:'].join('-'));
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

  it('defines one theme-aware overlay surface recipe', () => {
    const appCss = fs.readFileSync(path.resolve(process.cwd(), 'src/app.css'), 'utf8');
    const recipe = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/styles/overlay-surface.css'),
      'utf8',
    );

    expect(appCss).toContain("@import '$lib/styles/overlay-surface.css';");
    expect(recipe).toContain('border-radius: var(--radius-medium);');
    expect(recipe).toContain('box-shadow: var(--elevation-overlay);');
    expect(recipe).toContain('--overlay-surface-border-width: 0px;');
    expect(recipe).toMatch(
      /\.dark \.overlay-surface\s*{[^}]*--overlay-surface-border-width:\s*1px/s,
    );
    expect(recipe).toContain('--overlay-surface-border-color: hsl(var(--border));');
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
    expect(tokenValue(tokens, 'font-ui')).toBe(
      "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    );
    expect(appCss.match(/@fontsource-variable\/inter\/files\//g)).toHaveLength(1);
    expect(appCss).toContain('inter-latin-wght-normal.woff2');
    for (const role of ['body', 'title', 'display']) {
      expect(tokens).toContain(`--text-${role}-tracking: -0.016em;`);
    }
    expect(appCss).toMatch(/body\s*\{[^}]*font-size:\s*var\(--text-body-size\)/s);
    expect(appCss).not.toMatch(/html,\s*body\s*\{[^}]*font-size:/s);
  });
});

describe('theme color contract — rendered surfaces', () => {
  const WORKSPACE_ID = 'workspace-1';
  const originalResizeObserver = window.ResizeObserver;
  const originalMatchMedia = window.matchMedia;
  let dispose: (() => void) | undefined;

  function stubMatchMedia(matches: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((media: string) => ({
        matches,
        media,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  beforeEach(() => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    });
    dispose = appStore.init();
  });

  afterEach(() => {
    cleanup();
    dispose?.();
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: originalResizeObserver,
    });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
  });

  function classesMatching(root: ParentNode, pattern: RegExp): string[] {
    return [...root.querySelectorAll('*')].flatMap((element) =>
      [...element.classList].filter((name) => pattern.test(name)),
    );
  }

  function inlineOverrides(root: ParentNode, property: string): Element[] {
    return [...root.querySelectorAll<HTMLElement>('*')].filter(
      (element) => element.style.getPropertyValue(property) !== '',
    );
  }

  function renderPanel(id: string, tabs: PanelState['tabs']) {
    const { container } = render(Panel, {
      props: {
        panel: { id, tabs, activeTabId: tabs[0]?.id ?? null },
        workspaceId: WORKSPACE_ID,
        layoutId: WORKSPACE_ID,
        onFocus: vi.fn(),
      },
    });
    return container.querySelector(`[data-panel-id="${id}"]`)!;
  }

  it('keeps canonical sidebar shells on the shared token without local color overrides', async () => {
    const uiSidebar = render(SidebarHarness, { props: { open: true } });
    const inner = uiSidebar.container.querySelector('[data-slot="sidebar-inner"]')!;
    const wrapper = uiSidebar.container.querySelector('[data-slot="sidebar-wrapper"]')!;
    const skeleton = render(SidebarSkeleton);
    const navigation = render(SidebarPanelHarness, {
      props: { setup: () => appStore.dispatch(openPanel('settings')) },
    });
    const navigationShell = await waitFor(() => {
      const shell = navigation.container.querySelector('.sidebar-panel');
      expect(shell).not.toBeNull();
      return shell!;
    });

    expect(inner.classList).toContain('bg-sidebar');
    expect(wrapper.classList).toContain('has-data-[variant=inset]:bg-sidebar');
    expect(skeleton.container.firstElementChild!.classList).toContain('bg-sidebar');
    expect(skeleton.container.firstElementChild!.classList).toContain('text-sidebar-foreground');
    expect(navigationShell.classList).toContain('text-sidebar-foreground');
    for (const root of [uiSidebar.container, skeleton.container, navigation.container]) {
      expect(classesMatching(root, /^bg-\[#/i)).toEqual([]);
      expect(inlineOverrides(root, '--sidebar')).toEqual([]);
    }
  });

  it('keeps the fixed and mobile sidebar shells on the shared token', async () => {
    const fixed = render(SidebarHarness, { props: { open: true, collapsible: 'none' } });
    const fixedShell = fixed.container.querySelector(
      '[data-slot="sidebar-wrapper"]',
    )!.firstElementChild!;
    expect(fixedShell.classList).toContain('bg-sidebar');
    expect(fixedShell.classList).toContain('text-sidebar-foreground');
    expect(fixedShell.classList).not.toContain('bg-background');
    expect(classesMatching(fixed.container, /^bg-\[#/i)).toEqual([]);
    expect(inlineOverrides(fixed.container, '--sidebar')).toEqual([]);
    cleanup();

    stubMatchMedia(true);
    render(SidebarHarness);
    await fireEvent.click(screen.getByRole('button', { name: m.ui_sidebar_toggle_label() }));
    const sheet = await screen.findByRole('dialog', { name: 'Sidebar' });
    const mobileShell = sheet.matches('[data-mobile="true"]')
      ? sheet
      : sheet.querySelector('[data-mobile="true"]');
    expect(mobileShell).not.toBeNull();
    expect(mobileShell!.classList).toContain('bg-sidebar');
    expect(mobileShell!.classList).toContain('text-sidebar-foreground');
    expect(mobileShell!.classList).not.toContain('bg-background');
    expect(classesMatching(document.body, /^bg-\[#/i)).toEqual([]);
    expect(inlineOverrides(document.body, '--sidebar')).toEqual([]);
  });

  it('keeps populated panels on the primary canvas and pristine empty panels on the sidebar surface', async () => {
    const populated = renderPanel('populated', [
      { id: 'note-tab', type: 'note', title: 'Note', closable: true },
    ]);
    const pristine = renderPanel('pristine', []);
    const missing = render(PanelContainer, {
      props: {
        node: { type: 'panel', panelId: 'missing' },
        panels: {},
        panelOrder: [],
        focusedPanelId: null,
        workspaceId: WORKSPACE_ID,
        layoutId: WORKSPACE_ID,
      },
    }).container.querySelector('[data-missing-panel-surface]')!;
    const emptyState = render(PanelEmptyState, {
      props: { panelId: 'pristine', workspaceId: WORKSPACE_ID, layoutId: WORKSPACE_ID },
    }).container.firstElementChild!;

    for (const shell of [populated, pristine]) {
      expect(shell.classList).toContain('rounded-(--panel-shell-radius)');
      expect(shell.classList).toContain('text-foreground');
      expect(shell.classList).not.toContain('rounded-lg');
      expect(shell.classList).not.toContain('border-border');
    }
    expect(populated.classList).toContain('bg-background');
    expect(populated.classList).not.toContain('bg-sidebar');
    expect(pristine.classList).toContain('bg-sidebar');
    expect(pristine.classList).not.toContain('bg-background');
    expect(
      [...populated.querySelectorAll('*')].filter(
        (element) =>
          element.classList.contains('border-b') && element.classList.contains('border-border'),
      ),
    ).toEqual([]);
    expect(missing.classList).toContain('bg-background');
    expect(missing.classList).toContain('text-foreground');
    expect(emptyState.classList).toContain('bg-sidebar');
    expect(emptyState.classList).toContain('text-foreground');
    expect(emptyState.classList).not.toContain('bg-background');
    for (const surface of [populated, pristine, missing, emptyState]) {
      expect(surface.classList).not.toContain('text-sidebar-foreground');
      expect(surface.classList).not.toContain('bg-card');
      expect(surface.classList).not.toContain('text-card-foreground');
    }

    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: 'chief-agent',
          backendSessionId: null,
          workspaceId: CHIEF_WORKSPACE_ID,
          name: 'Chief',
          status: 'idle',
          messages: [],
          createdAt: '2026-08-10T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        } as unknown as AgentSession,
      ]),
    );
    const chief = render(ChiefCard, { props: { expanded: true } });
    const chatPanel = await waitFor(() => {
      const mock = chief.container.querySelector('[data-testid="mock-chat-panel"]');
      expect(mock).not.toBeNull();
      return mock!;
    });
    expect(chatPanel.parentElement!.classList).toContain('min-h-0');
    expect(chatPanel.parentElement!.classList).toContain('flex-1');
    expect(chatPanel.parentElement!.classList).not.toContain('bg-card');
    const chiefTitle = m.layout_chiefCard_title();
    expect(chiefTitle).not.toBe('');
    expect(chatPanel.getAttribute('data-agent-name')).toBe(chiefTitle);
  });

  it('keeps ModelPicker boundaries on the shared border token', () => {
    const { container } = render(ModelPicker, { props: { variant: 'outline' } });
    const trigger = container.querySelector('button')!;

    expect(trigger.classList).toContain('border-border!');
    expect(classesMatching(container, /^(?:border|ring)-\[#/)).toEqual([]);
  });
});
