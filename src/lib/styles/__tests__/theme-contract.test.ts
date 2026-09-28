import fs from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { store as appStore } from '$store/renderer/store';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { setAgentsLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import ChiefCard from '$lib/components/layout/sidebar-nav/cards/ChiefCard.svelte';
import SidebarHarness from '$lib/components/ui/sidebar/SidebarHarness.svelte';
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

  it.each(['light', 'dark'] as const)('keeps %s muted text readable on normal surfaces', (mode) => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
    const values = tokenValues(css, mode);

    for (const surface of ['background', 'card', 'muted', 'sidebar'] as const) {
      expect(
        contrast(values['muted-foreground'], values[surface]),
        `muted-foreground on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

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
    expect(tokenValue(css, 'motion-fast')).toBe('var(--spring-fast)');
    expect(tokenValue(css, 'motion-standard')).toBe('var(--spring-moderate)');
    expect(tokenValue(css, 'motion-slow')).toBe('var(--spring-slow)');
    for (const token of ['content-measure-reading', 'layer-base', 'layer-sticky', 'layer-toast']) {
      expect(css).not.toContain(`--${token}:`);
    }
    expect(css).not.toContain(['--surface', 'hatch:'].join('-'));
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0\.01ms/,
    );
  });
});

describe('theme color contract — rendered surfaces', () => {
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

  it('opens the mobile sidebar as a dialog', async () => {
    stubMatchMedia(true);
    render(SidebarHarness);
    await fireEvent.click(screen.getByRole('button', { name: m.ui_sidebar_toggle_label() }));
    const sheet = await screen.findByRole('dialog', { name: 'Sidebar' });
    const mobileShell = sheet.matches('[data-mobile="true"]')
      ? sheet
      : sheet.querySelector('[data-mobile="true"]');
    expect(mobileShell).not.toBeNull();
  });

  it('passes the localized Chief name to its chat panel', async () => {
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
    const chiefTitle = m.layout_chiefCard_title();
    expect(chiefTitle).not.toBe('');
    expect(chatPanel.getAttribute('data-agent-name')).toBe(chiefTitle);
  });
});
