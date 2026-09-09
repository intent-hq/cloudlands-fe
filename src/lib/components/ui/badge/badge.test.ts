/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVSCodeTheme } from '../../../utils/vscode-theme-parser';
import Badge from './badge.svelte';
import { badgeFixtures } from './badge.fixtures';
import { badgeMetadata } from './badge.meta';
import { badgeVariants } from './badge.variants';
import BadgeHarness from './BadgeHarness.svelte';

function themeColor(css: string, mode: 'light' | 'dark', role: string): string {
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

describe('Badge', () => {
  it('owns one semantic variant recipe', () => {
    const sources = ['badge.svelte', 'index.ts', 'badge.variants.ts'].map((file) =>
      readFileSync(new URL(file, import.meta.url), 'utf8'),
    );
    const source = sources.join('\n');
    expect(source.match(/\btv\(/g)).toHaveLength(1);
    expect(source.match(/export type BadgeVariant\b/g)).toHaveLength(1);
    expect(source.match(/export type BadgeProps\b/g)).toHaveLength(1);
    expect(badgeVariants({ variant: 'secondary' })).toContain('bg-secondary');
    expect(badgeVariants({ variant: 'destructive' })).toContain('text-danger');
    expect(badgeVariants({ variant: 'destructive' })).not.toContain('text-white');
    expect(badgeVariants({ variant: 'success' })).toContain('bg-success');
    expect(badgeVariants({ variant: 'info' })).toContain('bg-info');
    expect(badgeVariants({ variant: 'outline' })).toContain('bg-muted');
  });

  it('keeps every variant borderless, padded, and AA-readable in all theme modes', () => {
    const pairs = {
      default: ['primary-foreground', 'primary'],
      secondary: ['secondary-foreground', 'secondary'],
      destructive: ['danger', 'danger-background'],
      outline: ['foreground', 'muted'],
      success: ['success-foreground', 'success'],
      info: ['info-foreground', 'info'],
    } as const;
    for (const [variant, [foreground, background]] of Object.entries(pairs)) {
      const classes = badgeVariants({ variant: variant as keyof typeof pairs }).split(/\s+/);
      expect(classes).toContain(`bg-${background}`);
      expect(classes).toContain(`text-${foreground}`);
      expect(classes.some((className) => /^border(?:-|$)/.test(className))).toBe(false);
      expect(classes).toEqual(
        expect.arrayContaining([
          'h-5',
          'px-2',
          'py-0.5',
          'gap-1',
          'rounded-(--radius-medium)',
          'font-normal',
        ]),
      );
    }

    const css = readFileSync(resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
    const highContrast = parseVSCodeTheme({
      type: 'hc-black',
      colors: { 'editor.background': '#000000', 'editor.foreground': '#ffffff' },
    }).cssVariables;
    const themes = [
      { name: 'light', color: (role: string) => themeColor(css, 'light', role) },
      { name: 'dark', color: (role: string) => themeColor(css, 'dark', role) },
      { name: 'high contrast', color: (role: string) => highContrast[`--${role}`] },
    ];
    for (const theme of themes) {
      for (const [variant, [foreground, background]] of Object.entries(pairs)) {
        expect(
          contrastRatio(theme.color(foreground), theme.color(background)),
          `${theme.name} ${variant}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('renders optional leading affordances and removes after its exit', async () => {
    const { getByLabelText, getByTestId } = render(BadgeHarness);
    const badge = getByTestId('removable-badge');
    expect(badge.querySelector('[data-slot="badge-dot"]')).not.toBeNull();
    expect(getByLabelText('Shield icon')).toBeTruthy();
    const remove = getByLabelText('Remove status');
    expect(remove.className).toContain('size-4');
    expect(remove.className).toContain('rounded-full');
    expect(remove.className).toContain('border-0');

    await fireEvent.click(remove);
    await waitFor(() => expect(screen.getByLabelText('Badge removed').textContent).toBe('true'));
    expect(screen.queryByTestId('removable-badge')).toBeNull();
  });

  it('preserves span and anchor behavior', () => {
    const { unmount } = render(Badge, { props: { 'aria-label': 'Stable' } });
    expect(screen.getByLabelText('Stable').tagName).toBe('SPAN');
    unmount();

    render(Badge, { props: { 'aria-label': 'Release', href: '/release' } });
    expect(screen.getByRole('link', { name: 'Release' }).getAttribute('href')).toBe('/release');
  });

  it('publishes catalog metadata', () => {
    expect(badgeMetadata.characterizationTest).toBe('src/lib/components/ui/badge/badge.test.ts');
    expect(badgeFixtures.flatMap((fixture) => fixture.states)).toContain('long-label');
    expect(badgeFixtures.flatMap((fixture) => fixture.states)).toEqual(
      expect.arrayContaining([
        'outline',
        'destructive',
        'success-ring-dot',
        'info-ring-dot',
        'leading-icon',
        'removable',
        'dark',
      ]),
    );
  });
});
