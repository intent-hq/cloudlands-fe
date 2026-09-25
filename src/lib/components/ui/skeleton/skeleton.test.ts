// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import * as skeletonApi from './index';
import { skeletonFixtures } from './skeleton.fixtures';
import { skeletonMetadata } from './skeleton.meta';

describe('Skeleton', () => {
  it('publishes deterministic theme, compact, and reduced-motion fixtures', () => {
    expect(() => parseUiComponentMetadata(skeletonMetadata)).not.toThrow();
    expect(new Set(skeletonMetadata.exports)).toEqual(new Set(Object.keys(skeletonApi)));
    expect(skeletonFixtures[0].states).toEqual(
      expect.arrayContaining(['default', 'line', 'avatar', 'card', 'zoom-200', 'reduced-motion']),
    );
    expect(skeletonFixtures[0].reducedMotion).toBe(true);
  });
});
