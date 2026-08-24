import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Workspace } from '$shared/types';
import { closeWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { emptyWorkspaceAgentState } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  removeWorkspaceEntity,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import TestUseWorkspaceLoader from './TestUseWorkspaceLoader.test.svelte';

const { dispatchMock, openMock, selectWorkspaceByIdMock, storeStateRef } = vi.hoisted(() => {
  const dispatchMock = vi.fn();
  const openMock = vi.fn();
  const selectWorkspaceByIdMock = vi.fn();
  const storeStateRef = { current: {} as Record<string, unknown> };

  return {
    dispatchMock,
    openMock,
    selectWorkspaceByIdMock,
    storeStateRef,
  };
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: {
    select: (_state: unknown, workspaceId: string) => selectWorkspaceByIdMock(workspaceId),
  },
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { open: openMock },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => storeStateRef.current,
    dispatch: dispatchMock,
  });
});

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    id: overrides.id as Workspace['id'],
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'active' as Workspace['status'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createWorkspaceState() {
  return {
    isOptimistic: false,
    transition: null,
    updateState: vi.fn(),
    markInitialized: vi.fn(),
  } as any;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('useWorkspaceLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeStateRef.current = {
      workspaceAgents: {
        byWorkspaceId: {},
      },
    };
    selectWorkspaceByIdMock.mockReturnValue(null);
  });

  it('hydrates Redux from cached workspace data before open completes', async () => {
    const cachedWorkspace = makeWorkspace({ id: 'loader-cache-1', title: 'Cached Workspace' });
    selectWorkspaceByIdMock.mockReturnValue(cachedWorkspace);
    const open = createDeferred<{ ok: true; data: Workspace }>();
    openMock.mockReturnValue(open.promise);

    render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: cachedWorkspace.id,
        workspaceState: createWorkspaceState(),
        state: null,
        previousWorkspaceId: null,
      },
    });

    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));

    expect(dispatchMock.mock.calls.map(([action]) => action)).toEqual([
      setWorkspaceEntity(cachedWorkspace),
    ]);

    open.resolve({ ok: true, data: cachedWorkspace });
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(2));

    expect(openMock.mock.calls).toEqual([[cachedWorkspace.id]]);
    expect(dispatchMock.mock.calls.map(([action]) => action)).toEqual([
      setWorkspaceEntity(cachedWorkspace),
      setWorkspaceEntity(cachedWorkspace),
    ]);
  });

  it('opens every A → B → A route visit without owning workspace lifecycle', async () => {
    const workspaceA = makeWorkspace({ id: 'loader-revisit-a', title: 'Workspace A' });
    const workspaceB = makeWorkspace({ id: 'loader-revisit-b', title: 'Workspace B' });
    selectWorkspaceByIdMock.mockImplementation((id: string) =>
      id === workspaceA.id ? workspaceA : workspaceB,
    );
    openMock.mockImplementation(async (id: string) => ({
      ok: true,
      data: id === workspaceA.id ? workspaceA : workspaceB,
    }));

    const view = render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: workspaceA.id,
        workspaceState: createWorkspaceState(),
        previousWorkspaceId: null,
      },
    });
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));

    await view.rerender({
      workspaceId: workspaceB.id,
      workspaceState: createWorkspaceState(),
      previousWorkspaceId: workspaceA.id,
    });
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(2));

    await view.rerender({
      workspaceId: workspaceA.id,
      workspaceState: createWorkspaceState(),
      previousWorkspaceId: workspaceB.id,
    });
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(3));

    expect(openMock.mock.calls).toEqual([[workspaceA.id], [workspaceB.id], [workspaceA.id]]);
    expect(
      dispatchMock.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type.startsWith('workspace-lifecycle/')),
    ).toEqual([]);
  });

  it('refreshes Redux with the opened workspace entity after open resolves', async () => {
    const cachedWorkspace = makeWorkspace({ id: 'loader-cache-2', title: 'Cached Workspace' });
    const openedWorkspace = makeWorkspace({
      id: 'loader-cache-2',
      title: 'Opened Workspace',
      worktreePath: '/tmp/loader-cache-2',
    });

    selectWorkspaceByIdMock.mockReturnValue(cachedWorkspace);
    openMock.mockResolvedValue({ ok: true, data: openedWorkspace });

    render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: openedWorkspace.id,
        workspaceState: createWorkspaceState(),
        state: null,
        previousWorkspaceId: null,
      },
    });

    await waitFor(() =>
      expect(dispatchMock).toHaveBeenCalledWith(setWorkspaceEntity(openedWorkspace)),
    );

    const workspaceEntityActions = dispatchMock.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === setWorkspaceEntity.type);

    expect(workspaceEntityActions).toEqual([
      setWorkspaceEntity(cachedWorkspace),
      setWorkspaceEntity(openedWorkspace),
    ]);
  });

  it('loads a workspace without synchronizing global active or lifecycle state', async () => {
    const workspace = makeWorkspace({ id: 'loader-inactive-column' });
    selectWorkspaceByIdMock.mockReturnValue(workspace);
    openMock.mockResolvedValue({ ok: true, data: workspace });

    render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: workspace.id,
        workspaceState: createWorkspaceState(),
      },
    });

    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    expect(
      dispatchMock.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type.startsWith('workspace-lifecycle/')),
    ).toEqual([]);
  });

  it('pre-populates a cached workspace without touching lifecycle or initial-agent state', async () => {
    // Regression: the loader used to read `initialAgentConfig` and pre-dispatch
    // `setInitialAgentId` before `workspaceMounted`. Now that the daemon owns
    // initial-agent creation, the loader must NOT insert any initial-agent
    // dispatch into that sequence.
    const cachedWorkspace = makeWorkspace({ id: 'loader-initial-agent-1', title: 'New Workspace' });
    selectWorkspaceByIdMock.mockReturnValue(cachedWorkspace);
    openMock.mockResolvedValue({ ok: true, data: cachedWorkspace });

    storeStateRef.current = {
      workspaceAgents: {
        byWorkspaceId: {
          [cachedWorkspace.id]: { ...emptyWorkspaceAgentState },
        },
      },
    };

    render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: cachedWorkspace.id,
        workspaceState: createWorkspaceState(),
        state: null,
        previousWorkspaceId: null,
      },
    });

    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));

    expect(dispatchMock.mock.calls[0]?.[0]).toEqual(setWorkspaceEntity(cachedWorkspace));
    expect(
      dispatchMock.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type.startsWith('workspace-lifecycle/')),
    ).toEqual([]);
  });

  it('exposes a not_found loadError when open fails twice with "Workspace not found" and no cached entity exists', async () => {
    selectWorkspaceByIdMock.mockReturnValue(null);
    openMock.mockResolvedValue({ ok: false, error: 'Workspace not found' });

    const workspaceState = createWorkspaceState();
    render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: 'loader-missing-1',
        workspaceState,
        state: null,
        previousWorkspaceId: null,
      },
    });

    // The loader retries once after a 500ms delay before giving up.
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await waitFor(() =>
      expect(screen.getByTestId('load-error-kind').textContent).toBe('not_found'),
    );
    expect(screen.getByTestId('load-error-message').textContent).toBe('Workspace not found');

    expect(workspaceState.updateState).toHaveBeenCalledWith({
      workspace: { id: 'loader-missing-1', status: 'error' },
      workspaceData: {
        id: 'loader-missing-1',
        title: 'Space not found',
        status: 'not_found',
      },
    });

    // The ghost tab is removed from the strip on definitive not-found.
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: closeWorkspaceTab.type,
        payload: ['loader-missing-1', expect.any(Number)],
      }),
    );
  });

  it('exposes a generic loadError for non-not-found failures', async () => {
    selectWorkspaceByIdMock.mockReturnValue(null);
    openMock.mockResolvedValue({ ok: false, error: 'Backend exploded' });

    const workspaceState = createWorkspaceState();
    render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: 'loader-broken-1',
        workspaceState,
        state: null,
        previousWorkspaceId: null,
      },
    });

    await waitFor(() => expect(screen.getByTestId('load-error-kind').textContent).toBe('error'));
    expect(screen.getByTestId('load-error-message').textContent).toBe(
      'Failed to open space: Backend exploded',
    );

    expect(workspaceState.updateState).toHaveBeenCalledWith({
      workspace: { id: 'loader-broken-1', status: 'error' },
      workspaceData: {
        id: 'loader-broken-1',
        title: 'Error loading space',
        status: 'error',
        error: 'Failed to open space: Backend exploded',
      },
    });
  });

  it('does not set loadError from a stale not-found failure after navigating away within the retry window', async () => {
    const goodWorkspace = makeWorkspace({ id: 'loader-good-2', title: 'Good Workspace' });
    selectWorkspaceByIdMock.mockReturnValue(null);
    openMock.mockImplementation(async (id: string) =>
      id === goodWorkspace.id
        ? { ok: true, data: goodWorkspace }
        : { ok: false, error: 'Workspace not found' },
    );

    const staleWorkspaceState = createWorkspaceState();
    const { rerender } = render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: 'loader-missing-3',
        workspaceState: staleWorkspaceState,
        state: null,
        previousWorkspaceId: null,
      },
    });

    // Wait for the first not-found attempt, then navigate away while the
    // loader is still inside its 500ms retry window.
    await waitFor(() => expect(openMock).toHaveBeenCalledWith('loader-missing-3'));

    await rerender({
      workspaceId: goodWorkspace.id,
      workspaceState: createWorkspaceState(),
      state: null,
      previousWorkspaceId: 'loader-missing-3',
    });

    // Navigation invalidates the stale load before its retry reaches the backend.
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(openMock.mock.calls.filter(([id]) => id === 'loader-missing-3')).toHaveLength(1);

    expect(screen.getByTestId('load-error-kind').textContent).toBe('');
    expect(screen.getByTestId('load-error-message').textContent).toBe('');
    // The stale state manager must not receive the not-found error state.
    expect(staleWorkspaceState.updateState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceData: expect.objectContaining({ status: 'not_found' }),
      }),
    );
    // The superseded load must not close any tab either.
    expect(dispatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: closeWorkspaceTab.type }),
    );
  });

  it('does not set loadError from a stale generic failure after navigating away mid-load', async () => {
    const goodWorkspace = makeWorkspace({ id: 'loader-good-3', title: 'Good Workspace' });
    selectWorkspaceByIdMock.mockReturnValue(null);

    let resolveStaleOpen: ((result: unknown) => void) | undefined;
    openMock.mockImplementation((id: string) =>
      id === goodWorkspace.id
        ? Promise.resolve({ ok: true, data: goodWorkspace })
        : new Promise((resolve) => {
            resolveStaleOpen = resolve;
          }),
    );

    const staleWorkspaceState = createWorkspaceState();
    const { rerender } = render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: 'loader-broken-2',
        workspaceState: staleWorkspaceState,
        state: null,
        previousWorkspaceId: null,
      },
    });

    await waitFor(() => expect(resolveStaleOpen).toBeDefined());

    await rerender({
      workspaceId: goodWorkspace.id,
      workspaceState: createWorkspaceState(),
      state: null,
      previousWorkspaceId: 'loader-broken-2',
    });

    // The stale open now fails, which would previously write a generic loadError.
    resolveStaleOpen!({ ok: false, error: 'Backend exploded' });
    await waitFor(() =>
      expect(openMock.mock.calls.filter(([id]) => id === goodWorkspace.id).length).toBe(1),
    );

    expect(screen.getByTestId('load-error-kind').textContent).toBe('');
    expect(screen.getByTestId('load-error-message').textContent).toBe('');
    expect(staleWorkspaceState.updateState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceData: expect.objectContaining({ status: 'error' }),
      }),
    );
  });

  it('evicts the cached entity and reports not_found when open fails twice with "Workspace not found" (#766)', async () => {
    const cachedWorkspace = makeWorkspace({ id: 'loader-zombie-1', title: 'Deleted Workspace' });
    selectWorkspaceByIdMock.mockReturnValue(cachedWorkspace);
    openMock.mockResolvedValue({ ok: false, error: 'Workspace not found' });

    const workspaceState = createWorkspaceState();
    render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: cachedWorkspace.id,
        workspaceState,
        state: null,
        previousWorkspaceId: null,
      },
    });

    // The loader retries once after a 500ms delay before giving up.
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await waitFor(() =>
      expect(screen.getByTestId('load-error-kind').textContent).toBe('not_found'),
    );
    expect(screen.getByTestId('load-error-message').textContent).toBe('Workspace not found');

    const actions = dispatchMock.mock.calls.map(([action]) => action);
    expect(actions).toContainEqual(removeWorkspaceEntity(cachedWorkspace.id));

    // The ghost tab is removed from the strip on definitive not-found.
    expect(actions).toContainEqual(
      expect.objectContaining({
        type: closeWorkspaceTab.type,
        payload: [cachedWorkspace.id, expect.any(Number)],
      }),
    );

    // Route loading does not own workspace lifecycle; canonical tab focus/removal does.
    expect(actions.filter((action) => action.type.startsWith('workspace-lifecycle/'))).toEqual([]);

    expect(workspaceState.updateState).toHaveBeenCalledWith({
      workspace: { id: cachedWorkspace.id, status: 'error' },
      workspaceData: {
        id: cachedWorkspace.id,
        title: 'Space not found',
        status: 'not_found',
      },
    });
  });

  it('retains the cached entity on generic (non-not-found) open failures', async () => {
    const cachedWorkspace = makeWorkspace({ id: 'loader-flaky-1', title: 'Flaky Workspace' });
    selectWorkspaceByIdMock.mockReturnValue(cachedWorkspace);
    openMock.mockResolvedValue({ ok: false, error: 'Backend exploded' });

    const workspaceState = createWorkspaceState();
    render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: cachedWorkspace.id,
        workspaceState,
        state: null,
        previousWorkspaceId: null,
      },
    });

    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    // Let the load settle: the cached entity is written again (as ready)
    // after the failed open resolves — pre-population is the first call.
    await waitFor(() => expect(workspaceState.updateState).toHaveBeenCalledTimes(2));
    expect(workspaceState.updateState).toHaveBeenLastCalledWith({
      workspaceData: cachedWorkspace,
      workspace: { id: cachedWorkspace.id, status: 'ready' },
    });

    const actions = dispatchMock.mock.calls.map(([action]) => action);
    expect(actions.filter((action) => action.type === removeWorkspaceEntity.type)).toEqual([]);
    expect(actions.filter((action) => action.type === closeWorkspaceTab.type)).toEqual([]);
    expect(
      actions.filter((action) => action.type === 'workspace-lifecycle/workspaceUnmounted'),
    ).toEqual([]);
    expect(screen.getByTestId('load-error-kind').textContent).toBe('');
    expect(workspaceState.updateState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceData: expect.objectContaining({ status: 'not_found' }),
      }),
    );
  });

  it('does not evict a cached entity from a stale not-found failure after navigating away within the retry window', async () => {
    const staleWorkspace = makeWorkspace({ id: 'loader-stale-cache-1', title: 'Stale Workspace' });
    const goodWorkspace = makeWorkspace({ id: 'loader-good-4', title: 'Good Workspace' });
    selectWorkspaceByIdMock.mockImplementation((id: string) =>
      id === staleWorkspace.id ? staleWorkspace : null,
    );
    openMock.mockImplementation(async (id: string) =>
      id === goodWorkspace.id
        ? { ok: true, data: goodWorkspace }
        : { ok: false, error: 'Workspace not found' },
    );

    const staleWorkspaceState = createWorkspaceState();
    const { rerender } = render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: staleWorkspace.id,
        workspaceState: staleWorkspaceState,
        state: null,
        previousWorkspaceId: null,
      },
    });

    // Wait for the first not-found attempt, then navigate away while the
    // loader is still inside its 500ms retry window.
    await waitFor(() => expect(openMock).toHaveBeenCalledWith(staleWorkspace.id));

    await rerender({
      workspaceId: goodWorkspace.id,
      workspaceState: createWorkspaceState(),
      state: null,
      previousWorkspaceId: staleWorkspace.id,
    });

    // Navigation invalidates the stale load before its retry reaches the backend.
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(openMock.mock.calls.filter(([id]) => id === staleWorkspace.id)).toHaveLength(1);

    const actions = dispatchMock.mock.calls.map(([action]) => action);
    expect(actions.filter((action) => action.type === removeWorkspaceEntity.type)).toEqual([]);
    expect(actions.filter((action) => action.type === closeWorkspaceTab.type)).toEqual([]);
    expect(screen.getByTestId('load-error-kind').textContent).toBe('');
    expect(staleWorkspaceState.updateState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceData: expect.objectContaining({ status: 'not_found' }),
      }),
    );
  });

  it('clears loadError when navigating to another workspace', async () => {
    const goodWorkspace = makeWorkspace({ id: 'loader-good-1', title: 'Good Workspace' });
    selectWorkspaceByIdMock.mockReturnValue(null);
    openMock.mockImplementation(async (id: string) =>
      id === goodWorkspace.id
        ? { ok: true, data: goodWorkspace }
        : { ok: false, error: 'Workspace not found' },
    );

    const { rerender } = render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: 'loader-missing-2',
        workspaceState: createWorkspaceState(),
        state: null,
        previousWorkspaceId: null,
      },
    });

    await waitFor(
      () => expect(screen.getByTestId('load-error-kind').textContent).toBe('not_found'),
      { timeout: 3000 },
    );

    await rerender({
      workspaceId: goodWorkspace.id,
      workspaceState: createWorkspaceState(),
      state: null,
      previousWorkspaceId: 'loader-missing-2',
    });

    await waitFor(() => expect(screen.getByTestId('load-error-kind').textContent).toBe(''));
    expect(screen.getByTestId('load-error-message').textContent).toBe('');
  });

  it('ignores an older workspace load that completes after the current workspace', async () => {
    const workspaceA = makeWorkspace({ id: 'loader-race-a', title: 'Workspace A' });
    const workspaceB = makeWorkspace({ id: 'loader-race-b', title: 'Workspace B' });
    const stateA = createWorkspaceState();
    const stateB = createWorkspaceState();
    const openA = createDeferred<{ ok: true; data: Workspace }>();
    const openB = createDeferred<{ ok: true; data: Workspace }>();
    openMock.mockImplementation((id: string) =>
      id === workspaceA.id ? openA.promise : openB.promise,
    );

    const view = render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: workspaceA.id,
        workspaceState: stateA,
        state: null,
        previousWorkspaceId: null,
      },
    });
    await waitFor(() => expect(openMock).toHaveBeenCalledWith(workspaceA.id));
    await view.rerender({
      workspaceId: workspaceB.id,
      workspaceState: stateB,
      state: null,
      previousWorkspaceId: workspaceA.id,
    });
    await waitFor(() => expect(openMock).toHaveBeenCalledWith(workspaceB.id));

    openB.resolve({ ok: true, data: workspaceB });
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledWith(setWorkspaceEntity(workspaceB)));
    openA.resolve({ ok: true, data: workspaceA });
    await flushAsyncWork();

    expect(stateA.updateState).not.toHaveBeenCalled();
    expect(stateA.markInitialized).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalledWith(setWorkspaceEntity(workspaceA));
    expect(
      dispatchMock.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type.startsWith('workspace-lifecycle/')),
    ).toEqual([]);
  });

  it('invalidates an outstanding workspace load when the loader is destroyed', async () => {
    const workspace = makeWorkspace({ id: 'loader-unmount' });
    const workspaceState = createWorkspaceState();
    const open = createDeferred<{ ok: true; data: Workspace }>();
    openMock.mockReturnValue(open.promise);
    const view = render(TestUseWorkspaceLoader, {
      props: {
        workspaceId: workspace.id,
        workspaceState,
        state: null,
        previousWorkspaceId: workspace.id,
      },
    });

    await waitFor(() => expect(openMock).toHaveBeenCalledWith(workspace.id));
    view.unmount();
    open.resolve({ ok: true, data: workspace });
    await flushAsyncWork();

    expect(workspaceState.updateState).not.toHaveBeenCalled();
    expect(workspaceState.markInitialized).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
