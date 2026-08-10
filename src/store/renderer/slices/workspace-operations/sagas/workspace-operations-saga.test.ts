import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  archive: vi.fn(),
  unarchive: vi.fn(),
  deleteWorkspace: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
  getActiveWorkNames: vi.fn(),
  invoke: vi.fn(),
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: {
    archive: mocks.archive,
    unarchive: mocks.unarchive,
    delete: mocks.deleteWorkspace,
    create: mocks.create,
  },
}));
vi.mock('$features/workspace/navigate-away-if-viewing', () => ({
  navigateAwayIfViewing: mocks.navigate,
}));
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
  confirmBulkDeleteArchived,
  confirmBulkDeleteWarning,
  confirmDeleteWorkspace,
  confirmRemoveRepo,
  initialState as operationsInitialState,
  openBulkArchiveConfirm,
  openBulkDeleteArchivedConfirm,
  openRemoveRepoConfirm,
  requestArchiveWorkspace,
  requestDeleteWorkspace,
  requestUnarchiveWorkspace,
  workspaceOperationsReducer,
} from '../workspace-operations-slice';
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
    mocks.getActiveWorkNames.mockResolvedValue({ agentNames: [], hookNames: [] });
    mocks.navigate.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('uses the exact archive wire call and reports a failed result without updating state', async () => {
    mocks.navigate.mockResolvedValue(undefined);
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
    expect(
      run.dispatch.mock.calls
        .flat()
        .some((action) => action?.type === 'workspace/bulkUpdateWorkspaceEntities'),
    ).toBe(true);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('archives a repository concurrently with all-settled partial failure accounting', async () => {
    mocks.archive
      .mockResolvedValueOnce({ ok: true, data: workspace('ws-1', WorkspaceStatusEnum.Archived) })
      .mockRejectedValueOnce(new Error('offline'));
    const run = harness([workspace('ws-1'), workspace('ws-2')]);
    run.send(openBulkArchiveConfirm('intent-hq/repo'));
    run.send(confirmBulkArchive());
    await settle();
    expect(mocks.archive).toHaveBeenCalledTimes(2);
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

  it('keeps the tombstone after a committed delete so stale refetches cannot resurrect the workspace', async () => {
    vi.useFakeTimers();
    mocks.deleteWorkspace.mockResolvedValue({ ok: true, data: undefined });
    const run = harness([workspace('ws-1')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await vi.advanceTimersByTimeAsync(50);
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toBeUndefined();
    expect(run.state().workspace.pendingDeletions['ws-1']).toBe(true);

    // Undo window elapses and the delete commits successfully
    await vi.advanceTimersByTimeAsync(WORKSPACE_OPERATION_UNDO_DURATION_MS);
    expect(mocks.deleteWorkspace).toHaveBeenCalledExactlyOnceWith('ws-1');
    // Tombstone must survive the successful commit for the grace window
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

  it('flushes a pending soft delete to the wire when the root is cancelled', async () => {
    vi.useFakeTimers();
    mocks.navigate.mockResolvedValue(undefined);
    mocks.deleteWorkspace.mockResolvedValue({ ok: true, data: undefined });
    const run = harness([workspace('ws-1')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
    expect(mocks.deleteWorkspace).toHaveBeenCalledWith('ws-1');
    // Drain the detached tombstone-grace timer so it cannot bleed across tests
    await vi.advanceTimersByTimeAsync(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
    expect(run.state().workspace.pendingDeletions['ws-1']).toBeUndefined();
  });

  it('shows the delete warning, confirms it, and restores the soft-hidden workspace on undo', async () => {
    mocks.getActiveWorkNames.mockResolvedValue({ agentNames: ['Ada'], hookNames: ['ci-watch'] });
    const run = harness([workspace('ws-1')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await settle();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'workspaceOperations/openDeleteWarning',
      payload: [{ workspaceId: 'ws-1', agentNames: ['Ada'], hookNames: ['ci-watch'] }],
    });

    run.send(confirmDeleteWorkspace());
    await settle();
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toBeUndefined();
    latestUndo()?.();
    await settle();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toMatchObject({ id: 'ws-1' });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('shows the archive warning for active hooks and archives after confirmation', async () => {
    mocks.getActiveWorkNames.mockResolvedValue({ agentNames: [], hookNames: ['pr-watch'] });
    mocks.archive.mockResolvedValue({ ok: true, data: workspace('ws-1', WorkspaceStatusEnum.Archived) });
    const run = harness([workspace('ws-1')]);

    run.send(requestArchiveWorkspace('ws-1'));
    await settle();

    expect(mocks.archive).not.toHaveBeenCalled();
    expect(run.dispatch.mock.calls.flat()).toContainEqual({
      type: 'workspaceOperations/openArchiveWarning',
      payload: [{ workspaceId: 'ws-1', agentNames: [], hookNames: ['pr-watch'] }],
    });

    run.send(confirmArchiveWorkspace());
    await settle();

    expect(mocks.archive).toHaveBeenCalledExactlyOnceWith('ws-1');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('restores a soft-hidden workspace when delete commit fails', async () => {
    mocks.deleteWorkspace.mockResolvedValue({ ok: false, error: 'delete failed' });
    const run = harness([workspace('ws-1')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await settle();
    run.task.cancel();
    await run.task.toPromise();
    expect(mocks.deleteWorkspace).toHaveBeenCalledExactlyOnceWith('ws-1');
    expect(getItem(run.state().workspace.workspaces, 'ws-1')).toMatchObject({ id: 'ws-1' });
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
  });

  it('flushes pending deletion once on repeated unload events and removes both listeners', async () => {
    vi.useFakeTimers();
    const removeListener = vi.spyOn(window, 'removeEventListener');
    mocks.deleteWorkspace.mockResolvedValue({ ok: true, data: undefined });
    const run = harness([workspace('ws-1')]);
    run.send(requestDeleteWorkspace('ws-1'));
    await vi.advanceTimersByTimeAsync(50);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(50);
    window.dispatchEvent(new Event('beforeunload'));
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.deleteWorkspace).toHaveBeenCalledExactlyOnceWith('ws-1');
    run.task.cancel();
    await run.task.toPromise();
    expect(removeListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
    // Drain the detached tombstone-grace timer so it cannot bleed across tests
    await vi.advanceTimersByTimeAsync(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
    expect(run.state().workspace.pendingDeletions['ws-1']).toBeUndefined();
    removeListener.mockRestore();
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
    latestUndo()?.();
    await settle();
    run.send(requestUnarchiveWorkspace('ws-2'));
    await settle();
    run.send(requestUnarchiveWorkspace('ws-3'));
    await settle();
    expect(mocks.unarchive.mock.calls).toEqual([['ws-1'], ['ws-2'], ['ws-3']]);
    expect(mocks.toast.success).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('reports empty bulk archive/delete and gates running-agent deletion behind confirmation', async () => {
    vi.useFakeTimers();
    const empty = harness([workspace('other')]);
    empty.send(openBulkArchiveConfirm('missing/repo'));
    empty.send(confirmBulkArchive());
    await vi.advanceTimersByTimeAsync(50);
    empty.send(openBulkDeleteArchivedConfirm('missing/repo'));
    empty.send(confirmBulkDeleteArchived());
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    expect(mocks.toast.info).toHaveBeenCalledTimes(2);
    empty.task.cancel();
    await empty.task.toPromise();

    vi.clearAllMocks();
    mocks.getActiveWorkNames.mockImplementation((workspaceId: string) =>
      Promise.resolve(
        workspaceId === 'ws-2'
          ? { agentNames: [], hookNames: ['pr-watch'] }
          : { agentNames: ['Ada'], hookNames: [] },
      ),
    );
    mocks.deleteWorkspace
      .mockResolvedValueOnce({ ok: true, data: undefined })
      .mockResolvedValueOnce({ ok: false, error: 'timed out waiting' })
      .mockResolvedValueOnce({ ok: false, error: 'denied' });
    const guarded = harness([
      workspace('ws-1', WorkspaceStatusEnum.Archived),
      workspace('ws-2', WorkspaceStatusEnum.Archived),
      workspace('ws-3', WorkspaceStatusEnum.Archived),
    ]);
    guarded.send(openBulkDeleteArchivedConfirm('intent-hq/repo'));
    guarded.send(confirmBulkDeleteArchived());
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    expect(guarded.dispatch.mock.calls.flat()).toContainEqual({
      type: 'workspaceOperations/openBulkDeleteWarningConfirm',
      payload: [{ repoKey: 'intent-hq/repo', workspaceCount: 3, agentCount: 2, hookCount: 1 }],
    });
    guarded.send(confirmBulkDeleteWarning());
    await vi.advanceTimersByTimeAsync(50);
    expect(mocks.deleteWorkspace).toHaveBeenCalledTimes(3);
    expect(mocks.toast.success).toHaveBeenCalledTimes(1);
    expect(mocks.toast.info).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    // Only the successful delete (ws-1) is tombstoned; a stale refetch cannot
    // resurrect it, and the grace timer clears the tombstone afterwards.
    expect(guarded.state().workspace.pendingDeletions).toEqual({ 'ws-1': true });
    guarded.send(replaceWorkspaceList([workspace('ws-1', WorkspaceStatusEnum.Archived)]));
    expect(getItem(guarded.state().workspace.workspaces, 'ws-1')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(WORKSPACE_DELETION_TOMBSTONE_TTL_MS);
    expect(guarded.state().workspace.pendingDeletions).toEqual({});
    guarded.task.cancel();
    await guarded.task.toPromise();
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
