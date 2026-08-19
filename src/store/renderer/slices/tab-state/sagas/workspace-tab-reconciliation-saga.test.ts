import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import {
  replaceWorkspaceList,
  setPendingCreation,
  setWorkspaceHasLoaded,
  workspaceReducer,
} from '../../workspace/workspace-slice';
import {
  closeWorkspaceTab,
  loadWorkspaceTabsState,
  tabStateReducer,
  workspaceTabsHydrated,
  type PersistedWorkspaceTabsState,
} from '../tab-state-slice';
import { workspaceTabReconciliationSaga } from './workspace-tab-reconciliation-saga';

const mocks = vi.hoisted(() => ({
  closeAndNavigate: vi.fn(),
}));

vi.mock('$features/workspace/navigate-away-if-viewing', () => ({
  closeWorkspaceTabAndNavigateAway: mocks.closeAndNavigate,
  navigateAwayIfViewing: vi.fn(async () => {}),
}));

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
    id: overrides.id as WorkspaceId,
  };
}

function persistedTabs(
  tabIds: string[],
  optimisticTabs: string[] = [],
): PersistedWorkspaceTabsState {
  return {
    openTabs: tabIds,
    currentTabId: tabIds[0] ?? null,
    pinnedTabs: [],
    unsavedTabs: [],
    optimisticTabs,
    tabOrder: tabIds,
  };
}

const SET_ACTIVE_BACKEND = 'test/setActiveBackend';

function createHarness() {
  let state = {
    tabState: tabStateReducer(undefined, { type: '@@INIT' }),
    workspace: workspaceReducer(undefined, { type: '@@INIT' }),
    connections: { activeId: 'local' },
  };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: { type: string; payload?: unknown }) => {
    state = {
      tabState: tabStateReducer(state.tabState, action as never),
      workspace: workspaceReducer(state.workspace, action as never),
      connections:
        action.type === SET_ACTIVE_BACKEND
          ? { activeId: action.payload as string }
          : state.connections,
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
    workspaceTabReconciliationSaga,
  );
  // The mocked navigation helper mirrors the real one: it closes the tab.
  mocks.closeAndNavigate.mockImplementation(async (workspaceId: string) => {
    dispatch(closeWorkspaceTab(workspaceId));
  });
  return { dispatch, getState: reduxStore.getState, task };
}

async function finish(harness: ReturnType<typeof createHarness>) {
  harness.task.cancel();
  await harness.task.toPromise();
}

function prunedIds(): string[] {
  return mocks.closeAndNavigate.mock.calls.map(([workspaceId]) => workspaceId as string);
}

describe('workspaceTabReconciliationSaga', () => {
  beforeEach(() => {
    mocks.closeAndNavigate.mockReset();
  });

  it('prunes tabs whose workspace is missing from the loaded list', async () => {
    const harness = createHarness();
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-A', 'ws-ghost'])));
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-A' })]));
    harness.dispatch(setWorkspaceHasLoaded(true));
    await settle();

    expect(prunedIds()).toEqual(['ws-ghost']);
    expect(Object.keys(harness.getState().tabState.openTabs)).toEqual(['ws-A']);
    await finish(harness);
  });

  it('prunes tabs whose workspace is archived', async () => {
    const harness = createHarness();
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-A', 'ws-archived'])));
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(
      replaceWorkspaceList([
        makeWorkspace({ id: 'ws-A' }),
        makeWorkspace({
          id: 'ws-archived',
          status: WorkspaceStatusEnum.Archived,
          archived: true,
        }),
      ]),
    );
    harness.dispatch(setWorkspaceHasLoaded(true));
    await settle();

    expect(prunedIds()).toEqual(['ws-archived']);
    await finish(harness);
  });

  it('skips reconciliation entirely when the loaded workspace list is empty', async () => {
    const harness = createHarness();
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-A', 'ws-B'])));
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(replaceWorkspaceList([]));
    harness.dispatch(setWorkspaceHasLoaded(true));
    await settle();

    expect(prunedIds()).toEqual([]);
    expect(Object.keys(harness.getState().tabState.openTabs)).toEqual(['ws-A', 'ws-B']);
    await finish(harness);
  });

  it('never prunes optimistic tabs or workspaces with a pending creation', async () => {
    const harness = createHarness();
    harness.dispatch(
      loadWorkspaceTabsState(
        persistedTabs(['ws-A', 'ws-optimistic', 'ws-pending'], ['ws-optimistic']),
      ),
    );
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(setPendingCreation(makeWorkspace({ id: 'ws-pending' })));
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-A' })]));
    harness.dispatch(setWorkspaceHasLoaded(true));
    await settle();

    expect(prunedIds()).toEqual([]);
    await finish(harness);
  });

  it('waits for both hydration and a completed list load before pruning', async () => {
    const harness = createHarness();
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-ghost'])));
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-A' })]));
    harness.dispatch(setWorkspaceHasLoaded(true));
    await settle();
    expect(prunedIds()).toEqual([]);

    harness.dispatch(workspaceTabsHydrated('local'));
    await settle();

    expect(prunedIds()).toEqual(['ws-ghost']);
    await finish(harness);
  });

  it('does not prune while hydration belongs to a different backend, and re-runs after the switch re-hydrates', async () => {
    const harness = createHarness();
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-A'])));
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-A' })]));
    harness.dispatch(setWorkspaceHasLoaded(true));
    await settle();
    expect(prunedIds()).toEqual([]);

    // Backend switch: the strip is stale (hydratedBackendId !== activeId), so
    // the remote backend's list must not prune the not-yet-rehydrated tabs.
    harness.dispatch({ type: SET_ACTIVE_BACKEND, payload: 'remote-1' });
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-remote' })]));
    await settle();
    expect(prunedIds()).toEqual([]);

    // Re-hydration for the new backend settles with a ghost tab → pruned.
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-remote', 'ws-stale'])));
    harness.dispatch(workspaceTabsHydrated('remote-1'));
    await settle();

    expect(prunedIds()).toEqual(['ws-stale']);
    await finish(harness);
  });
});
