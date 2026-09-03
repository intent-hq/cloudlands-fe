import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workspace } from '$shared/types';
import {
  closeWorkspaceTab,
  openWorkspaceTab,
  tabStateReducer,
} from '../../tab-state/tab-state-slice';
import {
  initialState as initialWorkspaceState,
  removeWorkspaceEntity,
  setWorkspaceEntity,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import {
  backendReconnected,
  initialState as initialLifecycleState,
  workspaceDeleted,
  workspaceHydrationRequested,
  workspaceLoadRequested,
  workspaceLoadSucceeded,
  workspaceLifecycleReducer,
  workspaceMounted,
  workspaceOpenFailed,
  workspaceOpenSucceeded,
} from '../workspace-lifecycle-slice';
import { workspaceLoadSaga } from './workspace-load-saga';
import {
  markWorkspaceNavigationInitialized,
  workspaceNavigationReducer,
} from '../../workspace-navigation/workspace-navigation-slice';

const mocks = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn() }));
vi.mock('../../workspace/utils/workspace.client', () => ({
  workspaceClient: { open: mocks.open },
}));
vi.mock('$lib/client', () => ({
  appClient: { workspaces: { get: mocks.get } },
}));

const settle = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

function workspace(id: string, title = id): Workspace {
  return {
    id,
    title,
    branch: 'main',
    repositoryPath: '/repo',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'Active',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  } as Workspace;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function createHarness(options: { cached?: Workspace; live?: boolean; openTab?: boolean } = {}) {
  let workspaceState = initialWorkspaceState;
  let lifecycleState = initialLifecycleState;
  let tabState = tabStateReducer(undefined, { type: '@@INIT' });
  let navigationState = workspaceNavigationReducer(undefined, { type: '@@INIT' });
  if (options.cached) {
    workspaceState = workspaceReducer(workspaceState, {
      type: 'workspace/setWorkspaceEntity',
      payload: [options.cached],
    });
    if (options.live) {
      lifecycleState = workspaceLifecycleReducer(
        lifecycleState,
        workspaceMounted(options.cached.id),
      );
      lifecycleState = workspaceLifecycleReducer(
        lifecycleState,
        workspaceOpenSucceeded(options.cached.id),
      );
    }
    if (options.openTab) tabState = tabStateReducer(tabState, openWorkspaceTab(options.cached.id));
  }
  const channel = stdChannel();
  const actions: Array<{ type: string; payload?: unknown[] }> = [];
  const getState = () => ({
    workspace: workspaceState,
    workspaceLifecycle: lifecycleState,
    tabState,
    workspaceNavigation: navigationState,
  });
  const dispatch = (action: { type: string; payload?: unknown[] }) => {
    workspaceState = workspaceReducer(workspaceState, action as never);
    lifecycleState = workspaceLifecycleReducer(lifecycleState, action as never);
    tabState = tabStateReducer(tabState, action as never);
    navigationState = workspaceNavigationReducer(navigationState, action as never);
    actions.push(action);
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState }, workspaceLoadSaga);
  return { actions, dispatch, getState, task };
}

async function stop(task: ReturnType<typeof runSaga>) {
  task.cancel();
  await task.toPromise();
}

describe('workspaceLoadSaga', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.open.mockReset();
  });

  it('admits a cold load, hydrates, opens, and publishes the protocol workspace', async () => {
    const opened = workspace('cold-space', 'Cold workspace');
    mocks.open.mockResolvedValueOnce({ ok: true, data: opened });
    const run = createHarness();

    run.dispatch(workspaceLoadRequested(opened.id));
    await settle();

    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(opened.id);
    expect(run.actions).toContainEqual(workspaceHydrationRequested(opened.id));
    expect(run.getState().workspace.workspaces.ids).toContain(opened.id);
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[opened.id]).toEqual({
      status: 'ready',
      error: null,
    });
    expect(run.actions).toContainEqual(markWorkspaceNavigationInitialized(opened.id));
    expect(run.getState().workspaceNavigation.byWorkspaceId[opened.id]).toMatchObject({
      ui: { hasInitialized: true },
      navigation: { currentIndex: 0, history: [expect.objectContaining({ id: 'spec' })] },
    });
    await stop(run.task);
  });

  it('keeps cached presentation ready while opening a cold session', async () => {
    const cached = workspace('cached-space');
    const gate = deferred<{ ok: true; data: Workspace }>();
    mocks.open.mockReturnValueOnce(gate.promise);
    const run = createHarness({ cached });

    run.dispatch(workspaceLoadRequested(cached.id));
    await settle();
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[cached.id]?.status).toBe(
      'cached-ready',
    );
    expect(mocks.open).toHaveBeenCalledOnce();

    gate.resolve({ ok: true, data: cached });
    await settle();
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[cached.id]?.status).toBe('ready');
    expect(run.actions).toContainEqual(markWorkspaceNavigationInitialized(cached.id));
    expect(run.getState().workspaceNavigation.byWorkspaceId[cached.id]).toMatchObject({
      ui: { hasInitialized: true },
      navigation: { currentIndex: 0, history: [expect.objectContaining({ id: 'spec' })] },
    });
    const initializedNavigation = run.getState().workspaceNavigation;
    run.dispatch(markWorkspaceNavigationInitialized(cached.id));
    expect(run.getState().workspaceNavigation).toBe(initializedNavigation);
    await stop(run.task);
  });

  it('publishes load success before optional path hydration settles', async () => {
    const opened = { ...workspace('path-space'), repositoryPath: undefined } as Workspace;
    const hydrated = { ...opened, repositoryPath: '/hydrated/repo' } as Workspace;
    const gate = deferred<Workspace>();
    mocks.open.mockResolvedValueOnce({ ok: true, data: opened });
    mocks.get.mockReturnValueOnce(gate.promise);
    const run = createHarness();

    run.dispatch(workspaceLoadRequested(opened.id));
    await settle();

    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(opened.id);
    expect(run.actions).toContainEqual(workspaceOpenSucceeded(opened.id));
    expect(run.actions).toContainEqual(workspaceLoadSucceeded(opened.id));
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[opened.id]?.status).toBe('ready');
    expect(selectWorkspaceById.select(run.getState() as never, opened.id)?.repositoryPath).toBe(
      undefined,
    );

    gate.resolve(hydrated);
    await settle();
    expect(selectWorkspaceById.select(run.getState() as never, opened.id)?.repositoryPath).toBe(
      '/hydrated/repo',
    );
    await stop(run.task);
  });

  it('does not overwrite a newer path mutation with stale optional detail', async () => {
    const opened = { ...workspace('stale-path'), repositoryPath: undefined } as Workspace;
    const gate = deferred<Workspace>();
    mocks.open.mockResolvedValueOnce({ ok: true, data: opened });
    mocks.get.mockReturnValueOnce(gate.promise);
    const run = createHarness();

    run.dispatch(workspaceLoadRequested(opened.id));
    await settle();
    run.dispatch(
      setWorkspaceEntity({ ...opened, title: 'Newer title', repositoryPath: '/event/repo' }),
    );
    gate.resolve({ ...opened, title: 'Stale title', repositoryPath: '/stale/repo' } as Workspace);
    await settle();

    expect(selectWorkspaceById.select(run.getState() as never, opened.id)).toMatchObject({
      title: 'Newer title',
      repositoryPath: '/event/repo',
    });
    await stop(run.task);
  });

  it('does no hydration or open work for a warm live session', async () => {
    const cached = workspace('warm-space');
    const run = createHarness({ cached, live: true });

    run.dispatch(workspaceLoadRequested(cached.id));
    await settle();

    expect(mocks.open).not.toHaveBeenCalled();
    expect(run.actions).not.toContainEqual(workspaceHydrationRequested(cached.id));
    expect(run.actions.some((action) => action.type === 'workspace/setWorkspaceEntity')).toBe(
      false,
    );
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[cached.id]?.status).toBe('ready');
    expect(run.actions).toContainEqual(markWorkspaceNavigationInitialized(cached.id));
    expect(run.getState().workspaceNavigation.byWorkspaceId[cached.id]).toMatchObject({
      ui: { hasInitialized: true },
      navigation: { currentIndex: 0, history: [expect.objectContaining({ id: 'spec' })] },
    });
    await stop(run.task);
  });

  it('takes the cold path on revisit after a backend reconnect (#3788)', async () => {
    const cached = workspace('reconnect-space');
    mocks.open.mockResolvedValueOnce({ ok: true, data: cached });
    const run = createHarness({ cached, live: true });

    run.dispatch(backendReconnected());
    run.dispatch(workspaceLoadRequested(cached.id));
    await settle();

    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(cached.id);
    expect(run.actions).toContainEqual(workspaceHydrationRequested(cached.id));
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[cached.id]?.status).toBe('ready');
    await stop(run.task);
  });

  it('single-flights duplicate route requests and cancels stale route results', async () => {
    const first = deferred<{ ok: true; data: Workspace }>();
    const second = workspace('second-space');
    mocks.open.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, data: second });
    const run = createHarness();

    run.dispatch(workspaceLoadRequested('first-space'));
    run.dispatch(workspaceLoadRequested('first-space'));
    await settle();
    expect(mocks.open).toHaveBeenCalledTimes(1);

    run.dispatch(workspaceLoadRequested(second.id));
    await settle();
    first.resolve({ ok: true, data: workspace('first-space') });
    await settle();

    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(run.getState().workspace.workspaces.ids).toEqual([second.id]);
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId['first-space']).toBeUndefined();
    await stop(run.task);
  });

  it('drops an awaited result after the workspace is deleted', async () => {
    const gate = deferred<{ ok: true; data: Workspace }>();
    mocks.open.mockReturnValueOnce(gate.promise);
    const run = createHarness();

    run.dispatch(workspaceLoadRequested('deleted-space'));
    await settle();
    run.dispatch(workspaceDeleted('deleted-space', []));
    gate.resolve({ ok: true, data: workspace('deleted-space') });
    await settle();

    expect(run.getState().workspace.workspaces.ids).not.toContain('deleted-space');
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId['deleted-space']).toBeUndefined();
    expect(run.actions).not.toContainEqual(markWorkspaceNavigationInitialized('deleted-space'));
    await stop(run.task);
  });

  it('drops a successful open result after explicit entity eviction', async () => {
    const cached = workspace('evicted-space');
    const gate = deferred<{ ok: true; data: Workspace }>();
    mocks.open.mockReturnValueOnce(gate.promise);
    const run = createHarness({ cached });

    run.dispatch(workspaceLoadRequested(cached.id));
    await settle();
    run.dispatch(removeWorkspaceEntity(cached.id));
    gate.resolve({ ok: true, data: cached });
    await settle();

    expect(selectWorkspaceById.select(run.getState() as never, cached.id)).toBeUndefined();
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[cached.id]).toBeUndefined();
    expect(run.actions).not.toContainEqual({
      type: 'workspace-lifecycle/workspaceOpenSucceeded',
      payload: [cached.id],
    });
    expect(run.actions).not.toContainEqual(markWorkspaceNavigationInitialized(cached.id));
    await stop(run.task);
  });

  it('drops a rejected open result after explicit entity eviction', async () => {
    const gate = deferred<{ ok: true; data: Workspace }>();
    mocks.open.mockReturnValueOnce(gate.promise);
    const run = createHarness();

    run.dispatch(workspaceLoadRequested('evicted-open'));
    await settle();
    run.dispatch(removeWorkspaceEntity('evicted-open'));
    gate.reject(new Error('Backend unavailable'));
    await settle();

    expect(run.getState().workspaceLifecycle.loadByWorkspaceId['evicted-open']).toBeUndefined();
    expect(run.actions).not.toContainEqual({
      type: 'workspace-lifecycle/workspaceLoadFailed',
      payload: ['evicted-open', { kind: 'error', message: 'Backend unavailable' }],
    });
    expect(run.actions).not.toContainEqual(markWorkspaceNavigationInitialized('evicted-open'));
    await stop(run.task);
  });

  it('cancels optional path hydration after explicit entity eviction', async () => {
    const opened = { ...workspace('evicted-path'), repositoryPath: undefined } as Workspace;
    const gate = deferred<Workspace>();
    mocks.open.mockResolvedValueOnce({ ok: true, data: opened });
    mocks.get.mockReturnValueOnce(gate.promise);
    const run = createHarness();

    run.dispatch(workspaceLoadRequested(opened.id));
    await settle();
    expect(run.actions).toContainEqual(workspaceOpenSucceeded(opened.id));
    expect(run.actions).toContainEqual(workspaceLoadSucceeded(opened.id));
    run.dispatch(removeWorkspaceEntity(opened.id));
    gate.resolve({ ...opened, repositoryPath: '/late/repo' } as Workspace);
    await settle();

    expect(selectWorkspaceById.select(run.getState() as never, opened.id)).toBeUndefined();
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[opened.id]).toBeUndefined();
    expect(run.actions.filter((action) => action.type === 'workspace/setWorkspaceEntity')).toEqual([
      setWorkspaceEntity(opened),
    ]);
    await stop(run.task);
  });

  it('retries not-found once, evicts the entity, and closes its tab', async () => {
    const cached = workspace('missing-space');
    mocks.open.mockResolvedValue({ ok: false, error: 'Workspace not found' });
    const run = createHarness({ cached, openTab: true });

    vi.useFakeTimers();
    try {
      run.dispatch(workspaceLoadRequested(cached.id));
      await settle();

      expect(mocks.open).toHaveBeenCalledTimes(1);
      expect(run.actions).toContainEqual({
        type: 'workspace/loadWorkspacesRequested',
        payload: [],
      });

      await vi.advanceTimersByTimeAsync(499);
      await settle();
      expect(mocks.open).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(mocks.open).toHaveBeenCalledTimes(2);
      expect(run.getState().workspace.workspaces.ids).not.toContain(cached.id);
      expect(run.getState().tabState.openTabs[cached.id]).toBeFalsy();
      expect(run.getState().workspaceLifecycle.loadByWorkspaceId[cached.id]).toEqual({
        status: 'not-found',
        error: { kind: 'not_found', message: 'Workspace not found' },
      });
    } finally {
      await stop(run.task);
      vi.useRealTimers();
    }
  });

  it('does not treat a generic error containing "not found" as workspace-not-found (#3787)', async () => {
    const cached = workspace('git-error-space');
    mocks.open.mockResolvedValue({ ok: false, error: 'git binary not found' });
    const run = createHarness({ cached, openTab: true });

    run.dispatch(workspaceLoadRequested(cached.id));
    await settle();

    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(cached.id);
    expect(run.actions).not.toContainEqual({
      type: 'workspace/loadWorkspacesRequested',
      payload: [],
    });
    expect(run.actions).not.toContainEqual(closeWorkspaceTab(cached.id));
    expect(run.actions).not.toContainEqual(removeWorkspaceEntity(cached.id));
    expect(selectWorkspaceById.select(run.getState() as never, cached.id)).toMatchObject(cached);
    expect(run.getState().tabState.openTabs[cached.id]).toBeTruthy();
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[cached.id]).toEqual({
      status: 'cached-ready',
      error: null,
    });
    await stop(run.task);
  });

  it.each([
    // Daemon workspace.* not-found mapping and the FE IPC fold (PROTOCOL §5.1).
    'Workspace not found',
    // Adapter/agent phrasing carrying the workspace id.
    'Workspace not found: missing-space',
    // Daemon generic Error::NotFound display ("not found: {subject}").
    'not found: workspace missing-space',
    'workspace missing-space does not exist',
  ])('classifies %j as workspace-not-found and evicts after the retry', async (message) => {
    const cached = workspace('missing-space');
    mocks.open.mockResolvedValue({ ok: false, error: message });
    const run = createHarness({ cached, openTab: true });

    vi.useFakeTimers();
    try {
      run.dispatch(workspaceLoadRequested(cached.id));
      await settle();
      await vi.advanceTimersByTimeAsync(500);
      await settle();

      expect(mocks.open).toHaveBeenCalledTimes(2);
      expect(run.getState().workspace.workspaces.ids).not.toContain(cached.id);
      expect(run.getState().tabState.openTabs[cached.id]).toBeFalsy();
      expect(run.getState().workspaceLifecycle.loadByWorkspaceId[cached.id]).toEqual({
        status: 'not-found',
        error: { kind: 'not_found', message },
      });
    } finally {
      await stop(run.task);
      vi.useRealTimers();
    }
  });

  it('retains cached-ready presentation when a generic open failure is returned', async () => {
    const cached = workspace('cached-flaky-space');
    mocks.open.mockResolvedValueOnce({ ok: false, error: 'Backend unavailable' });
    const run = createHarness({ cached });

    run.dispatch(workspaceLoadRequested(cached.id));
    await settle();

    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(cached.id);
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[cached.id]).toEqual({
      status: 'cached-ready',
      error: null,
    });
    expect(selectWorkspaceById.select(run.getState() as never, cached.id)).toMatchObject(cached);
    expect(run.actions).toContainEqual(workspaceOpenFailed(cached.id));
    expect(run.actions).not.toContainEqual({
      type: 'workspace-lifecycle/workspaceLoadFailed',
      payload: [cached.id, { kind: 'error', message: 'Backend unavailable' }],
    });
    await stop(run.task);
  });

  it('allows a refreshed workspace to recover from a transient not-found after the delay', async () => {
    const recovered = workspace('transient-space');
    mocks.open
      .mockResolvedValueOnce({ ok: false, error: 'Workspace not found' })
      .mockResolvedValueOnce({ ok: true, data: recovered });
    const run = createHarness({ cached: recovered });

    vi.useFakeTimers();
    try {
      run.dispatch(workspaceLoadRequested(recovered.id));
      await settle();

      expect(mocks.open).toHaveBeenCalledTimes(1);
      expect(run.getState().workspace.workspaces.ids).toContain(recovered.id);

      await vi.advanceTimersByTimeAsync(500);
      await settle();

      expect(mocks.open).toHaveBeenCalledTimes(2);
      expect(mocks.open.mock.calls).toEqual([[recovered.id], [recovered.id]]);
      expect(run.getState().workspaceLifecycle.loadByWorkspaceId[recovered.id]).toEqual({
        status: 'ready',
        error: null,
      });
      expect(selectWorkspaceById.select(run.getState() as never, recovered.id)).toMatchObject(
        recovered,
      );
    } finally {
      await stop(run.task);
      vi.useRealTimers();
    }
  });

  it('recovers from failure and reloads a deleted then recreated workspace', async () => {
    const recreated = workspace('recreated-space');
    mocks.open
      .mockResolvedValueOnce({ ok: false, error: 'Backend unavailable' })
      .mockResolvedValueOnce({ ok: true, data: recreated });
    const run = createHarness();

    run.dispatch(workspaceLoadRequested(recreated.id));
    await settle();
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[recreated.id]?.status).toBe('error');

    run.dispatch(workspaceDeleted(recreated.id, []));
    run.dispatch(workspaceLoadRequested(recreated.id));
    await settle();
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[recreated.id]?.status).toBe('ready');
    expect(run.getState().workspace.workspaces.ids).toContain(recreated.id);
    await stop(run.task);
  });

  it('recovers from a failed open on a subsequent request without eviction', async () => {
    const recovered = workspace('retry-space');
    mocks.open
      .mockResolvedValueOnce({ ok: false, error: 'Backend unavailable' })
      .mockResolvedValueOnce({ ok: true, data: recovered });
    const run = createHarness();

    run.dispatch(workspaceLoadRequested(recovered.id));
    await settle();
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[recovered.id]?.status).toBe('error');

    run.dispatch(workspaceLoadRequested(recovered.id));
    await settle();

    expect(run.getState().workspaceLifecycle.loadByWorkspaceId[recovered.id]?.status).toBe('ready');
    expect(selectWorkspaceById.select(run.getState() as never, recovered.id)).toMatchObject(
      recovered,
    );
    await stop(run.task);
  });

  it('marks optimistic routes ready without hydration or open', async () => {
    const run = createHarness();
    run.dispatch(workspaceLoadRequested('optimistic-1'));
    await settle();

    expect(mocks.open).not.toHaveBeenCalled();
    expect(run.getState().workspaceLifecycle.loadByWorkspaceId['optimistic-1']?.status).toBe(
      'optimistic',
    );
    expect(run.actions).not.toContainEqual(markWorkspaceNavigationInitialized('optimistic-1'));
    await stop(run.task);
  });
});
