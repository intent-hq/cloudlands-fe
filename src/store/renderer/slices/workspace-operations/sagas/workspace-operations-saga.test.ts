import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  archive: vi.fn(),
  unarchive: vi.fn(),
  deleteWorkspace: vi.fn(),
  cancelDelete: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
  navigateToRoute: vi.fn(),
  getActiveWorkNames: vi.fn(),
  invoke: vi.fn(),
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: {
    archive: mocks.archive,
    unarchive: mocks.unarchive,
    delete: mocks.deleteWorkspace,
    cancelDelete: mocks.cancelDelete,
    create: mocks.create,
  },
}));
vi.mock('$features/workspace/navigate-away-if-viewing', () => ({
  navigateAwayIfViewing: mocks.navigate,
}));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.navigateToRoute }));
vi.mock('$lib/utils/delete-warning-utils', () => ({
  getActiveWorkNames: mocks.getActiveWorkNames,
}));
vi.mock('svelte-sonner', () => ({ toast: mocks.toast }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));

import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import type { BulkOperationProposal, WorkspaceCreateProposal } from '$shared/types/proposal';
import {
  initialState as proposalLifecycleInitialState,
  proposalLifecycleReducer,
} from '../../proposal-lifecycle/proposal-lifecycle-slice';
import {
  initialState as workspaceInitialState,
  replaceWorkspaceList,
  setWorkspaceEntity,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import {
  applyWorkspaceProposal,
  confirmArchiveWorkspace,
  confirmBulkArchive,
  confirmBulkDelete,
  confirmDeleteWorkspace,
  confirmRemoveRepo,
  initialState as operationsInitialState,
  openBulkArchiveConfirm,
  openBulkDeleteConfirm,
  openRemoveRepoConfirm,
  requestArchiveWorkspace,
  requestDeleteWorkspace,
  requestUnarchiveWorkspace,
  workspaceOperationsReducer,
} from '../workspace-operations-slice';
import { TOAST_COUNTDOWN_CLASS } from '$lib/components/ui/toast';
import {
  WORKSPACE_DELETION_TOMBSTONE_TTL_MS,
  WORKSPACE_OPERATION_UNDO_DURATION_MS,
  workspaceOperationsSaga,
} from './workspace-operations-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const workspace = (id: string, status = WorkspaceStatusEnum.Active): Workspace =>
  ({
    id,
    title: id,
    status,
    archived: status === WorkspaceStatusEnum.Archived,
    repositoryOwner: 'intent-hq',
    repositoryName: 'repo',
  }) as Workspace;

const bulkProposal = (
  operation: BulkOperationProposal['payload']['operation'],
  ids: string[],
  applyToolCallId: string,
): BulkOperationProposal => ({
  kind: 'bulk-op',
  payload: { operation, ids },
  preview: { title: 'Bulk operation' },
  applyToolCallId,
});

const createProposal = (applyToolCallId: string): WorkspaceCreateProposal => ({
  kind: 'workspace-create',
  payload: {
    operation: 'workspace.create',
    params: {
      title: 'New space',
      repositoryPath: '/repo',
      baseRef: 'main',
      initialAgent: { name: 'Coordinator', prompt: 'Original prompt' },
    },
  },
  preview: { title: 'Create workspace' },
  applyToolCallId,
});

const noActiveWork = { agentNames: [], hookNames: [], openPrs: [], localChanges: null };

const localChanges = {
  roots: [
    {
      kind: 'primary' as const,
      path: '/work/repo',
      branch: 'feat/x',
      hasRemoteRefs: true,
      unpushedCount: 2,
      uncommittedCount: 0,
    },
  ],
  hasUnpushedCommits: true,
  hasUncommittedChanges: false,
};

function latestUndo(): (() => void) | undefined {
  const options = mocks.toast.warning.mock.calls.at(-1)?.[1] as
    { action?: { onClick?: () => void } } | undefined;
  return options?.action?.onClick;
}

function harness(seed: Workspace[]) {
  const channel = stdChannel();
  let workspaceState = workspaceInitialState;
  for (const item of seed)
    workspaceState = workspaceReducer(workspaceState, setWorkspaceEntity(item));
  let operations = operationsInitialState;
  let proposalLifecycle = proposalLifecycleInitialState;
  const dispatch = vi.fn((action) => {
    workspaceState = workspaceReducer(workspaceState, action);
    operations = workspaceOperationsReducer(operations, action);
    proposalLifecycle = proposalLifecycleReducer(proposalLifecycle, action);
    return action;
  });
  const task = runSaga(
    {
      channel,
      dispatch,
      getState: () => ({
        workspace: workspaceState,
        workspaceOperations: operations,
        proposalLifecycle,
      }),
    },
    workspaceOperationsSaga,
  );
  const send = (action: Parameters<typeof workspaceOperationsReducer>[1]) => {
    dispatch(action);
    channel.put(action);
  };
  return {
    channel,
    dispatch,
    send,
    task,
    state: () => ({
      workspace: workspaceState,
      workspaceOperations: operations,
      proposalLifecycle,
    }),
  };
}

describe('workspaceOperationsSaga', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getActiveWorkNames.mockResolvedValue(noActiveWork);
    mocks.navigate.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('uses the exact archive wire call and reports a failed result without updating state', async () => {
    mocks.archive
      .mockResolvedValueOnce({ ok: true, data: workspace('ws-1', WorkspaceStatusEnum.Archived) })
      .mockResolvedValueOnce({ ok: false, error: 'denied' });
    const run = harness([workspace('ws-1'), workspace('ws-2')]);
    run.send(requestArchiveWorkspace('ws-1'));
    await settle();
    run.send(requestArchiveWorkspace('ws-2'));
    await settle();
    expect(mocks.archive.mock.calls).toEqual([['ws-1'], ['ws-2']]);
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    // Tab close + navigation are driven by the daemon workspace:updated event
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(
      run.dispatch.mock.calls
        .flat()
        .some((action) => action?.type === 'workspace/bulkUpdateWorkspaceEntities'),
    ).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('computes archive active work for exactly the requested ids and skips archived targets', async () => {
    mocks.getActiveWorkNames.mockImplementation((workspaceId: string) =>
      Promise.resolve(
        workspaceId === 'ws-1'
          ? { ...noActiveWork, agentNames: ['Ada'] }
          : { ...noActiveWork, hookNames: ['pr-watch'] },
      ),
    );
    mocks.archive
      .mockResolvedValueOnce({ ok: true, data: workspace('ws-1', WorkspaceStatusEnum.Archived) })
      .mockRejectedValueOnce(new Error('offline'));
    const run = harness([
      workspace('ws-1'),
      workspace('ws-2'),
      workspace('ws-3', WorkspaceStatusEnum.Archived),
      workspace('outside'),
    ]);
    run.send(
      openBulkArchiveConfirm({
        workspaceIds: ['ws-1', 'missing', 'ws-2', 'ws-3'],
        groupLabel: 'Active',
      }),
    );
    await settle();
    expect(mocks.getActiveWorkNames.mock.calls.map(([id]) => id)).toEqual(['ws-1', 'ws-2', 'ws-3']);
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'workspaceOperations/bulkActiveWorkComputed',
      payload: [{ kind: 'archive', agentCount: 1, hookCount: 2, token: 1 }],
    });

    run.send(confirmBulkArchive());
    await settle();
    expect(mocks.archive.mock.calls).toEqual([['ws-1'], ['ws-2']]);
    expect(mocks.toast.warning).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('deduplicates an already-applied bulk proposal by its lifecycle id', async () => {
    mocks.archive.mockResolvedValue({
      ok: true,
      data: workspace('ws-1', WorkspaceStatusEnum.Archived),
    });
    const proposal: BulkOperationProposal = {
      kind: 'bulk-op',
      payload: { operation: 'workspace.bulkArchive', ids: ['ws-1'] },
      preview: { title: 'Bulk operation' },
      applyToolCallId: 'tc-bulk-1',
    };
    const run = harness([workspace('ws-1')]);
    run.send(applyWorkspaceProposal({ proposal }));
    await settle();
    run.send(applyWorkspaceProposal({ proposal }));
    await settle();
    expect(mocks.archive).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('schedules the daemon delete immediately and keeps the tombstone so stale refetches cannot resurrect the workspace', async () => {
    vi.useFakeTimers();
    mocks.deleteWorkspace.mockResolvedValue({
      ok: true,
      data: { scheduled: true, deleteAt: new Date(Date.now() + 15_000).toISOString() },
    });
    const run = harness([workspace('ws-1')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await vi.advanceTimersByTimeAsync(50);
    // The delete RPC goes on the wire IMMEDIATELY with the daemon-owned grace window
    expect(mocks.deleteWorkspace).toHaveBeenCalledExactlyOnceWith('ws-1', {
      undoDelayMs: WORKSPACE_OPERATION_UNDO_DURATION_MS,
    });
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toBeUndefined();
    expect(run.state().workspace.pendingDeletions['ws-1']).toBe(true);

    // Undo window elapses: the daemon commits on its own — no second RPC
    await vi.advanceTimersByTimeAsync(WORKSPACE_OPERATION_UNDO_DURATION_MS);
    expect(mocks.deleteWorkspace).toHaveBeenCalledTimes(1);
    // Tombstone must survive the commit deadline for the grace window
    expect(run.state().workspace.pendingDeletions['ws-1']).toBe(true);

    // Stale responses computed before the daemon committed the delete land now
    run.send(setWorkspaceEntity(workspace('ws-1')));
    run.send(replaceWorkspaceList([workspace('ws-1')]));
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toBeUndefined();

    // Grace window elapses: tombstone is cleared and state stays clean
    await vi.advanceTimersByTimeAsync(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
    expect(run.state().workspace.pendingDeletions['ws-1']).toBeUndefined();
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toBeUndefined();

    run.task.cancel();
    await run.task.toPromise();
  });

  it('removes the selected workspace entity when deletion is scheduled', async () => {
    vi.useFakeTimers();
    mocks.deleteWorkspace.mockResolvedValue({
      ok: true,
      data: { scheduled: true, deleteAt: new Date(Date.now() + 15_000).toISOString() },
    });
    const run = harness([workspace('ws-1'), workspace('ws-2')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await vi.advanceTimersByTimeAsync(50);

    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toBeUndefined();
    expect(mocks.deleteWorkspace).toHaveBeenCalledExactlyOnceWith('ws-1', {
      undoDelayMs: WORKSPACE_OPERATION_UNDO_DURATION_MS,
    });

    run.task.cancel();
    await run.task.toPromise();
    await vi.advanceTimersByTimeAsync(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
  });

  it('preserves other workspace entities when deleting one workspace', async () => {
    vi.useFakeTimers();
    mocks.deleteWorkspace.mockResolvedValue({
      ok: true,
      data: { scheduled: true, deleteAt: new Date(Date.now() + 15_000).toISOString() },
    });
    const run = harness([workspace('ws-1'), workspace('ws-2')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await vi.advanceTimersByTimeAsync(50);

    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toBeUndefined();
    expect(getItem(run.state().workspace.workspaces, 'ws-2')).toMatchObject({ id: 'ws-2' });

    run.task.cancel();
    await run.task.toPromise();
    await vi.advanceTimersByTimeAsync(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
  });

  it('leaves the daemon-owned commit alone when the root is cancelled mid-window', async () => {
    vi.useFakeTimers();
    mocks.navigate.mockResolvedValue(undefined);
    mocks.deleteWorkspace.mockResolvedValue({
      ok: true,
      data: { scheduled: true, deleteAt: new Date(Date.now() + 15_000).toISOString() },
    });
    const run = harness([workspace('ws-1')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.deleteWorkspace).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
    // No extra wire call on teardown — the daemon owns the commit
    expect(mocks.deleteWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.cancelDelete).not.toHaveBeenCalled();
    // Drain the detached tombstone-grace timer so it cannot bleed across tests
    await vi.advanceTimersByTimeAsync(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
    expect(run.state().workspace.pendingDeletions['ws-1']).toBeUndefined();
  });

  it('shows the delete warning, confirms it, and restores the workspace when cancelDelete succeeds', async () => {
    mocks.getActiveWorkNames.mockResolvedValue({
      agentNames: ['Ada'],
      hookNames: ['ci-watch'],
      openPrs: [],
      localChanges: null,
    });
    mocks.deleteWorkspace.mockResolvedValue({
      ok: true,
      data: { scheduled: true, deleteAt: new Date(Date.now() + 15_000).toISOString() },
    });
    mocks.cancelDelete.mockResolvedValue({ ok: true, data: { cancelled: true } });
    const run = harness([workspace('ws-1')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await settle();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    // Single-workspace gating is the only path that asks for local changes
    expect(mocks.getActiveWorkNames).toHaveBeenCalledExactlyOnceWith('ws-1', {
      includeLocalChanges: true,
    });
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'workspaceOperations/openDeleteWarning',
      payload: [
        {
          workspaceId: 'ws-1',
          agentNames: ['Ada'],
          hookNames: ['ci-watch'],
          openPrs: [],
          localChanges: null,
        },
      ],
    });

    run.send(confirmDeleteWorkspace());
    await settle();
    expect(mocks.deleteWorkspace).toHaveBeenCalledExactlyOnceWith('ws-1', {
      undoDelayMs: WORKSPACE_OPERATION_UNDO_DURATION_MS,
    });
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toBeUndefined();
    expect(mocks.toast.warning).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      expect.objectContaining({
        duration: WORKSPACE_OPERATION_UNDO_DURATION_MS,
        class: expect.stringContaining(TOAST_COUNTDOWN_CLASS),
        style: expect.stringContaining(
          `--toast-countdown-duration: ${WORKSPACE_OPERATION_UNDO_DURATION_MS}ms`,
        ),
      }),
    );
    latestUndo()?.();
    await settle();
    expect(mocks.cancelDelete).toHaveBeenCalledExactlyOnceWith('ws-1');
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toMatchObject({ id: 'ws-1' });
    expect(run.state().workspace.pendingDeletions['ws-1']).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not resurrect the workspace when cancelDelete reports the race-safe cancelled:false', async () => {
    vi.useFakeTimers();
    mocks.deleteWorkspace.mockResolvedValue({
      ok: true,
      data: { scheduled: true, deleteAt: new Date(Date.now() + 15_000).toISOString() },
    });
    mocks.cancelDelete.mockResolvedValue({ ok: true, data: { cancelled: false } });
    const run = harness([workspace('ws-1')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await vi.advanceTimersByTimeAsync(50);
    latestUndo()?.();
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.cancelDelete).toHaveBeenCalledExactlyOnceWith('ws-1');
    // The daemon already committed: show "could not undo" and stay deleted
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toBeUndefined();
    expect(run.state().workspace.pendingDeletions['ws-1']).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
    // Drain the detached tombstone-grace timer so it cannot bleed across tests
    await vi.advanceTimersByTimeAsync(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
    expect(run.state().workspace.pendingDeletions['ws-1']).toBeUndefined();
  });

  it('shows the archive warning for active hooks and archives after confirmation', async () => {
    mocks.getActiveWorkNames.mockResolvedValue({
      agentNames: [],
      hookNames: ['pr-watch'],
      openPrs: [],
      localChanges: null,
    });
    mocks.archive.mockResolvedValue({
      ok: true,
      data: workspace('ws-1', WorkspaceStatusEnum.Archived),
    });
    const run = harness([workspace('ws-1')]);

    run.send(requestArchiveWorkspace('ws-1'));
    await settle();

    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.getActiveWorkNames).toHaveBeenCalledExactlyOnceWith('ws-1', {
      includeLocalChanges: true,
    });
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'workspaceOperations/openArchiveWarning',
      payload: [
        {
          workspaceId: 'ws-1',
          agentNames: [],
          hookNames: ['pr-watch'],
          openPrs: [],
          localChanges: null,
        },
      ],
    });

    run.send(confirmArchiveWorkspace());
    await settle();

    expect(mocks.archive).toHaveBeenCalledExactlyOnceWith('ws-1');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('shows the delete and archive warnings when only open PRs exist (zero agents/hooks)', async () => {
    const openPrs = [
      {
        number: 7,
        title: 'feat: add thing',
        url: 'https://github.com/o/r/pull/7',
        status: 'Open' as const,
      },
    ];
    mocks.getActiveWorkNames.mockResolvedValue({ ...noActiveWork, openPrs });
    const run = harness([workspace('ws-1'), workspace('ws-2')]);

    run.send(requestDeleteWorkspace('ws-1'));
    await settle();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'workspaceOperations/openDeleteWarning',
      payload: [
        { workspaceId: 'ws-1', agentNames: [], hookNames: [], openPrs, localChanges: null },
      ],
    });

    run.send(requestArchiveWorkspace('ws-2'));
    await settle();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'workspaceOperations/openArchiveWarning',
      payload: [
        { workspaceId: 'ws-2', agentNames: [], hookNames: [], openPrs, localChanges: null },
      ],
    });

    run.task.cancel();
    await run.task.toPromise();
  });

  it('shows the delete and archive warnings when only local changes exist (zero agents/hooks/PRs)', async () => {
    mocks.getActiveWorkNames.mockResolvedValue({ ...noActiveWork, localChanges });
    const run = harness([workspace('ws-1'), workspace('ws-2')]);

    run.send(requestDeleteWorkspace('ws-1'));
    await settle();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    expect(run.state().workspaceOperations.showDeleteWarning).toBe(true);
    expect(run.state().workspaceOperations.localChangesForDelete).toEqual(localChanges);
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'workspaceOperations/openDeleteWarning',
      payload: [{ workspaceId: 'ws-1', agentNames: [], hookNames: [], openPrs: [], localChanges }],
    });

    run.send(requestArchiveWorkspace('ws-2'));
    await settle();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(run.state().workspaceOperations.showArchiveWarning).toBe(true);
    expect(run.state().workspaceOperations.localChangesForArchive).toEqual(localChanges);
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'workspaceOperations/openArchiveWarning',
      payload: [{ workspaceId: 'ws-2', agentNames: [], hookNames: [], openPrs: [], localChanges }],
    });

    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not warn when the local-changes result reports a clean, fully pushed tree', async () => {
    mocks.getActiveWorkNames.mockResolvedValue({
      ...noActiveWork,
      localChanges: {
        roots: [{ ...localChanges.roots[0], unpushedCount: 0 }],
        hasUnpushedCommits: false,
        hasUncommittedChanges: false,
      },
    });
    mocks.archive.mockResolvedValue({
      ok: true,
      data: workspace('ws-1', WorkspaceStatusEnum.Archived),
    });
    const run = harness([workspace('ws-1')]);

    run.send(requestArchiveWorkspace('ws-1'));
    await settle();

    expect(run.state().workspaceOperations.showArchiveWarning).toBe(false);
    expect(mocks.archive).toHaveBeenCalledExactlyOnceWith('ws-1');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('never asks for local changes in the bulk archive/delete flows', async () => {
    mocks.archive.mockResolvedValue({
      ok: true,
      data: workspace('ws-1', WorkspaceStatusEnum.Archived),
    });
    mocks.deleteWorkspace.mockResolvedValue({ ok: true, data: undefined });
    const run = harness([
      workspace('ws-1'),
      workspace('ws-2'),
      workspace('ws-3', WorkspaceStatusEnum.Archived),
    ]);

    run.send(openBulkArchiveConfirm({ workspaceIds: ['ws-1', 'ws-2'], groupLabel: 'Active' }));
    run.send(confirmBulkArchive());
    await settle();
    run.send(openBulkDeleteConfirm({ workspaceIds: ['ws-3'], groupLabel: 'Archived' }));
    run.send(confirmBulkDelete());
    await settle();

    expect(new Set(mocks.getActiveWorkNames.mock.calls.map(([id]) => id))).toEqual(
      new Set(['ws-1', 'ws-2', 'ws-3']),
    );
    // Bulk paths never pass includeLocalChanges — the RPC is single-workspace only
    for (const call of mocks.getActiveWorkNames.mock.calls) {
      expect(call).toHaveLength(1);
    }
    run.task.cancel();
    await run.task.toPromise();
  });

  it('restores a soft-hidden workspace when the delete RPC fails at request time', async () => {
    mocks.deleteWorkspace.mockResolvedValue({ ok: false, error: 'delete failed' });
    const run = harness([workspace('ws-1')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await settle();
    run.task.cancel();
    await run.task.toPromise();
    expect(mocks.deleteWorkspace).toHaveBeenCalledExactlyOnceWith('ws-1', {
      undoDelayMs: WORKSPACE_OPERATION_UNDO_DURATION_MS,
    });
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toMatchObject({ id: 'ws-1' });
    expect(run.state().workspace.pendingDeletions['ws-1']).toBeUndefined();
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
  });

  it('runs deletion undo windows concurrently and undoes each via cancelDelete', async () => {
    mocks.getActiveWorkNames.mockReturnValue(noActiveWork);
    mocks.navigate.mockReturnValue(undefined);
    mocks.deleteWorkspace.mockResolvedValue({
      ok: true,
      data: { scheduled: true, deleteAt: new Date(Date.now() + 15_000).toISOString() },
    });
    mocks.cancelDelete.mockResolvedValue({ ok: true, data: { cancelled: true } });
    const run = harness([workspace('ws-1'), workspace('ws-2')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await settle();
    run.send(requestDeleteWorkspace('ws-2'));
    await settle();

    expect(mocks.deleteWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.toast.warning).toHaveBeenCalledTimes(2);
    for (const [, options] of mocks.toast.warning.mock.calls) {
      (options as { action: { onClick: () => void } }).action.onClick();
    }
    await settle();
    expect(mocks.cancelDelete.mock.calls).toEqual([['ws-1'], ['ws-2']]);
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toMatchObject({ id: 'ws-1' });
    expect(getItem(run.state().workspace.workspaces, 'ws-2')).toMatchObject({ id: 'ws-2' });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('ignores repeated delete requests for the same soft-hidden workspace', async () => {
    vi.useFakeTimers();
    mocks.getActiveWorkNames.mockReturnValue(noActiveWork);
    mocks.navigate.mockReturnValue(undefined);
    mocks.deleteWorkspace.mockResolvedValue({
      ok: true,
      data: { scheduled: true, deleteAt: new Date(Date.now() + 15_000).toISOString() },
    });
    const run = harness([workspace('ws-1')]);
    run.send(requestDeleteWorkspace('ws-1'));
    run.send(requestDeleteWorkspace('ws-1'));
    await vi.advanceTimersByTimeAsync(WORKSPACE_OPERATION_UNDO_DURATION_MS);

    expect(mocks.deleteWorkspace).toHaveBeenCalledExactlyOnceWith('ws-1', {
      undoDelayMs: WORKSPACE_OPERATION_UNDO_DURATION_MS,
    });
    run.task.cancel();
    await run.task.toPromise();
    expect(mocks.deleteWorkspace).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
  });

  it('undoes archive and handles direct unarchive success and failure', async () => {
    mocks.archive.mockResolvedValue({
      ok: true,
      data: workspace('ws-1', WorkspaceStatusEnum.Archived),
    });
    mocks.unarchive
      .mockResolvedValueOnce({ ok: true, data: workspace('ws-1') })
      .mockResolvedValueOnce({ ok: true, data: workspace('ws-2') })
      .mockResolvedValueOnce({ ok: false, error: 'denied' });
    const run = harness([
      workspace('ws-1'),
      workspace('ws-2', WorkspaceStatusEnum.Archived),
      workspace('ws-3', WorkspaceStatusEnum.Archived),
    ]);
    run.send(requestArchiveWorkspace('ws-1'));
    await settle();
    expect(mocks.toast.warning).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      expect.objectContaining({
        duration: WORKSPACE_OPERATION_UNDO_DURATION_MS,
        class: expect.stringContaining(TOAST_COUNTDOWN_CLASS),
      }),
    );
    latestUndo()?.();
    await settle();
    // Undo focuses the restored workspace: tab reopen + navigation
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'tabState/openWorkspaceTab',
      payload: ['ws-1'],
    });
    expect(mocks.navigateToRoute).toHaveBeenCalledExactlyOnceWith('/workspace/ws-1');
    run.send(requestUnarchiveWorkspace('ws-2'));
    await settle();
    run.send(requestUnarchiveWorkspace('ws-3'));
    await settle();
    expect(mocks.unarchive.mock.calls).toEqual([['ws-1'], ['ws-2'], ['ws-3']]);
    expect(mocks.toast.success).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    // Direct unarchive gets no focus behavior — only the undo path does
    expect(mocks.navigateToRoute).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('deletes every requested workspace sequentially, including archived workspaces', async () => {
    vi.useFakeTimers();
    const empty = harness([workspace('other')]);
    empty.send(openBulkArchiveConfirm({ workspaceIds: ['missing'], groupLabel: 'Missing' }));
    empty.send(confirmBulkArchive());
    await vi.advanceTimersByTimeAsync(50);
    empty.send(openBulkDeleteConfirm({ workspaceIds: ['missing'], groupLabel: 'Missing' }));
    empty.send(confirmBulkDelete());
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    expect(mocks.toast.info).toHaveBeenCalledTimes(2);
    empty.task.cancel();
    await empty.task.toPromise();

    vi.clearAllMocks();
    const bulkPr = {
      number: 9,
      title: 'fix: bulk',
      url: 'https://github.com/o/r/pull/9',
      status: 'Open' as const,
    };
    mocks.getActiveWorkNames.mockImplementation((workspaceId: string) =>
      Promise.resolve(
        workspaceId === 'ws-2'
          ? { ...noActiveWork, hookNames: ['pr-watch'], openPrs: [bulkPr] }
          : { ...noActiveWork, agentNames: ['Ada'], openPrs: [bulkPr] },
      ),
    );
    mocks.deleteWorkspace
      .mockResolvedValueOnce({ ok: true, data: undefined })
      .mockResolvedValueOnce({ ok: false, error: 'timed out waiting' })
      .mockResolvedValueOnce({ ok: false, error: 'denied' });
    const run = harness([
      workspace('ws-1'),
      workspace('ws-2', WorkspaceStatusEnum.Archived),
      workspace('ws-3'),
    ]);
    run.send(
      openBulkDeleteConfirm({
        workspaceIds: ['ws-1', 'missing', 'ws-2', 'ws-3'],
        groupLabel: 'All workspaces',
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'workspaceOperations/bulkActiveWorkComputed',
      payload: [{ kind: 'delete', agentCount: 2, hookCount: 1, token: 1 }],
    });
    run.send(confirmBulkDelete());
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.navigate.mock.calls).toEqual([['ws-1'], ['ws-2'], ['ws-3']]);
    expect(mocks.deleteWorkspace.mock.calls).toEqual([['ws-1'], ['ws-2'], ['ws-3']]);
    expect(mocks.deleteWorkspace).toHaveBeenCalledTimes(3);
    expect(mocks.toast.success).toHaveBeenCalledTimes(1);
    expect(mocks.toast.info).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    // Only the successful delete (ws-1) is tombstoned; a stale refetch cannot
    // resurrect it, and the grace timer clears the tombstone afterwards.
    expect(run.state().workspace.pendingDeletions).toEqual({ 'ws-1': true });
    run.send(replaceWorkspaceList([workspace('ws-1', WorkspaceStatusEnum.Archived)]));
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
    expect(run.state().workspace.pendingDeletions).toEqual({});
    run.task.cancel();
    await run.task.toPromise();
  });

  it('removes a repository, reports invoke failure, and no-ops without a pending path', async () => {
    mocks.invoke
      .mockResolvedValueOnce({ success: true, data: { removed: true } })
      .mockResolvedValueOnce({ success: false, error: 'denied' });
    const run = harness([]);
    run.send(confirmRemoveRepo());
    await settle();
    expect(mocks.invoke).not.toHaveBeenCalled();
    run.send(openRemoveRepoConfirm('/repo/one'));
    run.send(confirmRemoveRepo());
    await settle();
    run.send(openRemoveRepoConfirm('/repo/two'));
    run.send(confirmRemoveRepo());
    await settle();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.calls[0]).toEqual([
      'workspace:remove-recent-repository',
      { repository: '/repo/one' },
    ]);
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'knownRepos/removeRepo',
      payload: ['/repo/one'],
    });
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('applies edited create proposals, stores success, and preserves structured failure', async () => {
    mocks.create
      .mockResolvedValueOnce({ ok: true, data: { workspace: workspace('ws-created') } })
      .mockResolvedValueOnce({
        ok: false,
        error: 'cannot resolve base ref',
        errorCode: 'base-ref-unresolvable',
      });
    const run = harness([]);
    run.send(
      applyWorkspaceProposal({
        proposal: createProposal('create-success'),
        editedFields: { branch: 'feature/x', initialPrompt: 'Edited prompt' },
      }),
    );
    await settle();
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
      title: 'New space',
      repositoryPath: '/repo',
      baseRef: 'feature/x',
      initialAgent: {
        name: 'Coordinator',
        prompt: 'Edited prompt',
        metadata: { isInitialAgent: true },
      },
    });
    expect(mocks.create.mock.calls[0]?.[0]?.initialAgent).not.toHaveProperty('agentId');
    expect(getItem(run.state().workspace.workspaces, 'ws-created')).toBeDefined();
    expect(run.state().proposalLifecycle['create-success']).toMatchObject({
      status: 'applied',
      result: { workspaceId: 'ws-created' },
    });

    run.send(applyWorkspaceProposal({ proposal: createProposal('create-failure') }));
    await settle();
    expect(run.state().proposalLifecycle['create-failure']).toMatchObject({
      status: 'failed',
      error: 'cannot resolve base ref',
      errorCode: 'base-ref-unresolvable',
    });
    expect(mocks.toast.error).toHaveBeenCalledWith('cannot resolve base ref');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('coalesces duplicate sibling activation and reuses its stable key on retry', async () => {
    const proposal = createProposal('sibling-create');
    proposal.payload.params = {
      ...proposal.payload.params,
      idempotencyKey: 'sibling-stable-key',
    };
    proposal.preview.workspaceCreate = { mode: 'sibling', title: 'New space' };
    mocks.create
      .mockResolvedValueOnce({ ok: false, error: 'connection lost' })
      .mockResolvedValueOnce({ ok: true, data: { workspace: workspace('ws-sibling') } });
    const run = harness([]);
    const action = applyWorkspaceProposal({ proposal, editedFields: { title: 'Edited space' } });

    run.send(action);
    run.send(action);
    await settle();
    expect(mocks.create).toHaveBeenCalledTimes(1);

    run.send(action);
    await settle();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls.map(([request]) => request.idempotencyKey)).toEqual([
      'sibling-stable-key',
      'sibling-stable-key',
    ]);
    expect(run.state().proposalLifecycle['sibling-create']).toMatchObject({
      status: 'applied',
      result: { workspaceId: 'ws-sibling' },
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('honors selected bulk ids and fails empty archive selections loudly', async () => {
    mocks.archive.mockResolvedValue({
      ok: true,
      data: workspace('ws-2', WorkspaceStatusEnum.Archived),
    });
    const run = harness([workspace('ws-1'), workspace('ws-2')]);
    run.send(
      applyWorkspaceProposal({
        proposal: bulkProposal('workspace.bulkArchive', ['ws-1', 'ws-2'], 'selected-archive'),
        selectedBulkItemIds: ['ws-2'],
      }),
    );
    await settle();
    expect(mocks.archive).toHaveBeenCalledExactlyOnceWith('ws-2');
    expect(run.state().proposalLifecycle['selected-archive']).toMatchObject({ status: 'applied' });

    run.send(
      applyWorkspaceProposal({
        proposal: bulkProposal('workspace.bulkArchive', ['ws-1'], 'empty-archive'),
        selectedBulkItemIds: [],
      }),
    );
    await settle();
    expect(mocks.archive).toHaveBeenCalledTimes(1);
    expect(run.state().proposalLifecycle['empty-archive']).toMatchObject({ status: 'failed' });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('marks a partially failed bulk archive proposal failed while converging successes', async () => {
    mocks.archive
      .mockResolvedValueOnce({ ok: false, error: 'denied' })
      .mockResolvedValueOnce({ ok: true, data: workspace('ws-2', WorkspaceStatusEnum.Archived) });
    const run = harness([workspace('ws-1'), workspace('ws-2')]);
    run.send(
      applyWorkspaceProposal({
        proposal: bulkProposal('workspace.bulkArchive', ['ws-1', 'ws-2'], 'archive-partial'),
      }),
    );
    await settle();
    expect(mocks.archive).toHaveBeenCalledTimes(2);
    expect(run.state().proposalLifecycle['archive-partial']).toMatchObject({ status: 'failed' });
    expect(getItem(run.state().workspace.workspaces, 'ws-2')).toMatchObject({
      status: WorkspaceStatusEnum.Archived,
      archived: true,
    });
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('applies bulk delete success/timeouts and marks hard failures while deduplicating lifecycle ids', async () => {
    vi.useFakeTimers();
    mocks.deleteWorkspace
      .mockResolvedValueOnce({ ok: true, data: undefined })
      .mockResolvedValueOnce({ ok: false, error: 'timed out waiting' })
      .mockResolvedValueOnce({ ok: false, error: 'denied' });
    const run = harness([
      workspace('ws-1', WorkspaceStatusEnum.Archived),
      workspace('ws-2', WorkspaceStatusEnum.Archived),
      workspace('ws-3', WorkspaceStatusEnum.Archived),
    ]);
    const applied = bulkProposal('workspace.bulkDelete', ['ws-1', 'ws-2'], 'delete-applied');
    run.send(applyWorkspaceProposal({ proposal: applied }));
    await vi.advanceTimersByTimeAsync(50);
    run.send(applyWorkspaceProposal({ proposal: applied }));
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.deleteWorkspace).toHaveBeenCalledTimes(2);
    expect(run.state().proposalLifecycle['delete-applied']).toMatchObject({ status: 'applied' });
    expect(mocks.toast.success).toHaveBeenCalledTimes(1);
    expect(mocks.toast.info).toHaveBeenCalledTimes(1);
    // The successful delete (ws-1) is tombstoned for the grace window; a stale
    // refetch cannot re-admit it, and the timer clears the tombstone afterwards.
    expect(run.state().workspace.pendingDeletions).toEqual({ 'ws-1': true });
    run.send(setWorkspaceEntity(workspace('ws-1', WorkspaceStatusEnum.Archived)));
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toBeUndefined();

    run.send(
      applyWorkspaceProposal({
        proposal: bulkProposal('workspace.bulkDelete', ['ws-3'], 'delete-failed'),
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(run.state().proposalLifecycle['delete-failed']).toMatchObject({ status: 'failed' });
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
    expect(run.state().workspace.pendingDeletions).toEqual({});
    run.task.cancel();
    await run.task.toPromise();
  });
});
