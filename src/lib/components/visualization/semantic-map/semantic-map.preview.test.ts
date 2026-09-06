import { describe, expect, it } from 'vitest';
import manifestJson from './fixtures/intent-manifest.json';
import { preview } from './semantic-map.preview.svelte';

describe('semantic map preview', () => {
  it('registers every reviewable URL state', () => {
    expect(preview.id).toBe('semantic-map');
    expect(preview.defaultState).toBe('busy');
    expect(Object.keys(preview.states)).toEqual([
      'rest',
      'busy',
      'route',
      'focus-region',
      'replay',
      'unsorted-heavy',
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
});
