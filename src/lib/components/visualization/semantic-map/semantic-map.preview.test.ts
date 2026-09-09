import { describe, expect, it } from 'vitest';
import manifestJson from './fixtures/intent-manifest.json';
import {
  preview,
  resolveSemanticMapPreviewCanvasWidth,
  SEMANTIC_MAP_PREVIEW_COMPACT_BREAKPOINT,
} from './semantic-map.preview.svelte';

describe('semantic map preview', () => {
  it('registers every reviewable URL state', () => {
    expect(preview.id).toBe('semantic-map');
    expect(preview.defaultState).toBe('busy');
    expect(Object.keys(preview.states)).toEqual([
      'rest',
      'busy',
      'route',
      'focus-region',
      'focus-region-idle',
      'replay',
      'unsorted-heavy',
      'detail-region',
      'detail-agent',
      'detail-route',
      'detail-crossing',
    ]);
  });

  it('bundles the curated manifest geography', () => {
    expect(manifestJson.version).toBe(1);
    expect(manifestJson.regions).toHaveLength(16);
    expect(manifestJson.regions.find(({ id }) => id === 'renderer-ui')?.anchor).toEqual([
      0.86, 0.58,
    ]);
    expect(manifestJson.crossings).toHaveLength(13);
  });

  it('uses the host compact breakpoint and container-measured canvas width', () => {
    expect(SEMANTIC_MAP_PREVIEW_COMPACT_BREAKPOINT).toBe('48rem');
    expect(resolveSemanticMapPreviewCanvasWidth(672)).toBe(672);
    expect(resolveSemanticMapPreviewCanvasWidth(0)).toBe(1);
    expect(resolveSemanticMapPreviewCanvasWidth(672, 1440)).toBe(1440);
  });
});
