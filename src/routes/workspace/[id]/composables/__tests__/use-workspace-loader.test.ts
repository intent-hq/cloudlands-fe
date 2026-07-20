import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  render,
  waitFor,
} from '@testing-library/svelte';
import type { Workspace } from '$shared/types';
import { workspaceMounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { emptyWorkspaceAgentState } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import TestUseWorkspaceLoader from './TestUseWorkspaceLoader.test.svelte';

const { dispatchMock, openMock, selectWorkspaceByIdMock, selectActiveWorkspaceMock, storeStateRef } = vi.hoisted(() => {
  const dispatchMock = vi.fn();
  const openMock = vi.fn();
  const selectWorkspaceByIdMock = vi.fn();
  const selectActiveWorkspaceMock = vi.fn();
  const storeStateRef = { current: {} as Record<string, unknown> };

  return { dispatchMock, openMock, selectWorkspaceByIdMock, selectActiveWorkspaceMock, storeStateRef };
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: {
    select: (_state: unknown, workspaceId: string) => selectWorkspaceByIdMock(workspaceId),
  },
  selectActiveWorkspace: {
    select: () => selectActiveWorkspaceMock(),
  },
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { open: openMock },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
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

describe('useWorkspaceLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeStateRef.current = {
      workspaceAgents: {
        byWorkspaceId: {},
      },
    };
    selectWorkspaceByIdMock.mockReturnValue(null);
    selectActiveWorkspaceMock.mockReturnValue(null);
  });

  it('hydrates Redux from cached workspace data before open completes', async () => {
    const cachedWorkspace = makeWorkspace({ id: 'loader-cache-1', title: 'Cached Workspace' });
    selectWorkspaceByIdMock.mockReturnValue(cachedWorkspace);
    openMock.mockResolvedValue({ ok: true, data: cachedWorkspace });

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
    expect(dispatchMock.mock.calls[1]?.[0]).toEqual(workspaceMounted(cachedWorkspace.id));
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

    await waitFor(() => expect(dispatchMock).toHaveBeenCalledWith(setWorkspaceEntity(openedWorkspace)));

    const workspaceEntityActions = dispatchMock.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === setWorkspaceEntity.type);

    expect(workspaceEntityActions).toEqual([
      setWorkspaceEntity(cachedWorkspace),
      setWorkspaceEntity(openedWorkspace),
    ]);
  });

  it('dispatches setWorkspaceEntity → workspaceMounted for a cached workspace without touching initial-agent-config state', async () => {
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

    expect(dispatchMock.mock.calls.slice(0, 2).map(([action]) => action)).toEqual([
      setWorkspaceEntity(cachedWorkspace),
      workspaceMounted(cachedWorkspace.id),
    ]);
  });
});