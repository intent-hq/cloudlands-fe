import { describe, expect, it } from 'vitest';
import { preview } from './browser-tabs-menu.preview.svelte';

describe('browser tabs menu preview', () => {
  it('registers deterministic representative tab counts for the agent header', () => {
    expect(preview.id).toBe('browser-tabs-menu');
    expect(preview.defaultState).toBe('five-tabs');
    expect(preview.states).toEqual({
      'one-tab': { props: { count: 1, width: 860 } },
      'three-tabs': { props: { count: 3, width: 860 } },
      'five-tabs': { props: { count: 5, width: 860 } },
    });
  });
});
