import { describe, expect, it } from 'vitest';
import {
  findAdjacentWorkspaceWithPanels,
  resolveLocalPanelCycleTarget,
} from './panel-cycle-navigation';

describe('panel cycle navigation', () => {
  it('returns the next local panel and hands off at the layout boundary', () => {
    expect(resolveLocalPanelCycleTarget(['p1', 'p2'], 'p1', 'next')).toBe('p2');
    expect(resolveLocalPanelCycleTarget(['p1', 'p2'], 'p2', 'next')).toBeNull();
    expect(resolveLocalPanelCycleTarget(['p1', 'p2'], 'p1', 'prev')).toBeNull();
  });

  it('uses the edge panel when the layout has no valid focus', () => {
    expect(resolveLocalPanelCycleTarget(['p1', 'p2'], null, 'next')).toBe('p1');
    expect(resolveLocalPanelCycleTarget(['p1', 'p2'], 'missing', 'prev')).toBe('p2');
  });

  it('skips empty workspaces and wraps in display order', () => {
    const populated = new Set(['ws-1', 'ws-2']);
    const hasPanels = (workspaceId: string) => populated.has(workspaceId);
    const stacks = [['ws-1'], ['ws-2'], ['ws-3']];

    expect(findAdjacentWorkspaceWithPanels(stacks, 'ws-1', 'next', hasPanels)).toBe('ws-2');
    expect(findAdjacentWorkspaceWithPanels(stacks, 'ws-2', 'next', hasPanels)).toBe('ws-1');
    expect(findAdjacentWorkspaceWithPanels(stacks, 'ws-1', 'prev', hasPanels)).toBe('ws-2');
  });
});
