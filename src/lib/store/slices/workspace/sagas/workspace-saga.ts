import { firstVisitStateClient } from "$features/workspace/first-visit-state.client";
import { workspaceStore } from "$features/workspace/workspace.store.svelte";
import { takeEveryFromListenSync } from "$lib/store/utils/ipc-channel";
import type { FirstVisitState } from "$shared/types";
import { WorkspaceId } from "$shared/types/branded-ids";
import { call, fork, put, takeEvery } from "typed-redux-saga";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import type { PanelVisibilityState, WorkspaceUpdatedEvent } from "../workspace-slice";
import {
  defaultPanelVisibility,
  setPanelVisibilityBulk,
  updateWorkspaceEntity,
} from "../workspace-slice";

// ---------------------------------------------------------------------------
// Workspace :updated IPC listener
// ---------------------------------------------------------------------------

function applyWorkspaceUpdate(data: WorkspaceUpdatedEvent): void {
  workspaceStore.updateLocalWorkspace(WorkspaceId(data.workspaceId), data.changes);
}

export function* watchWorkspaceUpdatedSaga() {
  yield* takeEveryFromListenSync<WorkspaceUpdatedEvent>("workspace:updated", function* (data) {
    yield* call(applyWorkspaceUpdate, data);
    // Keep the Redux workspace entity in sync with incoming updates.
    yield* put(updateWorkspaceEntity(data.workspaceId, data.changes));
  });
}

// ---------------------------------------------------------------------------
// First-visit state → Redux panel visibility hydration
// ---------------------------------------------------------------------------

/**
 * Map persisted first-visit state to Redux PanelVisibilityState.
 *
 * The first-visit state only tracks three flags (navigationRailRevealed,
 * mainContentRevealed, workspaceDockRevealed). All other panel flags default
 * to their defaultPanelVisibility values.
 */
export function mapFirstVisitToVisibility(
  fvs: FirstVisitState,
): Partial<PanelVisibilityState> {
  return {
    showNavigationRail: fvs.navigationRailRevealed,
    showMainContent: fvs.mainContentRevealed,
    showChatHeader: fvs.mainContentRevealed,
    isChatFocusedMode: !fvs.mainContentRevealed,
    showWorkspaceDock: fvs.workspaceDockRevealed,
  };
}

/**
 * On workspace mount: load persisted first-visit state and hydrate the
 * workspace-scoped panel visibility in Redux.
 *
 * If no persisted state exists (brand-new workspace) defaults are already
 * correct so no dispatch is needed.
 */
export function* handleFirstVisitHydration(
  action: ReturnType<typeof workspaceMounted>,
) {
  const [wsId] = action.payload;

  try {
    const state: FirstVisitState | null = yield* call(
      [firstVisitStateClient, firstVisitStateClient.load],
      WorkspaceId(wsId),
    );

    if (state) {
      const updates = mapFirstVisitToVisibility(state);
      yield* put(setPanelVisibilityBulk(wsId, updates));
    }
  } catch {
    // Defaults are already correct; swallow the error.
  }
}

// ---------------------------------------------------------------------------
// Workspace lifecycle watchers
// ---------------------------------------------------------------------------

export function* watchWorkspaceLifecycleSaga() {
  yield* takeEvery(workspaceMounted, handleFirstVisitHydration);
  // workspaceUnmounted: panel visibility is intentionally preserved across
  // workspace switches (see reducer). No cleanup needed here.
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* workspaceSaga() {
  yield* fork(watchWorkspaceUpdatedSaga);
  yield* fork(watchWorkspaceLifecycleSaga);
}