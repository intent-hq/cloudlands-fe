import { describe, expect, it } from 'vitest';
import { preview } from './panel-tab-strip.preview.svelte';

describe('panel tab-strip preview', () => {
  it('registers stable states and deterministic fixtures', () => {
    expect(preview.id).toBe('panel-tab-strip');
    expect(preview.defaultState).toBe('single');
    expect(Object.keys(preview.states)).toEqual([
      'empty',
      'single',
      'many-tabs',
      'long-content',
      'narrow',
    ]);
    expect(preview.states.single.props.tabs[0]).toMatchObject({
      id: 'preview-note-primary',
      workspaceId: 'preview-workspace-primary',
    });
  });
});
