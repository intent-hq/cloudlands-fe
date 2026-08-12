// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import * as skeletonApi from './index';
import Skeleton from './skeleton.svelte';
import { skeletonFixtures } from './skeleton.fixtures';
import { skeletonMetadata } from './skeleton.meta';

describe('Skeleton', () => {
  it('uses a quiet semantic surface and disables pulse motion when reduced', () => {
    const { container } = render(Skeleton, { props: { 'data-testid': 'loading-row' } });
    const skeleton = container.querySelector('[data-slot="skeleton"]');
    expect(skeleton?.className).toContain('bg-muted');
    expect(skeleton?.className).toContain('rounded-(--radius-small)');
    expect(skeleton?.className).toContain('animate-pulse');
    expect(skeleton?.className).toContain('motion-reduce:animate-none');
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
