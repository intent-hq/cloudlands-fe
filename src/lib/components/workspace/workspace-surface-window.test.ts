import { describe, expect, it } from 'vitest';
import { resolveLiveWorkspaceIds } from './workspace-surface-window';

describe('resolveLiveWorkspaceIds', () => {
  const stacks = Array.from({ length: 10 }, (_, index) => [`ws-${index + 1}`]);

  it('keeps the active stack and its immediate neighbors live', () => {
    expect(resolveLiveWorkspaceIds(stacks, 'ws-5', [])).toEqual(['ws-4', 'ws-5', 'ws-6']);
  });

  it('keeps visible and materializing targets live with overscan', () => {
    expect(resolveLiveWorkspaceIds(stacks, 'ws-1', ['ws-5'], 'ws-8')).toEqual([
      'ws-1',
      'ws-2',
      'ws-4',
      'ws-5',
      'ws-6',
      'ws-7',
      'ws-8',
      'ws-9',
    ]);
  });

  it('keeps all workspaces in a live vertical stack together', () => {
    expect(resolveLiveWorkspaceIds([['ws-1', 'ws-2'], ['ws-3']], 'ws-2', [])).toEqual([
      'ws-1',
      'ws-2',
      'ws-3',
    ]);
  });
});
