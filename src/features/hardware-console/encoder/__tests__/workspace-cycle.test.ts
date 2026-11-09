import { describe, expect, it } from 'vitest';
import { cycleWorkspaceId, orderWorkspacesForCycling } from '../workspace-cycle';

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

  it('steps counter-clockwise toward more recently active', () => {
    expect(cycleWorkspaceId(ids, 'least', 'counterclockwise')).toBe('mid');
    expect(cycleWorkspaceId(ids, 'mid', 'counterclockwise')).toBe('most');
  });

  it('steps clockwise toward less recently active', () => {
    expect(cycleWorkspaceId(ids, 'most', 'clockwise')).toBe('mid');
    expect(cycleWorkspaceId(ids, 'mid', 'clockwise')).toBe('least');
  });

  it('clamps at both ends instead of wrapping', () => {
    expect(cycleWorkspaceId(ids, 'most', 'counterclockwise')).toBeNull();
    expect(cycleWorkspaceId(ids, 'least', 'clockwise')).toBeNull();
  });

  it('enters the list at the direction-appropriate end when the active id is unknown', () => {
    expect(cycleWorkspaceId(ids, null, 'counterclockwise')).toBe('least');
    expect(cycleWorkspaceId(ids, null, 'clockwise')).toBe('most');
    expect(cycleWorkspaceId(ids, 'gone', 'counterclockwise')).toBe('least');
  });

  it('returns null when there is nowhere to go', () => {
    expect(cycleWorkspaceId([], 'most', 'counterclockwise')).toBeNull();
    expect(cycleWorkspaceId(['only'], 'only', 'counterclockwise')).toBeNull();
    expect(cycleWorkspaceId(['only'], 'only', 'clockwise')).toBeNull();
  });

  it('cycles into a single non-active workspace', () => {
    expect(cycleWorkspaceId(['only'], null, 'counterclockwise')).toBe('only');
    expect(cycleWorkspaceId(['only'], 'other', 'clockwise')).toBe('only');
  });
});
