import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { connectionsListReceived, connectionsReducer } from '../../connections/connections-slice';
import {
  markWorkspacePendingDeletion,
  removeWorkspaceEntity,
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
  // The saga worker parks on `delay(0)` (a macrotask) before re-reading the
  // selector, so flush timers as well as microtasks.
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let j = 0; j < 6; j++) await Promise.resolve();
  }
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

/** `connectionsListReceived` payload switching the active backend. */
function backendActive(activeId: string) {
  return connectionsListReceived({ connections: [], activeId, windowBackendId: activeId });
}

function createHarness() {
  let state = {
    tabState: tabStateReducer(undefined, { type: '@@INIT' }),
    workspace: workspaceReducer(undefined, { type: '@@INIT' }),
    connections: connectionsReducer(undefined, { type: '@@INIT' }),
  };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: { type: string; payload?: unknown }) => {
    state = {
      tabState: tabStateReducer(state.tabState, action as never),
      workspace: workspaceReducer(state.workspace, action as never),
      connections: connectionsReducer(state.connections, action as never),
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
    harness.dispatch(backendActive('local'));
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-A', 'ws-ghost'])));
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-A' })]));
    harness.dispatch(setWorkspaceHasLoaded(true, 'local'));
    await settle();

    expect(prunedIds()).toEqual(['ws-ghost']);
    expect(Object.keys(harness.getState().tabState.openTabs)).toEqual(['ws-A']);
    await finish(harness);
  });

  it('keeps tabs whose workspace is archived (only missing workspaces are pruned)', async () => {
    const harness = createHarness();
    harness.dispatch(backendActive('local'));
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
    harness.dispatch(setWorkspaceHasLoaded(true, 'local'));
    await settle();

    expect(prunedIds()).toEqual([]);
    expect(Object.keys(harness.getState().tabState.openTabs)).toEqual(['ws-A', 'ws-archived']);
    await finish(harness);
  });

  it('skips reconciliation entirely when the loaded workspace list is empty', async () => {
    const harness = createHarness();
    harness.dispatch(backendActive('local'));
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-A', 'ws-B'])));
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(replaceWorkspaceList([]));
    harness.dispatch(setWorkspaceHasLoaded(true, 'local'));
    await settle();

    expect(prunedIds()).toEqual([]);
    expect(Object.keys(harness.getState().tabState.openTabs)).toEqual(['ws-A', 'ws-B']);
    await finish(harness);
  });

  it('never prunes optimistic tabs or workspaces with a pending creation', async () => {
    const harness = createHarness();
    harness.dispatch(backendActive('local'));
    harness.dispatch(
      loadWorkspaceTabsState(
        persistedTabs(['ws-A', 'ws-optimistic', 'ws-pending'], ['ws-optimistic']),
      ),
    );
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(setPendingCreation(makeWorkspace({ id: 'ws-pending' })));
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-A' })]));
    harness.dispatch(setWorkspaceHasLoaded(true, 'local'));
    await settle();

    expect(prunedIds()).toEqual([]);
    await finish(harness);
  });

  it('never prunes a workspace inside the delete-undo grace window', async () => {
    const harness = createHarness();
    harness.dispatch(backendActive('local'));
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-A', 'ws-deleting'])));
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(
      replaceWorkspaceList([makeWorkspace({ id: 'ws-A' }), makeWorkspace({ id: 'ws-deleting' })]),
    );
    harness.dispatch(setWorkspaceHasLoaded(true, 'local'));
    await settle();
    expect(prunedIds()).toEqual([]);

    // Delete-with-undo removes the entity from the collection up front while
    // the daemon owns the grace window — the background tab must survive so
    // an undo can restore it.
    harness.dispatch(removeWorkspaceEntity('ws-deleting'));
    harness.dispatch(markWorkspacePendingDeletion('ws-deleting'));
    await settle();

    expect(prunedIds()).toEqual([]);
    expect(Object.keys(harness.getState().tabState.openTabs)).toEqual(['ws-A', 'ws-deleting']);
    await finish(harness);
  });

  it('waits for both hydration and a completed list load before pruning', async () => {
    const harness = createHarness();
    harness.dispatch(backendActive('local'));
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-ghost'])));
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-A' })]));
    harness.dispatch(setWorkspaceHasLoaded(true, 'local'));
    await settle();
    expect(prunedIds()).toEqual([]);

    harness.dispatch(workspaceTabsHydrated('local'));
    await settle();

    expect(prunedIds()).toEqual(['ws-ghost']);
    await finish(harness);
  });

  it('does not prune before the connections list has been received', async () => {
    const harness = createHarness();
    // Boot: hydration + list load both land while `activeId` is still the
    // boot-time local default — the true active backend may be remote, so
    // nothing may be pruned yet.
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-A', 'ws-ghost'])));
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-A' })]));
    harness.dispatch(setWorkspaceHasLoaded(true, 'local'));
    await settle();
    expect(prunedIds()).toEqual([]);

    // The connections list confirms local is really active → safe to prune.
    harness.dispatch(backendActive('local'));
    await settle();

    expect(prunedIds()).toEqual(['ws-ghost']);
    await finish(harness);
  });

  it('does not prune while hydration belongs to a different backend, and re-runs after the switch re-hydrates', async () => {
    const harness = createHarness();
    harness.dispatch(backendActive('local'));
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-A'])));
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-A' })]));
    harness.dispatch(setWorkspaceHasLoaded(true, 'local'));
    await settle();
    expect(prunedIds()).toEqual([]);

    // Backend switch: the strip is stale (hydratedBackendId !== activeId), so
    // the remote backend's list must not prune the not-yet-rehydrated tabs.
    harness.dispatch(backendActive('remote-1'));
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-remote' })]));
    harness.dispatch(setWorkspaceHasLoaded(true, 'remote-1'));
    await settle();
    expect(prunedIds()).toEqual([]);

    // Re-hydration for the new backend settles with a ghost tab → pruned.
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-remote', 'ws-stale'])));
    harness.dispatch(workspaceTabsHydrated('remote-1'));
    await settle();

    expect(prunedIds()).toEqual(['ws-stale']);
    await finish(harness);
  });

  it("does not reconcile a re-hydrated strip against the previous backend's list", async () => {
    const harness = createHarness();
    harness.dispatch(backendActive('local'));
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-A'])));
    harness.dispatch(workspaceTabsHydrated('local'));
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-A' })]));
    harness.dispatch(setWorkspaceHasLoaded(true, 'local'));
    await settle();
    expect(prunedIds()).toEqual([]);

    // Switch: the strip re-hydrates for remote-1 BEFORE its workspace-list
    // RPC returns. `hasLoaded` is still true from the previous backend, but
    // `loadedBackendId` is stale — the remote tabs must not be compared
    // against the local list.
    harness.dispatch(backendActive('remote-1'));
    harness.dispatch(loadWorkspaceTabsState(persistedTabs(['ws-remote', 'ws-stale'])));
    harness.dispatch(workspaceTabsHydrated('remote-1'));
    await settle();
    expect(prunedIds()).toEqual([]);

    // The remote list lands → only the genuinely stale tab is pruned.
    harness.dispatch(replaceWorkspaceList([makeWorkspace({ id: 'ws-remote' })]));
    harness.dispatch(setWorkspaceHasLoaded(true, 'remote-1'));
    await settle();

    expect(prunedIds()).toEqual(['ws-stale']);
    await finish(harness);
  });
});
