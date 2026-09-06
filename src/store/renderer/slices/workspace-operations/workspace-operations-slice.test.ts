import { describe, expect, it } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoreState } from '../../types';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import {
  initialState as workspaceInitialState,
  setWorkspaceEntity,
  workspaceReducer,
} from '../workspace/workspace-slice';
import { selectPendingBulkWorkspaces } from './workspace-operations-selectors';
import {
  bulkActiveWorkComputed,
  closeArchiveWarning,
  closeBulkArchiveConfirm,
  closeBulkDeleteConfirm,
  closeDeleteWarning,
  closeRemoveRepoConfirm,
  initialState,
  openArchiveWarning,
  openBulkArchiveConfirm,
  openBulkDeleteConfirm,
  openDeleteWarning,
  openRemoveRepoConfirm,
  workspaceOperationsReducer,
} from './workspace-operations-slice';

const openPr = {
  number: 7,
  title: 'feat: add thing',
  url: 'https://github.com/o/r/pull/7',
  status: 'Open' as const,
};

const localChanges = {
  roots: [
    {
      kind: 'primary' as const,
      path: '/work/repo',
      branch: 'feat/x',
      hasRemoteRefs: true,
      unpushedCount: 3,
      uncommittedCount: 2,
    },
  ],
  hasUnpushedCommits: true,
  hasUncommittedChanges: true,
};

function makeWorkspace(id: string, title: string): Workspace {
  return {
    id: id as Workspace['id'],
    title,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('workspaceOperationsReducer', () => {
  it('starts with no local-changes data for either warning', () => {
    expect(initialState.localChangesForDelete).toBeNull();
    expect(initialState.localChangesForArchive).toBeNull();
  });

  it('opens and clears the delete warning state', () => {
    const opened = workspaceOperationsReducer(
      initialState,
      openDeleteWarning({
        workspaceId: 'ws-1',
        agentNames: ['Agent One'],
        hookNames: ['ci-watch'],
        openPrs: [openPr],
        localChanges,
      }),
    );

    expect(opened.showDeleteWarning).toBe(true);
    expect(opened.pendingDeleteWorkspaceId).toBe('ws-1');
    expect(opened.runningAgentNamesForDelete).toEqual(['Agent One']);
    expect(opened.activeHookNamesForDelete).toEqual(['ci-watch']);
    expect(getItems(opened.openPrsForDelete)).toEqual([openPr]);
    expect(opened.localChangesForDelete).toEqual(localChanges);
    expect(opened.localChangesForArchive).toBeNull();

    const closed = workspaceOperationsReducer(opened, closeDeleteWarning());

    expect(closed.showDeleteWarning).toBe(false);
    expect(closed.pendingDeleteWorkspaceId).toBeNull();
    expect(closed.runningAgentNamesForDelete).toEqual([]);
    expect(closed.activeHookNamesForDelete).toEqual([]);
    expect(getItems(closed.openPrsForDelete)).toEqual([]);
    expect(closed.localChangesForDelete).toBeNull();
  });

  it('opens the delete warning with null local changes when none were supplied', () => {
    const opened = workspaceOperationsReducer(
      initialState,
      openDeleteWarning({
        workspaceId: 'ws-1',
        agentNames: ['Agent One'],
        hookNames: [],
        openPrs: [],
      }),
    );

    expect(opened.showDeleteWarning).toBe(true);
    expect(opened.localChangesForDelete).toBeNull();
  });

  it('opens and clears the archive warning state', () => {
    const opened = workspaceOperationsReducer(
      initialState,
      openArchiveWarning({
        workspaceId: 'ws-2',
        agentNames: ['Agent Two'],
        hookNames: ['pr-watch'],
        openPrs: [{ ...openPr, status: 'Draft' as const, mergeConflicts: true }],
        localChanges,
      }),
    );

    expect(opened.showArchiveWarning).toBe(true);
    expect(opened.pendingArchiveWorkspaceId).toBe('ws-2');
    expect(opened.runningAgentNamesForArchive).toEqual(['Agent Two']);
    expect(opened.activeHookNamesForArchive).toEqual(['pr-watch']);
    expect(getItems(opened.openPrsForArchive)).toEqual([
      { ...openPr, status: 'Draft', mergeConflicts: true },
    ]);
    expect(opened.localChangesForArchive).toEqual(localChanges);
    expect(opened.localChangesForDelete).toBeNull();

    const closed = workspaceOperationsReducer(opened, closeArchiveWarning());

    expect(closed.showArchiveWarning).toBe(false);
    expect(closed.pendingArchiveWorkspaceId).toBeNull();
    expect(closed.runningAgentNamesForArchive).toEqual([]);
    expect(closed.activeHookNamesForArchive).toEqual([]);
    expect(getItems(closed.openPrsForArchive)).toEqual([]);
    expect(closed.localChangesForArchive).toBeNull();
  });

  it('opens the archive warning with null local changes when the RPC failed', () => {
    const opened = workspaceOperationsReducer(
      initialState,
      openArchiveWarning({
        workspaceId: 'ws-2',
        agentNames: [],
        hookNames: ['pr-watch'],
        openPrs: [],
        localChanges: null,
      }),
    );

    expect(opened.showArchiveWarning).toBe(true);
    expect(opened.localChangesForArchive).toBeNull();
  });

  it('opens and clears both group-scoped bulk confirms', () => {
    const archiveOpened = workspaceOperationsReducer(
      initialState,
      openBulkArchiveConfirm({ workspaceIds: ['ws-1', 'ws-2'], groupLabel: 'Active' }),
    );

    expect(archiveOpened).toMatchObject({
      showBulkArchiveConfirm: true,
      showBulkDeleteConfirm: false,
      pendingBulkWorkspaceIds: ['ws-1', 'ws-2'],
      pendingBulkGroupLabel: 'Active',
    });
    expect(workspaceOperationsReducer(archiveOpened, closeBulkArchiveConfirm())).toMatchObject({
      showBulkArchiveConfirm: false,
      pendingBulkWorkspaceIds: [],
      pendingBulkGroupLabel: null,
      bulkActiveAgentCount: 0,
      bulkActiveHookCount: 0,
    });

    const deleteOpened = workspaceOperationsReducer(
      archiveOpened,
      openBulkDeleteConfirm({ workspaceIds: ['ws-3'], groupLabel: 'Archived' }),
    );
    expect(deleteOpened).toMatchObject({
      showBulkArchiveConfirm: false,
      showBulkDeleteConfirm: true,
      pendingBulkWorkspaceIds: ['ws-3'],
      pendingBulkGroupLabel: 'Archived',
    });
    expect(workspaceOperationsReducer(deleteOpened, closeBulkDeleteConfirm())).toMatchObject({
      showBulkDeleteConfirm: false,
      pendingBulkWorkspaceIds: [],
      pendingBulkGroupLabel: null,
      bulkActiveAgentCount: 0,
      bulkActiveHookCount: 0,
    });
  });

  it('folds only the active dialog current-token active-work result', () => {
    const firstOpen = workspaceOperationsReducer(
      initialState,
      openBulkArchiveConfirm({ workspaceIds: ['ws-1'], groupLabel: 'Active' }),
    );
    const reopened = workspaceOperationsReducer(
      firstOpen,
      openBulkDeleteConfirm({ workspaceIds: ['ws-2'], groupLabel: 'Archived' }),
    );

    const afterStale = workspaceOperationsReducer(
      reopened,
      bulkActiveWorkComputed({
        kind: 'archive',
        agentCount: 9,
        hookCount: 8,
        token: firstOpen.bulkComputeToken,
      }),
    );
    expect(afterStale.bulkActiveAgentCount).toBe(0);
    expect(afterStale.bulkActiveHookCount).toBe(0);

    const afterWrongKind = workspaceOperationsReducer(
      afterStale,
      bulkActiveWorkComputed({
        kind: 'archive',
        agentCount: 7,
        hookCount: 6,
        token: reopened.bulkComputeToken,
      }),
    );
    expect(afterWrongKind.bulkActiveAgentCount).toBe(0);
    expect(afterWrongKind.bulkActiveHookCount).toBe(0);

    const afterFresh = workspaceOperationsReducer(
      afterWrongKind,
      bulkActiveWorkComputed({
        kind: 'delete',
        agentCount: 2,
        hookCount: 1,
        token: reopened.bulkComputeToken,
      }),
    );
    expect(afterFresh.bulkActiveAgentCount).toBe(2);
    expect(afterFresh.bulkActiveHookCount).toBe(1);
  });

  it('tracks and clears pending repo removal', () => {
    const opened = workspaceOperationsReducer(initialState, openRemoveRepoConfirm('/tmp/repo'));

    expect(opened.showRemoveRepoConfirm).toBe(true);
    expect(opened.pendingRemoveRepoPath).toBe('/tmp/repo');

    const closed = workspaceOperationsReducer(opened, closeRemoveRepoConfirm());

    expect(closed.showRemoveRepoConfirm).toBe(false);
    expect(closed.pendingRemoveRepoPath).toBeNull();
  });
});

describe('workspace operations selectors', () => {
  it('resolves pending bulk workspace ids in order and drops unknown ids', () => {
    const first = makeWorkspace('ws-1', 'First');
    const second = makeWorkspace('ws-2', 'Second');
    const workspaceState = workspaceReducer(
      workspaceReducer(workspaceInitialState, setWorkspaceEntity(first)),
      setWorkspaceEntity(second),
    );
    const workspaceOperations = workspaceOperationsReducer(
      initialState,
      openBulkDeleteConfirm({
        workspaceIds: ['ws-2', 'ws-missing', 'ws-1'],
        groupLabel: 'All',
      }),
    );
    const state = { workspace: workspaceState, workspaceOperations } as StoreState;

    expect(selectPendingBulkWorkspaces.select(state)).toEqual([second, first]);
  });
});
