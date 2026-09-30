import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { store } from '../../../store';
import type { AcceptChangesResult } from '$features/accept-changes/types';
import { initialState as guestInitialState } from '../../guest-sessions/guest-sessions-slice';
import { fileTrackingReducer, setCommitMessage, setCommitsData } from '../../changes/changes-slice';
import { gitReducer } from '../../git/git-slice';
import { selectPostMergeState } from '../../git/git-selectors';
import { selectAcceptOperation } from '../accept-workflow-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  acceptWorkflowReducer,
  addAcceptRemoteRequested,
  archiveAndStartRequested,
  executeAcceptRequested,
  mergePRAcceptRequested,
  mergePRWorkflowRequested,
  mergeToTrunkRequested,
  prepareAcceptRequested,
  resetAcceptToTrunkRequested,
  resetAndContinueRequested,
  setMergeDrawerOpen,
  undoAcceptRequested,
} from '../accept-workflow-slice';
import { acceptWorkflowSaga } from './accept-workflow-saga';
import { reserveGitMutation, isGitMutationPending } from '../../../utils/worktree-mutation-queue';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  details: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  confetti: vi.fn(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
vi.mock('$lib/client', () => ({ appClient: { git: { commitDetails: mocks.details } } }));
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mocks.update, archive: mocks.archive, unarchive: mocks.unarchive },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.error, success: mocks.success, warning: mocks.warning },
}));
vi.mock('canvas-confetti', () => ({ default: mocks.confetti }));

const tasks: Task[] = [];
const success: AcceptChangesResult = {
  success: true,
  steps: [],
  result: { newHeadSha: 'new-head' },
};
const options = {
  hasStaged: true,
  commitMessage: '  merge work  ',
  targetBranch: 'main',
  mergeHeadSha: 'old-head',
  squash: true,
  localOnly: true,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function harness(overrides = {}) {
  const channel = stdChannel();
  let state = withLegacyPrincipal({
    acceptWorkflow: acceptWorkflowReducer(undefined, setMergeDrawerOpen('a', true)),
    changes: fileTrackingReducer(undefined, setCommitMessage('a', options.commitMessage)),
    git: gitReducer(undefined, { type: 'init' }),
    workspace: {
      workspaces: createCollection('id', [
        {
          id: 'a',
          myRole: 'owner',
          baseCommitSha: 'base',
          repositoryPath: '/repo',
          worktreePath: '/worktrees/a',
          archived: false,
          ...overrides,
        },
        { id: 'b', myRole: 'owner' },
      ]),
    },
    connections: { activeId: LOCAL_CONNECTION_ID, windowBackendId: LOCAL_CONNECTION_ID },
    guestSessions: { ...guestInitialState, hasReceivedList: true },
  });
  const actions: { type: string; payload?: unknown }[] = [];
  const dispatch = (action: { type: string }) => {
    actions.push(action);
    state = {
      ...state,
      acceptWorkflow: acceptWorkflowReducer(state.acceptWorkflow, action),
      changes: fileTrackingReducer(state.changes, action),
      git: gitReducer(state.git, action),
    };
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, acceptWorkflowSaga);
  tasks.push(task);
  return {
    task,
    dispatch,
    actions,
    state: () => state,
    changeRole: () => {
      state.workspace.workspaces.map.a.myRole = 'collaborator';
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  mocks.request.mockResolvedValue(success);
  mocks.update.mockResolvedValue({ ok: true, data: { id: 'a', baseCommitSha: 'new-head' } });
  mocks.archive.mockResolvedValue({ ok: true });
  mocks.unarchive.mockResolvedValue({ ok: true });
});
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  await settle();
});

describe('acceptWorkflowSaga', () => {
  it.each([
    { name: 'prepare', create: () => prepareAcceptRequested('a', 'commit'), inBand: false },
    {
      name: 'add remote',
      create: () => addAcceptRemoteRequested('a', 'https://example.com/repo'),
      inBand: false,
    },
    { name: 'execute', create: () => executeAcceptRequested('a', 'commit'), inBand: true },
    { name: 'merge PR', create: () => mergePRAcceptRequested('a', 42), inBand: true },
    { name: 'reset', create: () => resetAcceptToTrunkRequested('a'), inBand: true },
  ])(
    'settles queued $name once on workspace unmount without starting transport',
    async ({ create, inBand }) => {
      const lease = reserveGitMutation('a');
      const run = harness();
      const action = create();
      const settled = inBand
        ? expect(action.promise).resolves.toEqual({
            success: false,
            steps: [],
            error: 'Accept workflow cancelled',
          })
        : expect(action.promise).rejects.toThrow('Accept workflow cancelled');
      try {
        run.dispatch(action);
        run.dispatch(workspaceUnmounted('a'));
        await settled;
        await lease.release();
        await settle();
        expect(mocks.request).not.toHaveBeenCalled();
        expect(
          run.actions.filter(
            ({ type }) => type === action.success.type || type === action.failure.type,
          ),
        ).toHaveLength(1);
        expect(run.state().acceptWorkflow.byWorkspaceId.a).toBeUndefined();
      } finally {
        await lease.release();
      }
    },
  );

  it('cancels only the closed workspace and preserves another workspace transport', async () => {
    const first = deferred<AcceptChangesResult>();
    const second = deferred<AcceptChangesResult>();
    mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const run = harness();
    const a = executeAcceptRequested('a', 'commit');
    const b = executeAcceptRequested('b', 'commit');
    run.dispatch(a);
    run.dispatch(b);
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    run.dispatch(workspaceUnmounted('a'));
    await expect(a.promise).resolves.toMatchObject({ success: false });
    second.resolve(success);
    await expect(b.promise).resolves.toEqual(success);
    first.resolve(success);
    await settle();
    expect(selectAcceptOperation.select(run.state() as never, 'b', 'execute')?.status).toBe(
      'succeeded',
    );
    expect(run.state().acceptWorkflow.byWorkspaceId.a).toBeUndefined();
    expect(run.actions.filter(({ type }) => type === a.success.type)).toHaveLength(2);
  });

  it('settles a successful facade once when unmounted during its reconciliation tail', async () => {
    const run = harness();
    const action = executeAcceptRequested('a', 'commit');
    run.dispatch(action);
    expect(await action.promise).toEqual(success);
    expect(isGitMutationPending('a')).toBe(true);
    run.dispatch(workspaceUnmounted('a'));
    const actionCount = run.actions.length;
    await settle();
    expect(
      run.actions.filter(
        ({ type }) => type === action.success.type || type === action.failure.type,
      ),
    ).toHaveLength(1);
    expect(run.actions).toHaveLength(actionCount);
    expect(isGitMutationPending('a')).toBe(false);
  });

  it('admits a remounted reset but waits for the cancelled transport to finish', async () => {
    const pending = deferred<AcceptChangesResult>();
    mocks.request.mockReturnValueOnce(pending.promise);
    const run = harness();
    run.dispatch(resetAndContinueRequested('a'));
    await settle();
    run.dispatch(workspaceUnmounted('a'));
    run.dispatch(resetAndContinueRequested('a'));
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    pending.resolve(success);
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ id: 'a', baseCommitSha: 'new-head' });
    expect(selectPostMergeState.select(run.state() as never, 'a').hasResetToTrunk).toBe(true);
  });

  const uiRequests = [
    { name: 'reset', create: () => resetAndContinueRequested('a') },
    { name: 'commit then merge', create: () => mergeToTrunkRequested('a', options) },
    {
      name: 'PR merge',
      create: () => mergePRWorkflowRequested('a', { prNumber: 42, mergeHeadSha: 'head' }),
    },
    {
      name: 'undo',
      create: () => undoAcceptRequested('a', { action: 'undo-commit', commitHash: 'one' }),
    },
    { name: 'archive', create: () => archiveAndStartRequested('a') },
  ];

  function seedUndo(run: ReturnType<typeof harness>) {
    run.dispatch(
      setCommitsData(
        'a',
        [
          {
            hash: 'one',
            message: 'one',
            author: 'author',
            timestamp: 0,
            files: [{ path: 'a.ts', additions: 1, deletions: 0 }],
            stage: 'local',
            isPushed: false,
          },
        ],
        'base',
      ),
    );
  }

  it.each(uiRequests)('does not start queued $name after workspace unmount', async ({ create }) => {
    const lease = reserveGitMutation('a');
    const run = harness();
    seedUndo(run);
    try {
      run.dispatch(create());
      await settle();
      expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
      run.dispatch(workspaceUnmounted('a'));
      const actionCount = run.actions.length;
      await lease.release();
      await settle();
      expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.details).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
      expect(run.actions).toHaveLength(actionCount);
      expect(run.state().acceptWorkflow.byWorkspaceId.a).toBeUndefined();
      expect(isGitMutationPending('a')).toBe(false);
    } finally {
      await lease.release();
    }
  });

  it.each(uiRequests)(
    'suppresses started $name followups after workspace unmount',
    async ({ create }) => {
      const pending = deferred<AcceptChangesResult>();
      const archived = deferred<{ ok: boolean }>();
      mocks.request.mockReturnValueOnce(pending.promise);
      mocks.archive.mockReturnValueOnce(archived.promise);
      const run = harness({ archived: true });
      seedUndo(run);
      try {
        run.dispatch(create());
        await settle();
        expect(mocks.request.mock.calls.length + mocks.archive.mock.calls.length).toBe(1);
        run.dispatch(workspaceUnmounted('a'));
        const actionCount = run.actions.length;
        expect(isGitMutationPending('a')).toBe(true);
        pending.resolve(success);
        archived.resolve({ ok: true });
        await vi.waitFor(() => expect(isGitMutationPending('a')).toBe(false));
        expect(mocks.request.mock.calls.length + mocks.archive.mock.calls.length).toBe(1);
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.unarchive).not.toHaveBeenCalled();
        expect(mocks.success).not.toHaveBeenCalled();
        expect(mocks.warning).not.toHaveBeenCalled();
        expect(mocks.error).not.toHaveBeenCalled();
        expect(mocks.confetti).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('workspace-prefill')).toBeNull();
        expect(run.actions).toHaveLength(actionCount);
        expect(run.state().acceptWorkflow.byWorkspaceId.a).toBeUndefined();
        expect(run.state().git.byWorkspaceId.a).toBeUndefined();
      } finally {
        pending.resolve(success);
        archived.resolve({ ok: true });
        await settle();
      }
    },
  );

  it('preserves a newer draft while an accepted merge finishes', async () => {
    const pending = deferred<AcceptChangesResult>();
    mocks.request.mockReturnValueOnce(pending.promise);
    const run = harness();
    run.dispatch(mergeToTrunkRequested('a', options));
    await settle();
    run.dispatch(setCommitMessage('a', 'next task draft'));
    pending.resolve(success);
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    expect(run.state().changes.byWorkspaceId.a.acceptChanges.commitMessage).toBe('next task draft');
  });

  it('offers a scoped rebase intent on conflict without replaying the merge', async () => {
    mocks.request.mockResolvedValue({ success: false, steps: [], error: 'Conflicts detected' });
    const run = harness();
    run.dispatch(mergeToTrunkRequested('a', { ...options, hasStaged: false }));
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
    const dispatch = vi.fn();
    const spy = vi.spyOn(store, 'dispatch', 'get').mockReturnValue(dispatch);
    try {
      mocks.error.mock.calls[0][1].action.onClick();
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          asyncActionType: 'prWorkflow/requested',
          payload: expect.objectContaining({
            workspaceId: 'a',
            command: { kind: 'rebase-terminal', targetBranch: 'main' },
          }),
        }),
      );
      expect(mocks.request).toHaveBeenCalledTimes(1);
      expect(mocks.confetti).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('owns commit-then-merge once and invalidates after releasing the shared write barrier', async () => {
    const pending = deferred<AcceptChangesResult>();
    mocks.request.mockReturnValueOnce(pending.promise);
    const run = harness();
    run.dispatch(mergeToTrunkRequested('a', options));
    run.dispatch(mergeToTrunkRequested('a', options));
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(JSON.stringify(mocks.request.mock.calls[0]))).toEqual([
      'accept-changes.execute',
      { workspaceId: 'a', action: 'commit', commitMessage: 'merge work', options: {} },
    ]);
    pending.resolve(success);
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    await settle();
    expect(JSON.parse(JSON.stringify(mocks.request.mock.calls[1]))).toEqual([
      'accept-changes.execute',
      {
        workspaceId: 'a',
        action: 'merge',
        targetBranch: 'main',
        mergeStrategy: 'squash',
        options: { localOnly: true },
      },
    ]);
    expect(selectPostMergeState.select(run.state() as never, 'a')).toMatchObject({
      isMergedToTrunk: true,
      mergeHeadSha: 'old-head',
    });
    expect(run.state().acceptWorkflow.byWorkspaceId.a.mergeDrawerOpen).toBe(false);
    expect(run.state().changes.byWorkspaceId.a.acceptChanges.commitMessage).toBe('');
    expect(mocks.confetti).toHaveBeenCalledTimes(1);
    expect(isGitMutationPending('a')).toBe(false);
    expect(
      run.actions
        .filter((a) => ['git/loadStatus', 'changes/refreshRequested'].includes(a.type))
        .map((a) => a.type),
    ).toEqual(['git/loadStatus', 'changes/refreshRequested']);
    run.dispatch(setMergeDrawerOpen('a', true));
    await settle();
    expect(mocks.confetti).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('does not merge or clear the draft after an in-band commit failure', async () => {
    mocks.request.mockResolvedValue({ success: false, steps: [], error: 'commit refused' });
    const run = harness();
    run.dispatch(mergeToTrunkRequested('a', options));
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledWith('commit refused'));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(run.state().acceptWorkflow.byWorkspaceId.a.mergeDrawerOpen).toBe(true);
    expect(run.state().changes.byWorkspaceId.a.acceptChanges.commitMessage).toBe(
      options.commitMessage,
    );
    expect(selectAcceptOperation.select(run.state() as never, 'a', 'merge')?.status).toBe('failed');
    expect(mocks.confetti).not.toHaveBeenCalled();
  });

  it('keeps facade failures in-band and permits a different workspace during pending work', async () => {
    const pending = deferred<AcceptChangesResult>();
    mocks.request.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error('offline'));
    const run = harness();
    const first = executeAcceptRequested('a', 'commit');
    const second = executeAcceptRequested('b', 'commit');
    run.dispatch(first);
    await settle();
    run.dispatch(second);
    await expect(second.promise).resolves.toEqual({ success: false, steps: [], error: 'offline' });
    pending.resolve(success);
    await expect(first.promise).resolves.toEqual(success);
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('checks current authorization after queue wait, without sending a write', async () => {
    const lease = reserveGitMutation('a');
    const run = harness();
    const action = executeAcceptRequested('a', 'commit');
    run.dispatch(action);
    run.changeRole();
    await lease.release();
    await expect(action.promise).resolves.toMatchObject({ success: false });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('settles cancellation in-band and retains the transport barrier across owner restart', async () => {
    const pending = deferred<AcceptChangesResult>();
    mocks.request.mockReturnValueOnce(pending.promise);
    const run = harness();
    const action = executeAcceptRequested('a', 'commit');
    const settled = expect(action.promise).resolves.toEqual({
      success: false,
      steps: [],
      error: 'Accept workflow cancelled',
    });
    run.dispatch(action);
    await settle();
    run.task.cancel();
    await run.task.toPromise();
    await settled;
    expect(selectAcceptOperation.select(run.state() as never, 'a', 'execute')?.status).toBe(
      'cancelled',
    );
    const next = harness();
    const nextAction = executeAcceptRequested('a', 'commit');
    next.dispatch(nextAction);
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    pending.resolve(success);
    await nextAction.promise;
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('owns the exact PR merge request and one-shot completion', async () => {
    const run = harness();
    run.dispatch(
      mergePRWorkflowRequested('a', { prNumber: 42, mergeMethod: 'squash', mergeHeadSha: 'head' }),
    );
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    expect(mocks.request).toHaveBeenCalledWith('accept-changes.mergePR', {
      workspaceId: 'a',
      prNumber: 42,
      mergeMethod: 'squash',
      commitTitle: undefined,
      commitMessage: undefined,
    });
    expect(run.actions.some((a) => a.type === 'prStatus/refreshRequested')).toBe(true);
    expect(mocks.confetti).toHaveBeenCalledTimes(1);
  });

  it('resets the boundary and merge state and best-effort unarchives without replay', async () => {
    mocks.unarchive.mockRejectedValue(new Error('unarchive unavailable'));
    const run = harness({ archived: true });
    run.dispatch(resetAndContinueRequested('a'));
    await vi.waitFor(() => expect(mocks.unarchive).toHaveBeenCalledWith('a'));
    await settle();
    expect(mocks.request).toHaveBeenCalledWith('accept-changes.execute', {
      workspaceId: 'a',
      action: 'reset-to-trunk',
    });
    expect(mocks.update).toHaveBeenCalledWith({ id: 'a', baseCommitSha: 'new-head' });
    expect(selectPostMergeState.select(run.state() as never, 'a')).toMatchObject({
      isMergedToTrunk: false,
      hasResetToTrunk: true,
      mergeHeadSha: null,
    });
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('does not hide successful reset when the boundary refresh fails', async () => {
    mocks.update.mockResolvedValue({ ok: false, error: 'offline' });
    const run = harness();
    run.dispatch(resetAndContinueRequested('a'));
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    expect(selectPostMergeState.select(run.state() as never, 'a').hasResetToTrunk).toBe(true);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([
    ['/repo', '/worktrees/a', { repoPath: '/repo' }],
    ['/workspaces/a/repo', '/workspaces/a/repo', null],
    ['/workspaces/.repo-cache/owner/repo', '/worktrees/a', null],
  ])(
    'archives once and gates local prefill for %s',
    async (repositoryPath, worktreePath, prefill) => {
      const run = harness({ repositoryPath, worktreePath });
      run.dispatch(archiveAndStartRequested('a'));
      run.dispatch(archiveAndStartRequested('a'));
      await vi.waitFor(() =>
        expect(run.actions.some((a) => a.type === 'sidebarNav/setShowCreateModal')).toBe(true),
      );
      expect(mocks.archive).toHaveBeenCalledExactlyOnceWith('a');
      expect(JSON.parse(sessionStorage.getItem('workspace-prefill') ?? 'null')).toEqual(prefill);
    },
  );

  it('does not navigate after archive failure', async () => {
    mocks.archive.mockResolvedValue({ ok: false });
    const run = harness();
    run.dispatch(archiveAndStartRequested('a'));
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
    expect(run.actions.some((a) => a.type === 'sidebarNav/setShowCreateModal')).toBe(false);
  });

  it('derives undo boundaries and metadata from the requested workspace, not the component', async () => {
    const run = harness();
    run.dispatch(
      setCommitsData(
        'a',
        [
          {
            hash: 'one',
            message: 'one',
            author: 'author',
            timestamp: 0,
            files: [{ path: 'a.ts', additions: 2, deletions: 0 }],
            stage: 'local',
            isPushed: false,
          },
          {
            hash: 'two',
            message: 'two',
            author: 'author',
            timestamp: 0,
            files: [],
            stage: 'local',
            isPushed: true,
          },
        ],
        'base',
      ),
    );
    run.dispatch(undoAcceptRequested('a', { action: 'undo-commit', commitHash: 'one' }));
    await vi.waitFor(() => expect(mocks.warning).toHaveBeenCalledTimes(1));
    expect(JSON.parse(JSON.stringify(mocks.request.mock.calls[0]))).toEqual([
      'accept-changes.execute',
      {
        workspaceId: 'a',
        action: 'undo-commit',
        upToCommitHash: 'two',
        undoCommitsMetadata: [{ hash: 'one', files: ['a.ts'] }],
        options: {},
      },
    ]);
  });
});
