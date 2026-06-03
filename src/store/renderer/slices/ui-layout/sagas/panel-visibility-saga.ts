import { firstVisitStateClient } from "$store/renderer/slices/workspace/utils/first-visit-state.client";
import type { FirstVisitState } from "$shared/types";
import { WorkspaceId } from "$shared/types/branded-ids";
import {
  call,
  put,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  setPanelVisibilityBulk,
  type PanelVisibilityState,
} from "../ui-layout-slice";

export function mapFirstVisitToPanelVisibility(
  state: FirstVisitState,
): Partial<PanelVisibilityState> {
  return {
    showNavigationRail: state.navigationRailRevealed,
    showMainContent: state.mainContentRevealed,
    showChatHeader: state.mainContentRevealed,
    isChatFocusedMode: !state.mainContentRevealed,
    showWorkspaceDock: state.workspaceDockRevealed,
  };
}

export function* handleFirstVisitHydration(
  action: ReturnType<typeof workspaceMounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;

  try {
    const firstVisitState: FirstVisitState | null = yield* call(
      [firstVisitStateClient, firstVisitStateClient.load],
      WorkspaceId(workspaceId),
    );

    if (firstVisitState) {
      yield* put(
        setPanelVisibilityBulk(workspaceId, mapFirstVisitToPanelVisibility(firstVisitState)),
      );
    }
  } catch {
    // Defaults are already correct; ignore hydration failures.
  }
}

export function* panelVisibilitySaga(): SagaGenerator<void> {
  yield* takeEvery(workspaceMounted, handleFirstVisitHydration);
}