import { put, type SagaGenerator } from 'typed-redux-saga';

import { routedWorkspaceId } from '../../../utils/routed-workspace-id';
import { consumePanelReveal, consumePendingFocus } from '../panel-layout-slice';

/**
 * Drop the UI-reveal markers a layout mutation just queued when this window
 * is not currently displaying the workspace (monorepo#3045): the persisted
 * layout state (mounted tab, active tab, focused panel) stands, but no
 * actual UI focus/scroll is attempted — without this, the deferred reveal
 * would fire whenever the user next displays the workspace. A no-op when the
 * workspace is the one this window's route displays (the reveal proceeds as
 * usual) or when the markers belong to a different request.
 */
export function* dropRevealIfWorkspaceNotDisplayed(
  workspaceId: string,
  requestId: string,
): SagaGenerator<void> {
  if (routedWorkspaceId() === workspaceId) return;
  yield* put(consumePanelReveal(workspaceId, requestId));
  yield* put(consumePendingFocus(workspaceId, requestId));
}
