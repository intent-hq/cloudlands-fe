import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';

const mocks = vi.hoisted(() => ({
  listRepos: vi.fn(),
  detectInstalled: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('$features/github-auth/renderer/github-auth.client', () => ({
  githubAuthClient: { listRepos: mocks.listRepos },
}));
vi.mock('$features/external-editors/external-editors.client', () => ({
  externalEditorsClient: { detectInstalled: mocks.detectInstalled },
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import { CACHE_TTL_MS, fetchEditors } from '../../external-editors/external-editors-slice';
import { loadGithubRepos } from '../../github-repos/github-repos-slice';
import { loadKnownRepos } from '../../known-repos/known-repos-slice';
import { initialState as initialConnectionsState } from '../../connections/connections-slice';
import { initialState as initialPanelLayoutState } from '../../panel-layout/panel-layout-slice';
import { initialState as initialSidebarNavState } from '../../sidebar-nav/sidebar-nav-slice';
import {
  initialState as initialWorkspaceState,
  setWorkspaceEntity,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import {
  initialState as initialWorkspaceLifecycleState,
  backendReconnected,
  workspaceHydrationBranchRequested,
  workspaceHydrationRequested,
  workspaceLifecycleReducer,
  workspaceMounted,
  workspaceOpenFailed,
  workspaceOpenSucceeded,
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
import { lifecycleIpcReadSaga } from './lifecycle-ipc-read-saga';
import { WORKSPACE_HYDRATION_IDLE_FALLBACK_MS } from './workspace-read-scheduler';

const WS = 'ws-ipc-lifecycle';
const NOW = new Date('2026-07-31T00:00:00.000Z');
type ObservedAction = { type: string; payload?: unknown[] };

function workspace(id: string, worktreePath?: string): Workspace {
  return {
    id,
    title: id,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'Active',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    worktreePath,
  } as Workspace;
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function state(workspaces: Workspace[] = [workspace(WS, '/repo/worktrees/ws-ipc-lifecycle')]) {
  return {
    externalEditors: {
      loading: false,
      editors: createCollection('id', []),
      lastFetched: 0,
    },
    git: { byWorkspaceId: {} },
    connections: initialConnectionsState,
    panelLayout: initialPanelLayoutState,
    sidebarNav: initialSidebarNavState,
    workspace: {
      ...initialWorkspaceState,
      workspaces: createCollection('id', workspaces),
    },
    workspaceLifecycle: initialWorkspaceLifecycleState,
  };
}

function workspaceMountFanOut(
  workspaceId: string,
  generation = 1,
  force = false,
): ObservedAction[] {
  return [
    {
      type: force
        ? 'workspaceTasks/loadWorkspaceTasksRequested'
        : 'workspaceTasks/ensureWorkspaceTasksLoaded',
      payload: [workspaceId],
    },
    { type: 'workspaceAgents/hydrateAgentsRequested', payload: [workspaceId] },
    { type: 'terminals/hydrateTerminalsRequested', payload: [workspaceId] },
    {
      type: 'taskAgentAssociations/hydrateTaskAgentAssociationsRequested',
      payload: [workspaceId],
    },
    { type: 'workspaceNotes/hydrationRequested', payload: [workspaceId, generation, force] },
  ];
}

function workspaceDeferredFanOut(workspaceId: string): ObservedAction[] {
  return [
    { type: 'workspaceEvents/loadEventsRequested', payload: [workspaceId] },
    { type: 'scripts/refreshScripts', payload: [workspaceId] },
    { type: 'skills/loadSkillsRequested', payload: [workspaceId] },
    { type: 'prStatus/refreshRequested', payload: [workspaceId, false, false] },
    { type: 'changes/loadWorkspaceDataRequested', payload: [workspaceId] },
    { type: 'fileExplorer/hydrateFileExplorerRequested', payload: [workspaceId] },
    { type: 'context/initContextForWorkspace', payload: [workspaceId] },
  ];
}

function start(
  current = state(),
  onDispatch?: (action: ObservedAction, channel: ReturnType<typeof stdChannel>) => void,
) {
  const channel = stdChannel();
  const actions: ObservedAction[] = [];
  const reduceState = (action: ObservedAction) => {
    current.workspaceLifecycle = workspaceLifecycleReducer(
      current.workspaceLifecycle,
      action as never,
    );
    current.workspace = workspaceReducer(current.workspace, action as never);
  };
  const task = runSaga(
    {
      channel,
      dispatch: (action: ObservedAction) => {
        reduceState(action);
        if (action.type !== workspaceHydrationBranchRequested.type) actions.push(action);
        channel.put(action);
        onDispatch?.(action, channel);
      },
      getState: () => current,
    },
    lifecycleIpcReadSaga,
  );
  return {
    channel,
    actions,
    task,
    send(action: ObservedAction) {
      reduceState(action);
      channel.put(action);
    },
  };
}

function startHydrationHarness() {
  return start();
}

async function stop(task: ReturnType<typeof runSaga>) {
  task.cancel();
  await task.toPromise();
}

describe('lifecycleIpcReadSaga', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.listRepos.mockResolvedValue([]);
    mocks.detectInstalled.mockResolvedValue([]);
    mocks.invoke.mockResolvedValue({ success: true, data: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('maps GitHub wire repos exactly and drops snake_case and wire-only fields', async () => {
    mocks.listRepos.mockResolvedValue([
      {
        owner: 'acme',
        name: 'web',
        default_branch: 'main',
        wire_only: 'drop',
      },
    ]);
    const run = start();
    run.channel.put(loadGithubRepos());
    await settle();

    expect(mocks.listRepos.mock.calls).toEqual([[]]);
    expect(run.actions).toEqual([
      { type: 'githubRepos/setLoading', payload: [] },
      {
        type: 'githubRepos/setRepos',
        payload: [[{ id: 'acme/web', owner: 'acme', name: 'web', defaultBranch: 'main' }]],
      },
    ]);
    await stop(run.task);
  });

  it('surfaces GitHub failure, coalesces duplicates, and cancels a pending read', async () => {
    let resolve!: (value: unknown[]) => void;
    mocks.listRepos.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = start();
    run.channel.put(loadGithubRepos());
    run.channel.put(loadGithubRepos());
    await settle();
    expect(mocks.listRepos.mock.calls).toEqual([[]]);
    await stop(run.task);
    resolve([{ owner: 'late', name: 'late', default_branch: 'main' }]);
    await settle();
    expect(run.actions).toEqual([{ type: 'githubRepos/setLoading', payload: [] }]);

    mocks.listRepos.mockRejectedValueOnce(new Error('github failed'));
    const failed = start();
    failed.channel.put(loadGithubRepos());
    await settle();
    expect(failed.actions).toEqual([
      { type: 'githubRepos/setLoading', payload: [] },
      { type: 'githubRepos/setError', payload: ['github failed'] },
    ]);
    await stop(failed.task);
  });

  it('detects editors, preserves the protocol payload, and clears loading', async () => {
    const editor = {
      id: 'vscode',
      name: 'Visual Studio Code',
      installed: true,
      path: '/Applications/Code.app',
      wire_only: 'preserved',
    };
    mocks.detectInstalled.mockResolvedValue([editor]);
    const run = start();
    run.channel.put(fetchEditors());
    await settle();

    expect(mocks.detectInstalled.mock.calls).toEqual([[false]]);
    expect(run.actions).toEqual([
      { type: 'externalEditors/clearError', payload: [] },
      { type: 'externalEditors/setLoading', payload: [true] },
      { type: 'externalEditors/fetchEditorsSuccess', payload: [[editor], NOW.getTime()] },
      { type: 'externalEditors/setLoading', payload: [false] },
    ]);
    await stop(run.task);
  });

  it('honors editor loading/cache no-ops and lets force refresh bypass a fresh cache', async () => {
    const current = state();
    current.externalEditors.loading = true;
    const loading = start(current);
    loading.channel.put(fetchEditors());
    await settle();
    expect(mocks.detectInstalled.mock.calls).toEqual([]);
    expect(loading.actions).toEqual([]);
    await stop(loading.task);

    current.externalEditors.loading = false;
    current.externalEditors.editors = createCollection('id', [
      { id: 'vscode', name: 'Code', installed: true },
    ]);
    current.externalEditors.lastFetched = NOW.getTime() - CACHE_TTL_MS + 1;
    const cached = start(current);
    cached.channel.put(fetchEditors());
    await settle();
    cached.channel.put(fetchEditors(true));
    await settle();
    expect(mocks.detectInstalled.mock.calls).toEqual([[true]]);
    expect(cached.actions).toEqual([
      { type: 'externalEditors/clearError', payload: [] },
      { type: 'externalEditors/setLoading', payload: [true] },
      { type: 'externalEditors/fetchEditorsSuccess', payload: [[], NOW.getTime()] },
      { type: 'externalEditors/setLoading', payload: [false] },
    ]);
    await stop(cached.task);
  });

  it('reports editor failure and clears loading during root cancellation', async () => {
    mocks.detectInstalled.mockRejectedValueOnce(new Error('detect failed'));
    const failed = start();
    failed.channel.put(fetchEditors(true));
    await settle();
    expect(failed.actions).toEqual([
      { type: 'externalEditors/clearError', payload: [] },
      { type: 'externalEditors/setLoading', payload: [true] },
      { type: 'externalEditors/fetchEditorsFailure', payload: ['detect failed'] },
      { type: 'externalEditors/setLoading', payload: [false] },
    ]);
    await stop(failed.task);

    mocks.detectInstalled.mockReturnValueOnce(new Promise(() => {}));
    const cancelled = start();
    cancelled.channel.put(fetchEditors(true));
    await settle();
    await stop(cancelled.task);
    expect(cancelled.actions).toEqual([
      { type: 'externalEditors/clearError', payload: [] },
      { type: 'externalEditors/setLoading', payload: [true] },
      { type: 'externalEditors/setLoading', payload: [false] },
    ]);
  });

  it('invokes the exact known-repos channel and keeps prior state on unusable responses', async () => {
    const repo = {
      path: '/repos/acme',
      name: 'acme',
      addedAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-01-02T00:00:00.000Z',
      wire_only: 'preserved',
    };
    mocks.invoke.mockResolvedValueOnce({ success: true, data: [repo] });
    const run = start();
    run.channel.put(loadKnownRepos());
    await settle();
    mocks.invoke.mockResolvedValueOnce({ success: false, data: [repo] });
    run.channel.put(loadKnownRepos());
    await settle();
    mocks.invoke.mockRejectedValueOnce(new Error('ipc failed'));
    run.channel.put(loadKnownRepos());
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([
      ['workspace:get-recent-repositories', {}],
      ['workspace:get-recent-repositories', {}],
      ['workspace:get-recent-repositories', {}],
    ]);
    expect(run.actions).toEqual([{ type: 'knownRepos/setRepos', payload: [[repo]] }]);
    await stop(run.task);
  });

  it('fans out workspace mount in the authoritative order and ignores malformed payloads', async () => {
    const run = start();
    run.channel.put(workspaceMounted(WS));
    await settle();
    run.channel.put({ type: workspaceMounted.type, payload: [] });
    await settle();

    expect(run.actions).toEqual(workspaceMountFanOut(WS));
    await stop(run.task);
  });

  it('flushes worktree-dependent deferred reads for a real workspace with a resolved path', async () => {
    const run = start();
    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(run.actions).toEqual(workspaceMountFanOut(WS));
    run.actions.length = 0;
    await vi.advanceTimersByTimeAsync(WORKSPACE_HYDRATION_IDLE_FALLBACK_MS - 1);
    expect(run.actions).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(run.actions).toEqual(workspaceDeferredFanOut(WS));
    await stop(run.task);
  });

  it('skips worktree-dependent hydration for a synthetic pathless workspace', async () => {
    const pathlessWorkspace = workspace('__chief__');
    const run = start(state([pathlessWorkspace]));
    run.channel.put(workspaceMounted(pathlessWorkspace.id));
    await settle();
    run.actions.length = 0;

    await vi.advanceTimersByTimeAsync(WORKSPACE_HYDRATION_IDLE_FALLBACK_MS);
    await settle();

    expect(run.actions).toEqual(
      workspaceDeferredFanOut(pathlessWorkspace.id).filter(
        (action) =>
          action.type !== 'skills/loadSkillsRequested' &&
          action.type !== 'fileExplorer/hydrateFileExplorerRequested',
      ),
    );
    await stop(run.task);
  });

  it.each(['before', 'after'] as const)(
    'dispatches worktree-dependent hydration exactly once when a real path resolves %s fallback',
    async (timing) => {
      const run = start(state([]));
      run.channel.put(workspaceMounted(WS));
      await settle();
      run.actions.length = 0;

      if (timing === 'before') {
        run.send(setWorkspaceEntity(workspace(WS, '/repo/worktrees/late')));
      }
      await vi.advanceTimersByTimeAsync(WORKSPACE_HYDRATION_IDLE_FALLBACK_MS);
      await settle();
      if (timing === 'after') {
        expect(
          run.actions.filter((action) => action.type === 'skills/loadSkillsRequested'),
        ).toHaveLength(0);
        expect(
          run.actions.filter(
            (action) => action.type === 'fileExplorer/hydrateFileExplorerRequested',
          ),
        ).toHaveLength(0);
        run.send(setWorkspaceEntity(workspace(WS, '/repo/worktrees/late')));
        await settle();
      }

      expect(
        run.actions.filter((action) => action.type === 'skills/loadSkillsRequested'),
      ).toHaveLength(1);
      expect(
        run.actions.filter((action) => action.type === 'fileExplorer/hydrateFileExplorerRequested'),
      ).toHaveLength(1);
      await stop(run.task);
    },
  );

  it('promotes a deferred read when its restored active panel becomes visible', async () => {
    const current = state();
    const run = start(current);
    run.channel.put(workspaceMounted(WS));
    await settle();
    run.actions.length = 0;
    current.panelLayout = {
      ...initialPanelLayoutState,
      byWorkspaceId: {
        [WS]: {
          panels: {
            panel: {
              activeTabId: 'activity',
              tabs: [{ id: 'activity', type: 'activity', title: 'Activity', closable: true }],
            },
          },
        },
      },
    } as never;

    run.channel.put({ type: 'panelLayout/openTab', payload: { wsId: WS } } as never);
    await settle();

    expect(run.actions).toEqual([{ type: 'workspaceEvents/loadEventsRequested', payload: [WS] }]);
    await stop(run.task);
  });

  it('cancels the deferred fallback timer on unmount', async () => {
    const run = start();
    run.channel.put(workspaceMounted(WS));
    await settle();
    run.actions.length = 0;
    expect(vi.getTimerCount()).toBe(1);

    run.send(workspaceUnmounted(WS));
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(WORKSPACE_HYDRATION_IDLE_FALLBACK_MS);
    await settle();

    expect(run.actions).toEqual([]);
    await stop(run.task);
  });

  it('starts a forced fresh generation after reconnect', async () => {
    const run = start();
    run.channel.put(workspaceMounted(WS));
    await settle();
    run.actions.length = 0;
    expect(vi.getTimerCount()).toBe(1);

    run.send(backendReconnected());
    await settle();

    expect(run.actions).toEqual(workspaceMountFanOut(WS, 2, true));
    expect(vi.getTimerCount()).toBe(1);
    await stop(run.task);
  });

  it('hydrates the first workspace visit and coalesces a revisit in the same session', async () => {
    const run = startHydrationHarness();
    run.send(workspaceHydrationRequested(WS));
    await settle();
    run.send(workspaceHydrationRequested(WS));
    await settle();

    expect(run.actions).toEqual([workspaceMounted(WS), ...workspaceMountFanOut(WS)]);
    await stop(run.task);
  });

  it('permits fresh hydration after the workspace session is closed and reopened', async () => {
    const run = startHydrationHarness();
    run.send(workspaceHydrationRequested(WS));
    await settle();
    run.send(workspaceUnmounted(WS));
    await settle();
    run.send(workspaceHydrationRequested(WS));
    await settle();

    expect(run.actions).toEqual([
      workspaceMounted(WS),
      ...workspaceMountFanOut(WS),
      workspaceMounted(WS),
      ...workspaceMountFanOut(WS, 2),
    ]);
    await stop(run.task);
  });

  it('coalesces rapid repeated hydration triggers per workspace', async () => {
    const secondWorkspaceId = 'ws-ipc-lifecycle-rapid-second';
    const run = startHydrationHarness();
    run.send(workspaceHydrationRequested(WS));
    run.send(workspaceHydrationRequested(WS));
    run.send(workspaceHydrationRequested(secondWorkspaceId));
    run.send(workspaceHydrationRequested(WS));
    await settle();

    expect(run.actions.filter((action) => action.type === workspaceMounted.type)).toEqual([
      workspaceMounted(WS),
      workspaceMounted(secondWorkspaceId),
    ]);
    expect(run.actions.filter((action) => action.payload?.[0] === WS)).toEqual([
      workspaceMounted(WS),
      ...workspaceMountFanOut(WS),
    ]);
    expect(run.actions.filter((action) => action.payload?.[0] === secondWorkspaceId)).toEqual([
      workspaceMounted(secondWorkspaceId),
      ...workspaceMountFanOut(secondWorkspaceId, 2),
    ]);
    await stop(run.task);
  });

  it('suppresses hydration for an authoritative live session', async () => {
    const run = startHydrationHarness();
    run.send(workspaceHydrationRequested(WS));
    await settle();
    run.send(workspaceOpenSucceeded(WS));
    run.actions.length = 0;

    run.send(workspaceHydrationRequested(WS));
    await settle();

    expect(run.actions).toEqual([]);
    await stop(run.task);
  });

  it('rehydrates after a live session is invalidated by open failure', async () => {
    const run = startHydrationHarness();
    run.send(workspaceHydrationRequested(WS));
    await settle();
    run.send(workspaceOpenSucceeded(WS));
    run.send(workspaceOpenFailed(WS));
    run.actions.length = 0;

    run.send(workspaceHydrationRequested(WS));
    await settle();

    expect(run.actions).toEqual([workspaceMounted(WS), ...workspaceMountFanOut(WS, 2)]);
    await stop(run.task);
  });

  it('fans out every workspace ID when another mount arrives during an active fan-out', async () => {
    const secondWorkspaceId = 'ws-ipc-lifecycle-second';
    let injectedSecondMount = false;
    const run = start(state(), (action, channel) => {
      if (
        !injectedSecondMount &&
        action.type === 'workspaceTasks/ensureWorkspaceTasksLoaded' &&
        action.payload?.[0] === WS
      ) {
        injectedSecondMount = true;
        channel.put(workspaceMounted(secondWorkspaceId));
      }
    });

    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(run.actions.filter((action) => action.payload?.[0] === WS)).toEqual(
      workspaceMountFanOut(WS),
    );
    expect(run.actions.filter((action) => action.payload?.[0] === secondWorkspaceId)).toEqual(
      workspaceMountFanOut(secondWorkspaceId, 2),
    );
    await stop(run.task);
  });
});
