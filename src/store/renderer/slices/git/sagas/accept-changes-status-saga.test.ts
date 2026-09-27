import type { Task } from 'redux-saga';
import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import {
  initialState as workspaceInitialState,
  workspaceReducer,
  setWorkspaceHasLoaded,
} from '../../workspace/workspace-slice';
import { selectPrincipalAdmissionContext } from '../../principal/principal-selectors';
import { principalReceived, principalReducer } from '../../principal/principal-slice';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';
import { refreshAcceptChangesStatus } from '../../changes/changes-slice';
import { openWorkspaceTab, tabStateReducer } from '../../tab-state/tab-state-slice';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  acceptChangesConsumerMounted,
  acceptChangesConsumerUnmounted,
  acceptChangesStatusInvalidated,
  gitReducer,
  setAcceptChangesStatus,
} from '../git-slice';
import { acceptChangesStatusSaga } from './accept-changes-status-saga';

const mocks = vi.hoisted(() => ({ getStatus: vi.fn() }));

vi.mock('$features/accept-changes/accept-changes.client', () => ({
  AcceptChangesClient: { getStatus: mocks.getStatus },
}));

const WS_A = 'ws-a';
const WS_B = 'ws-b';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function status(branch: string): WorkspaceGitStatus {
  return {
    branch,
    trunkBranch: 'main',
    aheadOfTrunk: 1,
    behindTrunk: 0,
    hasRemote: true,
    isPushed: false,
    uncommittedCount: 1,
    stagedCount: 0,
    localCommits: [],
    canMergeDirectly: false,
    hasConflicts: false,
    hasDivergedFromRemote: false,
  };
}

function harness(activeWorkspaceId = WS_A, cached: Record<string, WorkspaceGitStatus> = {}) {
  const channel = stdChannel();
  let state = withLegacyPrincipal({
    workspace: structuredClone(workspaceInitialState),
    git: gitReducer(undefined, { type: '@@INIT' }),
    tabState: tabStateReducer(undefined, openWorkspaceTab(activeWorkspaceId)),
  });
  for (const [workspaceId, value] of Object.entries(cached)) {
    state = { ...state, git: gitReducer(state.git, setAcceptChangesStatus(workspaceId, value)) };
  }
  const dispatch = (action: Parameters<typeof gitReducer>[1]) => {
    state = {
      ...state,
      principal: principalReducer(state.principal, action),
      workspace: workspaceReducer(state.workspace, action),
      git: gitReducer(state.git, action),
      tabState: tabStateReducer(state.tabState, action),
    };
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, acceptChangesStatusSaga);
  return { dispatch, state: () => state, task };
}

async function stop(task: Task) {
  task.cancel();
  await task.toPromise();
}

describe('acceptChangesStatusSaga', () => {
  beforeEach(() => vi.resetAllMocks());

  function makeMember(run: ReturnType<typeof harness>, role: 'member' | 'guest' = 'member') {
    const state = run.state();
    state.principal.snapshot!.capabilities.hostMembership = true;
    Object.assign(state.principal.snapshot!.principal, {
      hostRole: role,
      hostMembershipRevision: 1,
      isAdministrator: false,
    });
    Object.assign(state.workspace, {
      hasLoaded: true,
      loadedBackendId: 'local',
      loadedPrincipalContext: selectPrincipalAdmissionContext.select(state),
      workspaces: { ids: [WS_A], map: { [WS_A]: { id: WS_A, canManage: true, myRole: 'owner' } } },
    });
  }

  it('refuses status RPCs for a scoped guest owner while retaining cached read data', async () => {
    const run = harness(WS_A, { [WS_A]: status('cached') });
    makeMember(run, 'guest');
    mocks.getStatus.mockResolvedValue(status('denied-result'));
    try {
      run.dispatch(acceptChangesConsumerMounted(WS_A));
      run.dispatch(refreshAcceptChangesStatus(WS_A));
      await settle();
      expect(mocks.getStatus).not.toHaveBeenCalled();
      expect(run.state().git.byWorkspaceId[WS_A]?.acceptChangesStatus?.branch).toBe('cached');
    } finally {
      await stop(run.task);
    }
  });

  it('loads a current member workspace status', async () => {
    const run = harness();
    makeMember(run);
    mocks.getStatus.mockResolvedValue(status('member'));
    try {
      run.dispatch(acceptChangesConsumerMounted(WS_A));
      await settle();
      expect(mocks.getStatus).toHaveBeenCalledWith(WS_A);
      expect(run.state().git.byWorkspaceId[WS_A]?.acceptChangesStatus?.branch).toBe('member');
    } finally {
      await stop(run.task);
    }
  });

  it.each(['lab-off', 'admission', 'backend'] as const)(
    'drops a held status result after %s',
    async (change) => {
      const run = harness();
      makeMember(run);
      const pending = deferred<WorkspaceGitStatus>();
      mocks.getStatus.mockReturnValue(pending.promise);
      try {
        run.dispatch(acceptChangesConsumerMounted(WS_A));
        expect(mocks.getStatus).toHaveBeenCalledWith(WS_A);
        const state = run.state();
        if (change === 'lab-off') state.userPreferences.labsMultiplayerEnabled = false;
        if (change === 'admission') state.principal.invalidation += 1;
        if (change === 'backend') state.connections.windowBackendId = 'other';
        pending.resolve(status('stale'));
        await settle();
        expect(run.state().git.byWorkspaceId[WS_A]?.acceptChangesStatus).toBeNull();
      } finally {
        await stop(run.task);
      }
    },
  );

  it('loads once for the first visible consumer with the exact workspace parameter', async () => {
    mocks.getStatus.mockResolvedValue(status('feature/first'));
    const run = harness();
    run.dispatch(acceptChangesConsumerMounted(WS_A));
    await settle();

    expect(mocks.getStatus).toHaveBeenCalledTimes(1);
    expect(mocks.getStatus).toHaveBeenCalledWith(WS_A);
    expect(run.state().git.byWorkspaceId[WS_A]?.acceptChangesStatus?.branch).toBe('feature/first');
    await stop(run.task);
  });

  it('does not reload event-valid cached values across warm retained-surface switches', async () => {
    const run = harness(WS_A, { [WS_A]: status('a'), [WS_B]: status('b') });
    run.dispatch(acceptChangesConsumerMounted(WS_A));
    run.dispatch(acceptChangesConsumerMounted(WS_B));
    run.dispatch(openWorkspaceTab(WS_B));
    run.dispatch(openWorkspaceTab(WS_A));
    await settle();

    expect(mocks.getStatus).not.toHaveBeenCalled();
    await stop(run.task);
  });

  it('coalesces an invalidation burst during a read into one trailing read', async () => {
    const leading = deferred<WorkspaceGitStatus>();
    mocks.getStatus.mockReturnValueOnce(leading.promise).mockResolvedValueOnce(status('trailing'));
    const run = harness();
    run.dispatch(acceptChangesConsumerMounted(WS_A));
    await settle();
    run.dispatch(acceptChangesStatusInvalidated(WS_A));
    run.dispatch(acceptChangesStatusInvalidated(WS_A));
    run.dispatch(acceptChangesStatusInvalidated(WS_A));
    leading.resolve(status('stale-leading'));
    await settle();

    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(run.state().git.byWorkspaceId[WS_A]?.acceptChangesStatus?.branch).toBe('trailing');
    await stop(run.task);
  });

  it('does not land a late result after its consumer unmounts', async () => {
    const pending = deferred<WorkspaceGitStatus>();
    mocks.getStatus.mockReturnValue(pending.promise);
    const run = harness();
    run.dispatch(acceptChangesConsumerMounted(WS_A));
    await settle();
    run.dispatch(acceptChangesConsumerUnmounted(WS_A));
    pending.resolve(status('late'));
    await settle();

    expect(run.state().git.byWorkspaceId[WS_A]?.acceptChangesStatus).toBeNull();
    await stop(run.task);
  });

  it('cancels an unmounted workspace read and its trailing refetch before reusing the key', async () => {
    const pending = deferred<WorkspaceGitStatus>();
    mocks.getStatus.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(status('fresh'));
    const run = harness();
    run.dispatch(acceptChangesConsumerMounted(WS_A));
    await settle();
    run.dispatch(acceptChangesStatusInvalidated(WS_A));
    run.dispatch(workspaceUnmounted(WS_A));
    pending.resolve(status('cancelled'));
    await settle();

    expect(mocks.getStatus).toHaveBeenCalledTimes(1);
    expect(run.state().git.byWorkspaceId[WS_A]).toBeUndefined();

    run.dispatch(acceptChangesConsumerMounted(WS_A));
    await settle();
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(run.state().git.byWorkspaceId[WS_A]?.acceptChangesStatus?.branch).toBe('fresh');
    await stop(run.task);
  });

  it('invalidates cached status on reconnect only after fresh admission for the visible workspace', async () => {
    mocks.getStatus.mockResolvedValue(status('reconnected'));
    const run = harness(WS_A, { [WS_A]: status('a'), [WS_B]: status('b') });
    run.dispatch(acceptChangesConsumerMounted(WS_A));
    run.dispatch(acceptChangesConsumerMounted(WS_B));
    const snapshot = run.state().principal.snapshot!;
    run.dispatch(backendReconnected());
    await settle();
    expect(mocks.getStatus).not.toHaveBeenCalled();
    const principal = run.state().principal;
    run.dispatch(
      principalReceived(
        {
          context: principal.context!,
          invalidation: principal.invalidation,
          presentationVersion: principal.presentationVersion,
        },
        snapshot,
      ),
    );
    await settle();
    expect(mocks.getStatus).not.toHaveBeenCalled();
    run.dispatch(
      setWorkspaceHasLoaded(true, 'local', selectPrincipalAdmissionContext.select(run.state())),
    );
    await settle();

    expect(mocks.getStatus.mock.calls).toEqual([[WS_A]]);
    await stop(run.task);
  });

  it('preserves an explicit refresh without a visible consumer', async () => {
    mocks.getStatus.mockResolvedValue(status('explicit'));
    const run = harness();
    run.dispatch(refreshAcceptChangesStatus(WS_B));
    await settle();

    expect(mocks.getStatus.mock.calls).toEqual([[WS_B]]);
    expect(run.state().git.byWorkspaceId[WS_B]?.acceptChangesStatus).toBeNull();
    await stop(run.task);
  });
});
