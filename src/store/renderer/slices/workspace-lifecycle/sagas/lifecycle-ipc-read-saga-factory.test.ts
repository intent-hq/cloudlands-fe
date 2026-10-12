import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactStore } from '@themislib/themis/react-store';
import type { StoreMiddleware } from '@themislib/themis/types';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { WorkspaceStatus, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { GithubRepo } from '../../../../../features/github-auth/types';
import { connectionsReducer } from '../../connections/connections-slice';
import { daemonHealthReducer } from '../../daemon-health/daemon-health-slice';
import {
  externalEditorsReducer,
  fetchEditors,
  type InstalledEditor,
} from '../../external-editors/external-editors-slice';
import { githubReposReducer, loadGithubRepos } from '../../github-repos/github-repos-slice';
import { hostExecutionConnectionChanged } from '../../host-execution/host-execution-slice';
import { emptyWorkspaceState, panelLayoutReducer } from '../../panel-layout/panel-layout-slice';
import { getPrincipalConnectionContext } from '../../principal/principal-context';
import { hydrateWorkspaceSidebarUi, sidebarNavReducer } from '../../sidebar-nav/sidebar-nav-slice';
import { workspaceEventsReducer } from '../../workspace-events/workspace-events-slice';
import { setAgentsLoaded } from '../../workspace-agents/workspace-agents-slice';
import { setWorkspaceEntity, workspaceReducer } from '../../workspace/workspace-slice';
import type { LifecycleIpcReadDependencies } from '../lifecycle-ipc-read-types';
import { getWorkspaceSessionPhase } from '../workspace-lifecycle-projections';
import {
  backendReconnected,
  workspaceHydrationRequested,
  workspaceLifecycleReducer,
  workspaceMounted,
  workspaceOpenFailed,
  workspaceOpenSucceeded,
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
import { createLifecycleIpcReadSaga } from './lifecycle-ipc-read-saga-factory';

// Dispatch/owner characterization only. None of the eleven branch receivers is
// installed here. A reducer's "hydrated" phase is admission, not completed reads.
const reducers = {
  connections: connectionsReducer,
  daemonHealth: daemonHealthReducer,
  workspaceEvents: workspaceEventsReducer,
  externalEditors: externalEditorsReducer,
  githubRepos: githubReposReducer,
  panelLayout: panelLayoutReducer,
  sidebarNav: sidebarNavReducer,
  workspace: workspaceReducer,
  workspaceLifecycle: workspaceLifecycleReducer,
};
type State = { [K in keyof typeof reducers]: ReturnType<(typeof reducers)[K]> };
type Action = { type: string; payload?: unknown };
const WS = 'hydration-owner-a';
const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-12T00:00:00.000Z'));
  performance.clearMarks();
  performance.clearMeasures();
});
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
  performance.clearMarks();
  performance.clearMeasures();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function workspace(id = WS, path?: string): Workspace {
  return {
    id: WorkspaceId(id),
    title: id,
    branch: 'main',
    worktreePath: path,
    status: WorkspaceStatus.Active,
    changesets: [],
    timeline: [],
    conversationInfo: [],
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}
function fixture() {
  const actions: Action[] = [];
  let duringDispatch: ((action: Action) => void) | undefined;
  const record: StoreMiddleware = () => (next) => (action) => {
    actions.push(action as Action);
    const result = next(action);
    duringDispatch?.(action as Action);
    return result;
  };
  // The actual isolated Store owns the only saga middleware. No product Store,
  // module mocks, separate runSaga channel, or replacement branch receivers.
  const store = new ReactStore(reducers, record);
  cleanups.push(store.init());
  const githubAuthClient = {
    listRepos: vi
      .fn<LifecycleIpcReadDependencies['githubAuthClient']['listRepos']>()
      .mockRejectedValue(new Error('Unexpected GitHub read in hydration-only case')),
  };
  const externalEditorsClient = {
    detectInstalled: vi
      .fn<LifecycleIpcReadDependencies['externalEditorsClient']['detectInstalled']>()
      .mockRejectedValue(new Error('Unexpected editor read in hydration-only case')),
  };
  const invoke = vi
    .fn<(channel: string, ...args: unknown[]) => Promise<never>>()
    .mockRejectedValue(new Error('Unexpected IPC read in hydration-only case'));
  const phase = store.createSelector(getWorkspaceSessionPhase);
  // Test-owned projections read canonical reducers. They are neither source
  // selector mocks nor proposed React product bindings/readiness replacements.
  const dependencies: LifecycleIpcReadDependencies = {
    selectPrincipalConnectionContext: store.createSelector(getPrincipalConnectionContext),
    selectInstalledEditors: store.createSelector((state: State) =>
      getItems(state.externalEditors.editors),
    ),
    selectInstalledEditorsLoading: store.createSelector(
      (state: State) => state.externalEditors.loading,
    ),
    selectLastFetched: store.createSelector((state: State) => state.externalEditors.lastFetched),
    selectPanels: store.createSelector(
      (state: State, id: string) =>
        (state.panelLayout.byWorkspaceId[id] ?? emptyWorkspaceState).panels,
    ),
    selectMultiSelectSidebarSelectedTabIds: store.createSelector(
      (state: State, id: string) =>
        state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[id] ?? ['overview'],
    ),
    selectWorkspaceById: store.createSelector(
      (state: State, id: string) =>
        getItem(state.workspace.workspaces, WorkspaceId(id)) ??
        state.workspace.pendingCreations[id],
    ),
    selectIsWorkspaceHydrated: store.createSelector((state, id: string) => {
      const value = phase.select(state, id);
      return value === 'hydrated' || value === 'live';
    }),
    githubAuthClient,
    externalEditorsClient,
    invoke,
  };
  const saga = createLifecycleIpcReadSaga(dependencies);
  function start() {
    const stop = store.runSaga(saga);
    cleanups.push(stop);
    return stop;
  }
  return {
    store,
    actions,
    start,
    githubAuthClient,
    externalEditorsClient,
    invoke,
    duringDispatch(callback: (action: Action) => void) {
      duringDispatch = callback;
    },
  };
}

// Independent, stable action contracts. Values do not come from the scheduler.
const branchTypes = new Set([
  'workspaceAgents/hydrateAgentsRequested',
  'terminals/hydrateTerminalsRequested',
  'taskAgentAssociations/hydrateTaskAgentAssociationsRequested',
  'workspaceNotes/hydrationRequested',
  'workspaceEvents/loadEventsRequested',
  'scripts/refreshScripts',
  'skills/loadSkillsRequested',
  'prStatus/refreshRequested',
  'changes/loadWorkspaceDataRequested',
  'fileExplorer/hydrateFileExplorerRequested',
  'context/initContextForWorkspace',
]);
function branches(actions: Action[], id = WS) {
  return actions.filter(
    (action) =>
      branchTypes.has(action.type) && Array.isArray(action.payload) && action.payload[0] === id,
  );
}
function immediate(id = WS, generation = 1, force = false): Action[] {
  return [
    { type: 'workspaceAgents/hydrateAgentsRequested', payload: [id] },
    { type: 'terminals/hydrateTerminalsRequested', payload: [id] },
    { type: 'taskAgentAssociations/hydrateTaskAgentAssociationsRequested', payload: [id] },
    { type: 'workspaceNotes/hydrationRequested', payload: [id, generation, force] },
  ];
}
function remaining(id = WS, generation = 1, force = false): Action[] {
  return [
    { type: 'workspaceEvents/loadEventsRequested', payload: [id] },
    { type: 'scripts/refreshScripts', payload: [id] },
    { type: 'skills/loadSkillsRequested', payload: [id] },
    { type: 'prStatus/refreshRequested', payload: [id, force, false] },
    { type: 'changes/loadWorkspaceDataRequested', payload: [id] },
    { type: 'fileExplorer/hydrateFileExplorerRequested', payload: [id, force, generation] },
    { type: 'context/initContextForWorkspace', payload: [id, force, generation] },
  ];
}

describe('isolated lifecycle IPC owner dispatch contracts', () => {
  it('constructs without starting receivers and requires explicit owner startup', async () => {
    const run = fixture();
    run.store.dispatch(workspaceHydrationRequested(WS));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(branches(run.actions)).toEqual([]);
    expect(run.store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[WS]).toBeUndefined();
    run.start();
    run.store.dispatch(workspaceHydrationRequested(WS));
    expect(branches(run.actions)).toEqual(immediate());
    expect(run.githubAuthClient.listRepos).not.toHaveBeenCalled();
    expect(run.externalEditorsClient.detectInstalled).not.toHaveBeenCalled();
    expect(run.invoke).not.toHaveBeenCalled();
  });

  it('deduplicates A while scheduling B independently, then requests all eleven branches', async () => {
    const run = fixture();
    run.start();
    for (const id of [WS, 'hydration-owner-b'])
      run.store.dispatch(setWorkspaceEntity(workspace(id, '/repo')));
    run.store.dispatch(workspaceHydrationRequested(WS));
    run.store.dispatch(workspaceHydrationRequested(WS));
    run.store.dispatch(workspaceHydrationRequested('hydration-owner-b'));
    expect(branches(run.actions)).toEqual(immediate());
    expect(branches(run.actions, 'hydration-owner-b')).toEqual(immediate('hydration-owner-b', 2));
    expect(run.actions.filter((action) => action.type === workspaceMounted.type)).toHaveLength(2);
    expect(run.store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[WS]).toBe('hydrated');
    expect(run.store.state.workspaceLifecycle.loadByWorkspaceId[WS]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(branches(run.actions)).toEqual([...immediate(), ...remaining()]);
    expect(branches(run.actions, 'hydration-owner-b')).toEqual([
      ...immediate('hydration-owner-b', 2),
      ...remaining('hydration-owner-b', 2),
    ]);
  });

  it.each(['open-first', 'hydrate-first'] as const)(
    'retains source phase transitions for %s and retries open failure',
    (order) => {
      const run = fixture();
      run.start();
      const open = workspaceOpenSucceeded(WS),
        hydrate = workspaceHydrationRequested(WS);
      for (const action of order === 'open-first' ? [open, hydrate] : [hydrate, open])
        run.store.dispatch(action);
      expect(run.store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[WS]).toBe('live');
      run.store.dispatch(workspaceHydrationRequested(WS));
      expect(branches(run.actions)).toEqual(immediate());
      run.store.dispatch(workspaceOpenFailed(WS));
      run.store.dispatch(workspaceHydrationRequested(WS));
      expect(branches(run.actions)).toEqual([...immediate(), ...immediate(WS, 2)]);
    },
  );

  it('promotes real restored sidebar state once without waiting for the fallback', async () => {
    const run = fixture();
    run.start();
    run.store.dispatch(setWorkspaceEntity(workspace(WS, '/repo')));
    run.store.dispatch(workspaceHydrationRequested(WS));
    run.store.dispatch(hydrateWorkspaceSidebarUi(WS, { selectedTabIds: ['changes'] }));
    run.store.dispatch(hydrateWorkspaceSidebarUi(WS, { selectedTabIds: ['changes'] }));
    const promoted: Action[] = [
      { type: 'changes/loadWorkspaceDataRequested', payload: [WS] },
      { type: 'prStatus/refreshRequested', payload: [WS, false, false] },
    ];
    expect(branches(run.actions)).toEqual([...immediate(), ...promoted]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(branches(run.actions)).toHaveLength(11);
    for (const action of promoted)
      expect(branches(run.actions).filter((item) => item.type === action.type)).toEqual([action]);
  });

  it('cancels an unresolved path wait on close and only releases the reopened generation', async () => {
    const run = fixture();
    run.start();
    run.store.dispatch(workspaceHydrationRequested(WS));
    run.store.dispatch(hydrateWorkspaceSidebarUi(WS, { selectedTabIds: ['files'] }));
    run.store.dispatch(workspaceUnmounted(WS));
    run.store.dispatch(workspaceHydrationRequested(WS));
    run.store.dispatch(setWorkspaceEntity(workspace(WS, '/resolved')));
    await settle();
    expect(
      branches(run.actions).filter(
        (item) => item.type === 'fileExplorer/hydrateFileExplorerRequested',
      ),
    ).toEqual([{ type: 'fileExplorer/hydrateFileExplorerRequested', payload: [WS, false, 2] }]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(
      branches(run.actions).filter((item) => item.type === 'skills/loadSkillsRequested'),
    ).toHaveLength(1);
    expect(
      branches(run.actions).filter(
        (item) => item.type === 'fileExplorer/hydrateFileExplorerRequested',
      ),
    ).toHaveLength(1);
  });

  it('reconnects with a forced generation and cancels the old fallback', async () => {
    const run = fixture();
    run.start();
    run.store.dispatch(setWorkspaceEntity(workspace(WS, '/repo')));
    run.store.dispatch(workspaceHydrationRequested(WS));
    run.store.dispatch(backendReconnected());
    expect(branches(run.actions)).toEqual([...immediate(), ...immediate(WS, 2, true)]);
    // Source reconnect clears Redux phase; branch requests do not imply readiness.
    expect(run.store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[WS]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(branches(run.actions)).toEqual([
      ...immediate(),
      ...immediate(WS, 2, true),
      ...remaining(WS, 2, true),
    ]);
  });

  it('cancels attached work and characterizes restart with retained hydrated reducer state', async () => {
    const run = fixture();
    const stop = run.start();
    run.store.dispatch(setWorkspaceEntity(workspace(WS, '/repo')));
    run.store.dispatch(workspaceHydrationRequested(WS));
    stop();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(branches(run.actions)).toEqual(immediate());
    run.start();
    run.store.dispatch(workspaceHydrationRequested(WS));
    await vi.advanceTimersByTimeAsync(3_000);
    // Existing hydrated phase suppresses a request; the new run has no local
    // mounted IDs. This is a source limitation, not automatic reconstruction.
    expect(branches(run.actions)).toEqual(immediate());
    run.store.dispatch(workspaceUnmounted(WS));
    run.store.dispatch(workspaceHydrationRequested(WS));
    expect(branches(run.actions)).toEqual([...immediate(), ...immediate()]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(branches(run.actions)).toEqual([...immediate(), ...immediate(), ...remaining()]);
  });

  it('keeps bound client receivers and drops a cancelled host read before its successor settles', async () => {
    const run = fixture();
    const old = deferred<GithubRepo[]>(),
      current = deferred<GithubRepo[]>();
    run.githubAuthClient.listRepos
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    run.start();
    run.store.dispatch(loadGithubRepos());
    run.store.dispatch(loadGithubRepos());
    expect(run.githubAuthClient.listRepos.mock.calls).toEqual([[]]);
    run.store.dispatch(hostExecutionConnectionChanged('replacement'));
    run.store.dispatch(loadGithubRepos());
    old.resolve([{ owner: 'old', name: 'stale' }]);
    await settle();
    expect(getItems(run.store.state.githubRepos.repos)).toEqual([]);
    current.resolve([{ owner: 'current', name: 'kept', default_branch: 'trunk' }]);
    await settle();
    expect(getItems(run.store.state.githubRepos.repos)).toEqual([
      { id: 'current/kept', owner: 'current', name: 'kept', defaultBranch: 'trunk' },
    ]);
    expect(run.githubAuthClient.listRepos.mock.contexts).toEqual([
      run.githubAuthClient,
      run.githubAuthClient,
    ]);
  });

  it('clears actual editor loading on owner cancellation and ignores the late reply', async () => {
    const run = fixture();
    const pending = deferred<InstalledEditor[]>();
    run.externalEditorsClient.detectInstalled.mockReturnValueOnce(pending.promise);
    const stop = run.start();
    run.store.dispatch(fetchEditors(true));
    expect(run.store.state.externalEditors.loading).toBe(true);
    stop();
    expect(run.store.state.externalEditors.loading).toBe(false);
    const stateAfterCancel = run.store.state.externalEditors;
    pending.resolve([
      {
        id: 'code',
        name: 'Code',
        shortLabel: 'Code',
        appName: 'Code',
        category: 'ide',
        handlerType: 'vscode',
        installed: true,
        priority: 1,
      },
    ]);
    await settle();
    expect(run.store.state.externalEditors).toBe(stateAfterCancel);
    expect(run.externalEditorsClient.detectInstalled.mock.calls).toEqual([[true]]);
    expect(run.externalEditorsClient.detectInstalled.mock.contexts).toEqual([
      run.externalEditorsClient,
    ]);
  });

  it('characterizes the source unversioned settlement against the current generation', () => {
    vi.useRealTimers();
    performance.clearMarks();
    performance.clearMeasures();
    const run = fixture();
    run.start();
    run.store.dispatch(workspaceHydrationRequested(WS));
    run.store.dispatch(backendReconnected());
    const activeMark = `intent:workspace-hydration:${WS}:2:agents:dispatch`;
    expect(performance.getEntriesByName(activeMark)).toHaveLength(1);
    // The completion has no generation. An old receiver could send exactly this
    // action; source settles generation 2. Extraction must not claim provenance.
    run.store.dispatch(setAgentsLoaded(WS, true));
    expect(performance.getEntriesByName(activeMark)).toHaveLength(0);
    expect(run.store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[WS]).toBeUndefined();
  });

  it('characterizes reentrant close during immediate branch fan-out without strengthening source policy', async () => {
    const run = fixture();
    run.start();
    let closed = false;
    run.duringDispatch((action) => {
      if (!closed && action.type === 'workspaceAgents/hydrateAgentsRequested') {
        closed = true;
        run.store.dispatch(workspaceUnmounted(WS));
      }
    });
    run.store.dispatch(workspaceHydrationRequested(WS));
    // Already admitted non-path fan-out continues after the reentrant close.
    expect(branches(run.actions)).toEqual(immediate());
    expect(run.store.state.workspaceLifecycle.sessionPhaseByWorkspaceId[WS]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(branches(run.actions)).toEqual(immediate());
  });
});

import {
  prStatusScopedRefreshSucceeded,
  prStatusRefreshCompleted,
} from '../../pr-status/pr-status-slice';
it('settles one PR hydration branch for atomic scoped success without a second legacy completion', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  performance.clearMarks();
  performance.clearMeasures();
  const run = fixture();
  run.start();
  run.store.dispatch(setWorkspaceEntity(workspace(WS, '/repo')));
  run.store.dispatch(workspaceHydrationRequested(WS));
  await vi.advanceTimersByTimeAsync(1_500);
  const dispatchMark = `intent:workspace-hydration:${WS}:1:prStatus:dispatch`;
  expect(performance.getEntriesByName(dispatchMark)).toHaveLength(1);
  const completion = prStatusScopedRefreshSucceeded(WS, {
    principalContext: 'admitted',
    physicalOwnerId: 'attested',
  });
  run.store.dispatch(completion);
  expect(performance.getEntriesByName(dispatchMark)).toHaveLength(0);
  expect(
    performance.getEntriesByName('intent:workspace-hydration:prStatus:dispatch-to-settle'),
  ).toHaveLength(1);
  run.store.dispatch(completion);
  expect(
    performance.getEntriesByName('intent:workspace-hydration:prStatus:dispatch-to-settle'),
  ).toHaveLength(1);
  expect(run.actions.filter((action) => action.type === prStatusRefreshCompleted.type)).toEqual([]);
});

it('settles a current PR failure once without treating it as successful hydration', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  performance.clearMarks();
  performance.clearMeasures();
  const run = fixture();
  run.start();
  run.store.dispatch(setWorkspaceEntity(workspace(WS, '/repo')));
  run.store.dispatch(workspaceHydrationRequested(WS));
  await vi.advanceTimersByTimeAsync(1_500);
  const dispatchMark = `intent:workspace-hydration:${WS}:1:prStatus:dispatch`;
  expect(performance.getEntriesByName(dispatchMark)).toHaveLength(1);
  const mark = vi.spyOn(performance, 'mark');
  const failure = prStatusRefreshCompleted(WS, false, 'member required');
  run.store.dispatch(failure);
  run.store.dispatch(failure);
  expect(performance.getEntriesByName(dispatchMark)).toHaveLength(0);
  expect(
    performance.getEntriesByName('intent:workspace-hydration:prStatus:dispatch-to-settle'),
  ).toHaveLength(1);
  expect(
    mark.mock.calls.filter(
      ([name]) => name === `intent:workspace-hydration:${WS}:1:prStatus:settle`,
    ),
  ).toEqual([
    [`intent:workspace-hydration:${WS}:1:prStatus:settle`, { detail: { outcome: 'failure' } }],
  ]);
});
