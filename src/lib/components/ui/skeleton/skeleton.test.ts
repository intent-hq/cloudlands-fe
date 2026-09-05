// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import * as skeletonApi from './index';
import Skeleton from './skeleton.svelte';
import { skeletonFixtures } from './skeleton.fixtures';
import { skeletonMetadata } from './skeleton.meta';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/components/ui/skeleton/skeleton.svelte'),
  'utf8',
);

describe('Skeleton', () => {
  it('uses a calm linear slow-tier shimmer and disables it when motion is reduced', () => {
    const { container } = render(Skeleton, { props: { 'data-testid': 'loading-row' } });
    const skeleton = container.querySelector('[data-slot="skeleton"]');
    expect(skeleton?.className).toContain('skeleton-shimmer');
    expect(skeleton?.className).toContain('rounded-(--radius-small)');
    expect(source).toContain('calc(var(--spring-slow) * 10) linear infinite');
    expect(source).toContain('color-mix(in oklab, var(--selected) 55%, transparent)');
    expect(source).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
  });

  it('publishes deterministic theme, compact, and reduced-motion fixtures', () => {
    expect(() => parseUiComponentMetadata(skeletonMetadata)).not.toThrow();
    expect(new Set(skeletonMetadata.exports)).toEqual(new Set(Object.keys(skeletonApi)));
    expect(skeletonFixtures[0].states).toEqual(
      expect.arrayContaining(['default', 'line', 'avatar', 'card', 'zoom-200', 'reduced-motion']),
    );
    expect(skeletonFixtures[0].reducedMotion).toBe(true);
  });
});
