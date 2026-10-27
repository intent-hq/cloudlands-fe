import { describe, expect, it } from 'vitest';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import {
  hasRetiredWorkspaces,
  isArchivedOrPurged,
  matchesHomeFilter,
  shouldReloadRetiredWorkspaces,
  type HomeFilter,
} from './home-model';
import { groupHomeWorkspacesByStatus } from './home-workspace-status-groups';
import { dismissibleWorkspaceReasons } from '$shared/utils/workspace-attention-reminder';

// An archived workspace whose folder was purged (`Retired`, PROTOCOL §5.1) is
// presented as archived: it appears only under the Archived chip and in the
// Archived group, never under any other chip, even when its row carries
// live-looking signals.
const workspace = (id: string, overrides: Partial<Workspace> = {}) =>
  ({ id, title: id, status: WorkspaceStatusEnum.Active, ...overrides }) as Workspace;

const purged = workspace('purged', {
  status: WorkspaceStatusEnum.Retired,
  archived: true,
  retiredAt: '2026-10-20T00:00:00Z',
  displayStatus: 'needs_attention',
  activity: 'agent_running',
  attention: 'unread',
  attentionReminder: {
    reasons: [{ id: 'review:before-retirement', revision: 'review-1' }],
    dismissed: false,
    displayStatus: 'needs_attention',
  },
});
const archived = workspace('archived', { status: WorkspaceStatusEnum.Archived, archived: true });

describe('Home Archived chip with purged workspaces', () => {
  it.each(['all', 'attention', 'running', 'waiting', 'blocked', 'unread'] as HomeFilter[])(
    'never shows a purged workspace under %s',
    (filter) => {
      expect(matchesHomeFilter(purged, filter)).toBe(false);
    },
  );

  it('shows archived and purged workspaces under Archived', () => {
    expect(matchesHomeFilter(purged, 'pr-ready')).toBe(false);
    expect(dismissibleWorkspaceReasons(purged)).toEqual([]);
    expect(
      dismissibleWorkspaceReasons({
        ...purged,
        status: WorkspaceStatusEnum.Active,
        archived: false,
        retiredAt: undefined,
      }),
    ).toEqual([{ id: 'review:before-retirement', revision: 'review-1' }]);
    expect(matchesHomeFilter(purged, 'archived')).toBe(true);
    expect(matchesHomeFilter(archived, 'archived')).toBe(true);
    expect(matchesHomeFilter(workspace('active'), 'archived')).toBe(false);
    expect(
      matchesHomeFilter(
        { ...purged, pendingDeleteAt: '2026-10-21T00:00:00Z' } as Workspace,
        'archived',
      ),
    ).toBe(false);
  });

  it('treats Archived and Retired as archived', () => {
    expect(isArchivedOrPurged(purged)).toBe(true);
    expect(isArchivedOrPurged(archived)).toBe(true);
    expect(isArchivedOrPurged(workspace('active'))).toBe(false);
  });

  it('groups purged workspaces into the Archived section', () => {
    const groups = groupHomeWorkspacesByStatus([
      purged,
      archived,
      workspace('active', { displayStatus: 'in_progress' }),
    ]);

    expect(groups.map((group) => group.id)).toEqual(['status:in_progress', 'status:archived']);
    expect(groups.at(-1)?.items.map((item) => item.id)).toEqual(['purged', 'archived']);
  });
});

describe('Archived chip reload after an ordinary list refresh', () => {
  it('reloads only when the Archived chip is active and purged rows just disappeared', () => {
    expect(shouldReloadRetiredWorkspaces('archived', true, false)).toBe(true);
    expect(shouldReloadRetiredWorkspaces('archived', false, false)).toBe(false);
    expect(shouldReloadRetiredWorkspaces('archived', true, true)).toBe(false);
    expect(shouldReloadRetiredWorkspaces('all', true, false)).toBe(false);
  });

  it('detects whether any purged row is loaded', () => {
    expect(hasRetiredWorkspaces([workspace('a'), purged])).toBe(true);
    expect(hasRetiredWorkspaces([workspace('a')])).toBe(false);
  });
});
