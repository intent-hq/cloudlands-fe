import { describe, expect, it } from 'vitest';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import {
  hasRetiredWorkspaces,
  matchesHomeFilter,
  shouldReloadRetiredWorkspaces,
  type HomeFilter,
} from './home-model';
import { groupHomeWorkspacesByStatus } from './home-workspace-status-groups';

// Retired workspaces (PROTOCOL §5.1) appear on Home only under the Retired
// chip, placed after Archived; every other chip must exclude them even when a
// retired row is present in the store (e.g. after the user opened one).
const workspace = (id: string, overrides: Partial<Workspace> = {}) =>
  ({ id, title: id, status: WorkspaceStatusEnum.Active, ...overrides }) as Workspace;

const retired = workspace('retired', {
  status: WorkspaceStatusEnum.Retired,
  archived: true,
  retiredAt: '2026-10-20T00:00:00Z',
  displayStatus: 'needs_attention',
  activity: 'agent_running',
  attention: 'unread',
});

describe('Home Retired chip', () => {
  it.each(['all', 'attention', 'running', 'blocked', 'unread', 'archived'] as HomeFilter[])(
    'never shows a retired workspace under %s',
    (filter) => {
      expect(matchesHomeFilter(retired, filter)).toBe(false);
    },
  );

  it('shows only retired workspaces under the Retired chip', () => {
    expect(matchesHomeFilter(retired, 'retired')).toBe(true);
    expect(matchesHomeFilter(workspace('active'), 'retired')).toBe(false);
    expect(
      matchesHomeFilter(workspace('archived', { status: WorkspaceStatusEnum.Archived }), 'retired'),
    ).toBe(false);
    expect(
      matchesHomeFilter(
        { ...retired, pendingDeleteAt: '2026-10-21T00:00:00Z' } as Workspace,
        'retired',
      ),
    ).toBe(false);
  });

  it('groups retired workspaces in their own section after Archived', () => {
    const groups = groupHomeWorkspacesByStatus([
      retired,
      workspace('archived', { status: WorkspaceStatusEnum.Archived }),
      workspace('active', { displayStatus: 'in_progress' }),
    ]);

    expect(groups.map((group) => group.id)).toEqual([
      'status:in_progress',
      'status:archived',
      'status:retired',
    ]);
    expect(groups.at(-1)?.items.map((item) => item.id)).toEqual(['retired']);
  });
});

describe('Retired chip reload after an ordinary list refresh', () => {
  it('reloads only when the Retired chip is active and retired rows just disappeared', () => {
    expect(shouldReloadRetiredWorkspaces('retired', true, false)).toBe(true);
    expect(shouldReloadRetiredWorkspaces('retired', false, false)).toBe(false);
    expect(shouldReloadRetiredWorkspaces('retired', true, true)).toBe(false);
    expect(shouldReloadRetiredWorkspaces('all', true, false)).toBe(false);
  });

  it('detects whether any retired row is loaded', () => {
    expect(hasRetiredWorkspaces([workspace('a'), retired])).toBe(true);
    expect(hasRetiredWorkspaces([workspace('a')])).toBe(false);
  });
});
