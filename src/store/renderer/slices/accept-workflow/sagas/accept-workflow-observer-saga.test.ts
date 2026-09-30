import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { Workspace } from '$shared/types';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import type { CommitInfo } from '../../changes/changes-types';
import { initialState as guestState } from '../../guest-sessions/guest-sessions-slice';
import {
  fileTrackingReducer,
  setCommitsData,
  setHasLoadedInitialData,
} from '../../changes/changes-slice';
import { agentLockReducer, setAgentLockState } from '../../agent-lock/agent-lock-slice';
import {
  gitReducer,
  acceptChangesConsumerMounted,
  acceptChangesConsumerUnmounted,
  setPostMergeState,
} from '../../git/git-slice';
import { selectPostMergeState } from '../../git/git-selectors';
import { githubAuthReducer, authCompleted } from '../../github-auth/github-auth-slice';
import { workspaceReducer, setWorkspaceEntity } from '../../workspace/workspace-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { refreshPRStatusRequested } from '../../pr-status/pr-status-slice';
import { syncWorkspaceSettings } from '../../workspace-settings/workspace-settings-slice';
import { acceptWorkflowObserverSaga } from './accept-workflow-observer-saga';
import { acceptWorkflowReducer } from '../accept-workflow-slice';

const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: request }));
const tasks: Task[] = [];
const workspace = (id: string, myRole = 'owner') => ({ id, myRole, baseRef: 'main' }) as Workspace;
const commit = (hash: string, isPushed = true) => ({ hash, isPushed }) as CommitInfo;
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
function harness(authenticated = true, role = 'owner') {
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  let state = withLegacyPrincipal({
    acceptWorkflow: acceptWorkflowReducer(undefined, { type: 'init' }),
    changes: fileTrackingReducer(undefined, setHasLoadedInitialData('a', true)),
    agentLock: agentLockReducer(undefined, { type: 'init' }),
    git: gitReducer(undefined, { type: 'init' }),
    githubAuth: {
      ...githubAuthReducer(undefined, { type: 'init' }),
      isAuthenticated: authenticated,
    },
    workspace: {
      ...workspaceReducer(undefined, { type: 'init' }),
      workspaces: createCollection('id', [workspace('a', role), workspace('b')]),
    },
    connections: { activeId: LOCAL_CONNECTION_ID, windowBackendId: LOCAL_CONNECTION_ID },
    guestSessions: { ...guestState, hasReceivedList: true },
  });
  const dispatch = vi.fn((action: { type: string }) => {
    state = {
      ...state,
      acceptWorkflow: acceptWorkflowReducer(state.acceptWorkflow, action),
      changes: fileTrackingReducer(state.changes, action),
      agentLock: agentLockReducer(state.agentLock, action),
      git: gitReducer(state.git, action),
      githubAuth: githubAuthReducer(state.githubAuth, action),
      workspace: workspaceReducer(state.workspace, action),
    };
    channel.put(action);
    for (const listener of listeners) listener();
    return action;
  });
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    acceptWorkflowObserverSaga,
  );
  tasks.push(task);
  const post = (values: Partial<ReturnType<typeof selectPostMergeState.select>>) => {
    dispatch(
      setPostMergeState('a', { ...selectPostMergeState.select(state as never, 'a'), ...values }),
    );
  };
  return {
    dispatch,
    task,
    listeners,
    post,
    state: () => state,
    calls: (type: string) => dispatch.mock.calls.filter(([action]) => action.type === type),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  request.mockResolvedValue({ lockedAgentIds: ['agent-a'], lockedFilePaths: ['src/a.ts'] });
});
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
});

describe('acceptWorkflowObserverSaga', () => {
  it('hydrates the exact scoped wire snapshot once across duplicate consumers and remounts', async () => {
    const run = harness();
    run.post({ hasRemote: true });
    run.dispatch(acceptChangesConsumerMounted('a'));
    run.dispatch(acceptChangesConsumerMounted('a'));
    await settle();
    expect(request).toHaveBeenCalledExactlyOnceWith('file-tracking.getAgentLocks', {
      workspaceId: 'a',
    });
    expect(run.state().agentLock.byWorkspaceId.a).toEqual({
      lockedAgentIds: { 'agent-a': true },
      lockedFilePaths: { 'src/a.ts': true },
    });
    expect(run.calls(syncWorkspaceSettings.type)).toHaveLength(1);
    expect(run.calls(refreshPRStatusRequested.type)).toHaveLength(1);
    run.dispatch(acceptChangesConsumerUnmounted('a'));
    expect(run.listeners.size).toBe(2);
    run.dispatch(acceptChangesConsumerUnmounted('a'));
    expect(run.listeners.size).toBe(2);
    run.dispatch(acceptChangesConsumerMounted('a'));
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(run.calls(refreshPRStatusRequested.type)).toHaveLength(1);
  });

  it('keeps hydration single-flight across a remount before the transport settles', async () => {
    const pending = deferred<{ lockedAgentIds: string[]; lockedFilePaths: string[] }>();
    request.mockReturnValue(pending.promise);
    const run = harness();
    run.dispatch(acceptChangesConsumerMounted('a'));
    run.dispatch(acceptChangesConsumerUnmounted('a'));
    run.dispatch(acceptChangesConsumerMounted('a'));
    expect(request).toHaveBeenCalledTimes(1);
    pending.resolve({ lockedAgentIds: ['agent-b'], lockedFilePaths: [] });
    await settle();
    expect(run.state().agentLock.byWorkspaceId.a.lockedAgentIds).toEqual({ 'agent-b': true });
  });

  it('discovers after authentication and new pushes but not unrelated changes or hidden workspaces', async () => {
    const run = harness(false);
    run.post({ hasRemote: true });
    run.dispatch(acceptChangesConsumerMounted('a'));
    expect(run.calls(refreshPRStatusRequested.type)).toHaveLength(0);
    run.dispatch(authCompleted(null));
    await settle();
    expect(run.calls(refreshPRStatusRequested.type)).toHaveLength(1);
    run.dispatch(setCommitsData('b', [commit('b-head')], null));
    await settle();
    expect(run.calls(refreshPRStatusRequested.type)).toHaveLength(1);
    run.dispatch(setCommitsData('a', [commit('a-head')], null));
    await settle();
    expect(run.calls(refreshPRStatusRequested.type)).toHaveLength(2);
    run.dispatch(setCommitsData('a', [commit('a-head')], null));
    await settle();
    expect(run.calls(refreshPRStatusRequested.type)).toHaveLength(2);
    run.dispatch(acceptChangesConsumerUnmounted('a'));
    run.dispatch(setCommitsData('a', [commit('new'), commit('a-head')], null));
    await settle();
    expect(run.calls(refreshPRStatusRequested.type)).toHaveLength(2);
    run.dispatch(acceptChangesConsumerMounted('a'));
    await settle();
    expect(run.calls(refreshPRStatusRequested.type)).toHaveLength(3);
    expect(run.calls(refreshPRStatusRequested.type).at(-1)?.[0]).toEqual(
      refreshPRStatusRequested('a', false, false),
    );
  });

  it('does not discover GitHub PRs for collaborators', async () => {
    const run = harness(true, 'collaborator');
    run.post({ hasRemote: true });
    run.dispatch(acceptChangesConsumerMounted('a'));
    await settle();
    expect(run.calls(refreshPRStatusRequested.type)).toHaveLength(0);
    run.dispatch(setWorkspaceEntity(workspace('a')));
    await settle();
    expect(run.calls(refreshPRStatusRequested.type)).toHaveLength(1);
  });

  it('clears stale merge presentation when new commits or an open PR arrive', async () => {
    const run = harness();
    run.dispatch(setCommitsData('a', [commit('merged-head')], null));
    run.post({
      isMergedToTrunk: true,
      mergeHeadSha: 'merged-head',
      isContentMergedToTrunk: true,
      hasResetToTrunk: true,
    });
    run.dispatch(acceptChangesConsumerMounted('a'));
    await settle();
    expect(selectPostMergeState.select(run.state() as never, 'a').isMergedToTrunk).toBe(true);
    run.dispatch(setCommitsData('a', [commit('new-head')], null));
    await settle();
    expect(selectPostMergeState.select(run.state() as never, 'a')).toMatchObject({
      isMergedToTrunk: false,
      mergeHeadSha: null,
      isContentMergedToTrunk: false,
    });
    run.dispatch(
      setWorkspaceEntity({
        ...workspace('a'),
        activePullRequest: {
          number: 1,
          status: 'Open',
          title: 'PR',
          url: 'https://github.com/o/r/pull/1',
        },
      } as Workspace),
    );
    await settle();
    expect(selectPostMergeState.select(run.state() as never, 'a').hasResetToTrunk).toBe(false);
  });

  it('does not overwrite a newer lock event with an older hydration response', async () => {
    const pending = deferred<{ lockedAgentIds: string[]; lockedFilePaths: string[] }>();
    request.mockReturnValue(pending.promise);
    const run = harness();
    run.dispatch(acceptChangesConsumerMounted('a'));
    run.dispatch(setAgentLockState('a', { 'live-agent': true }, {}));
    pending.resolve({ lockedAgentIds: ['stale-agent'], lockedFilePaths: [] });
    await settle();
    expect(run.state().agentLock.byWorkspaceId.a.lockedAgentIds).toEqual({ 'live-agent': true });
  });

  it('drops late hydration after workspace closure and disposes selector subscriptions', async () => {
    const pending = deferred<{ lockedAgentIds: string[]; lockedFilePaths: string[] }>();
    request.mockReturnValue(pending.promise);
    const run = harness();
    run.dispatch(acceptChangesConsumerMounted('a'));
    run.dispatch(workspaceUnmounted('a'));
    pending.resolve({ lockedAgentIds: ['stale-agent'], lockedFilePaths: [] });
    await settle();
    expect(run.state().agentLock.byWorkspaceId.a).toBeUndefined();
    expect(run.listeners.size).toBe(1);
    run.dispatch(acceptChangesConsumerMounted('b'));
    run.task.cancel();
    await run.task.toPromise();
    expect(run.listeners.size).toBe(0);
  });

  it('settles a failed hydration to unlocked without crashing the observer', async () => {
    request.mockRejectedValue(new Error('offline'));
    const run = harness();
    run.dispatch(setAgentLockState('a', { stale: true }, {}));
    run.dispatch(acceptChangesConsumerMounted('a'));
    await settle();
    expect(run.state().agentLock.byWorkspaceId.a).toEqual({
      lockedAgentIds: {},
      lockedFilePaths: {},
    });
    expect(run.task.isRunning()).toBe(true);
  });
});
