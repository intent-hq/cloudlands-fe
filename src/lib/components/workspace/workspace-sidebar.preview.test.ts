import { describe, expect, it } from 'vitest';
import { preview } from './workspace-sidebar.preview.svelte';

describe('workspace sidebar preview', () => {
  it('registers stable states and deterministic fixtures', () => {
    expect(preview.id).toBe('workspace-sidebar');
    expect(preview.defaultState).toBe('busy');
    expect(Object.keys(preview.states)).toEqual([
      'loading',
      'empty',
      'busy',
      'long-content',
      'narrow',
    ]);
    expect(preview.states.busy.props.workspaces[0]).toMatchObject({
      id: 'preview-workspace-primary',
      createdAt: '2026-08-23T12:00:00.000Z',
      lastActivity: '2026-08-23T12:04:00.000Z',
      updatedAt: '2026-08-23T12:05:00.000Z',
    });
  });
});
