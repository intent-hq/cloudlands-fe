// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import * as indicatorsApi from './index';
import Spinner from './Spinner.svelte';
import { spinnerFixtures } from './spinner.fixtures';
import { spinnerMetadata } from './spinner.meta';

const spinnerSource = readFileSync(
  resolve(process.cwd(), 'src/lib/components/ui/indicators/Spinner.svelte'),
  'utf8',
);

describe('Spinner', () => {
  it('preserves its public props and loading status semantics', () => {
    render(Spinner, {
      props: { seed: 'agent-1', size: 8, gap: 2, variant: 'shuffle', class: 'custom-spinner' },
    });
    const spinner = screen.getByRole('status', { name: 'Loading' });
    expect(spinner.getAttribute('data-seed')).toBe('agent-1');
    expect(spinner.getAttribute('data-variant')).toBe('shuffle');
    expect(spinner.getAttribute('style')).toContain('--spinner-size: 8px');
    expect(spinner.className).toContain('custom-spinner');
    expect(spinner.querySelectorAll('.spinner-tile')).toHaveLength(3);
  });

  it('maps seeds to deterministic visible semantic color orderings', () => {
    const first = render(Spinner, { props: { seed: 'agent-1' } });
    const repeated = render(Spinner, { props: { seed: 'agent-1' } });
    const different = render(Spinner, { props: { seed: 'agent-2' } });
    const colorProperties = ['--spinner-color-1', '--spinner-color-2', '--spinner-color-3'];
    const colors = (container: HTMLElement) => {
      const spinner = container.querySelector<HTMLElement>('[role="status"]');
      return colorProperties.map((property) => spinner?.style.getPropertyValue(property));
    };

    expect(colors(first.container)).toEqual(colors(repeated.container));
    expect(colors(first.container)).not.toEqual(colors(different.container));
    expect(colors(first.container)).toEqual(
      expect.arrayContaining([
        'hsl(var(--primary))',
        'hsl(var(--info))',
        'hsl(var(--muted-foreground))',
      ]),
    );
    for (const property of colorProperties) {
      expect(spinnerSource).toContain(`background: var(${property})`);
    }
  });

  it('keeps every public variant on a distinct animation behavior', () => {
    const variants = ['wave', 'stair', 'snake', 'shuffle', 'pulse'] as const;
    const animationNames = variants.map((variant) => {
      const { container } = render(Spinner, { props: { variant } });
      const spinner = container.querySelector<HTMLElement>('[role="status"]');
      return spinner?.style.getPropertyValue('--spinner-animation-name');
    });

    expect(animationNames).toEqual(variants.map((variant) => `spinner-${variant}`));
    expect(new Set(animationNames).size).toBe(variants.length);
    expect(spinnerSource).toContain('animation-name: var(--spinner-animation-name)');
    const animationBodies = animationNames.map((animationName) => {
      const start = spinnerSource.indexOf(`@keyframes ${animationName}`);
      const nextKeyframes = spinnerSource.indexOf('\n  @keyframes ', start + 1);
      const reducedMotion = spinnerSource.indexOf('\n  @media ', start + 1);
      const end = nextKeyframes === -1 ? reducedMotion : nextKeyframes;

      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return spinnerSource.slice(start, end).replace(/\s+/g, ' ').trim();
    });
    for (const animationName of animationNames) {
      expect(spinnerSource).toContain(`@keyframes ${animationName}`);
    }
    expect(new Set(animationBodies).size).toBe(variants.length);
  });

  it('restores the square thinking tiles with semantic colors and reduced-motion parity', () => {
    expect(spinnerSource).toContain("'hsl(var(--primary))'");
    expect(spinnerSource).toContain("'hsl(var(--info))'");
    expect(spinnerSource).toContain("'hsl(var(--muted-foreground))'");
    expect(spinnerSource).toContain('background: var(--spinner-color-1)');
    expect(spinnerSource).toContain('class="spinner-tile spinner-tile-primary"');
    expect(spinnerSource).toContain('animation-timing-function: step-start');
    expect(spinnerSource).toContain('transform: translateY(-90%)');
    expect(spinnerSource).not.toContain('border-radius: var(--radius-full)');
    expect(spinnerSource).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
    expect(spinnerSource).not.toContain('dark:');
    expect(spinnerSource).not.toContain('$features/');
  });

  it('publishes deterministic dark, compact, and reduced-motion fixtures', () => {
    expect(() => parseUiComponentMetadata(spinnerMetadata)).not.toThrow();
    expect(new Set(spinnerMetadata.exports)).toEqual(new Set(Object.keys(indicatorsApi)));
    expect(spinnerMetadata).toMatchObject({
      id: 'spinner',
      publicImport: '$lib/components/ui/indicators',
      category: 'pattern',
      replacement: null,
    });
    expect(spinnerFixtures[0].states).toEqual(
      expect.arrayContaining([
        'wave',
        'stair',
        'snake',
        'shuffle',
        'pulse',
        'seeded-colors',
        'zoom-200',
        'reduced-motion',
      ]),
    );
  });
});
