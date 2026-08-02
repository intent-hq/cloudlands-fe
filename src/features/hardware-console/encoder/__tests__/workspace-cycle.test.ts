import { describe, expect, it } from 'vitest';
import {
  cycleWorkspaceId,
  nextAllSpacesViewMode,
  orderWorkspacesForCycling,
} from '../workspace-cycle';

const ws = (
  id: string,
  lastActivity?: string,
  extra: Partial<{
    createdAt: string;
    updatedAt: string;
  }> = {},
) => ({
  id,
  lastActivity,
  createdAt: extra.createdAt ?? '',
  updatedAt: extra.updatedAt ?? '',
});

describe('orderWorkspacesForCycling', () => {
  it('orders by lastActivity descending', () => {
    const ordered = orderWorkspacesForCycling([
      ws('a', '2026-07-01T00:00:00Z'),
      ws('b', '2026-07-03T00:00:00Z'),
      ws('c', '2026-07-02T00:00:00Z'),
    ]);
    expect(ordered.map((w) => w.id)).toEqual(['b', 'c', 'a']);
  });

  it('falls back to createdAt then updatedAt when lastActivity is absent', () => {
    const ordered = orderWorkspacesForCycling([
      ws('created', undefined, { createdAt: '2026-07-02T00:00:00Z' }),
      ws('active', '2026-07-03T00:00:00Z'),
      ws('updated', undefined, { updatedAt: '2026-07-01T00:00:00Z' }),
    ]);
    expect(ordered.map((w) => w.id)).toEqual(['active', 'created', 'updated']);
  });

  it('does not mutate the input array', () => {
    const input = [ws('a', '2026-07-01T00:00:00Z'), ws('b', '2026-07-02T00:00:00Z')];
    orderWorkspacesForCycling(input);
    expect(input.map((w) => w.id)).toEqual(['a', 'b']);
  });
});

describe('cycleWorkspaceId', () => {
  const ids = ['most', 'mid', 'least'];

  it('steps cw toward more recently active', () => {
    expect(cycleWorkspaceId(ids, 'least', 'cw')).toBe('mid');
    expect(cycleWorkspaceId(ids, 'mid', 'cw')).toBe('most');
  });

  it('steps ccw toward less recently active', () => {
    expect(cycleWorkspaceId(ids, 'most', 'ccw')).toBe('mid');
    expect(cycleWorkspaceId(ids, 'mid', 'ccw')).toBe('least');
  });

  it('clamps at both ends instead of wrapping', () => {
    expect(cycleWorkspaceId(ids, 'most', 'cw')).toBeNull();
    expect(cycleWorkspaceId(ids, 'least', 'ccw')).toBeNull();
  });

  it('enters the list at the direction-appropriate end when the active id is unknown', () => {
    expect(cycleWorkspaceId(ids, null, 'cw')).toBe('least');
    expect(cycleWorkspaceId(ids, null, 'ccw')).toBe('most');
    expect(cycleWorkspaceId(ids, 'gone', 'cw')).toBe('least');
  });

  it('returns null when there is nowhere to go', () => {
    expect(cycleWorkspaceId([], 'most', 'cw')).toBeNull();
    expect(cycleWorkspaceId(['only'], 'only', 'cw')).toBeNull();
    expect(cycleWorkspaceId(['only'], 'only', 'ccw')).toBeNull();
  });

  it('cycles into a single non-active workspace', () => {
    expect(cycleWorkspaceId(['only'], null, 'cw')).toBe('only');
    expect(cycleWorkspaceId(['only'], 'other', 'ccw')).toBe('only');
  });
});

describe('nextAllSpacesViewMode', () => {
  it('cycles Recent → Repo → Status → Recent', () => {
    expect(nextAllSpacesViewMode('recent')).toBe('repo');
    expect(nextAllSpacesViewMode('repo')).toBe('status');
    expect(nextAllSpacesViewMode('status')).toBe('recent');
  });
});
