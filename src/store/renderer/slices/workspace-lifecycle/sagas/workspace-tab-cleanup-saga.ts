import { buffers } from 'redux-saga';
import { actionChannel, put, take, type SagaGenerator } from 'typed-redux-saga';

import {
  selectActiveWorkspaceIds,
  selectCurrentWorkspaceTabId,
} from '../../tab-state/tab-state-selectors';
import { CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS } from '../../tab-state/tab-state-slice';
import {
  workspaceDeleted,
  workspaceHydrationRequested,
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
import { selectIsWorkspaceSessionLive } from '../workspace-lifecycle-selectors';

export function* workspaceTabCleanupSaga(): SagaGenerator<void> {
  const lifecycleChanges = yield* actionChannel(
    [...CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS, workspaceDeleted],
    buffers.expanding(),
  );
  let previousFocusedId = yield* selectCurrentWorkspaceTabId.effect();
  let previousIds = yield* selectActiveWorkspaceIds.effect();
  const unmountedWorkspaceIds = new Set<string>();

  try {
    if (previousFocusedId && !(yield* selectIsWorkspaceSessionLive.effect(previousFocusedId))) {
      yield* put(workspaceHydrationRequested(previousFocusedId));
    }

    while (true) {
      const action = yield* take(lifecycleChanges);
      const currentFocusedId = yield* selectCurrentWorkspaceTabId.effect();
      const currentIds = yield* selectActiveWorkspaceIds.effect();
      const currentIdSet = new Set(currentIds);
      const focusChanged = currentFocusedId !== previousFocusedId;
      const unmountedIds = new Set<string>();

      // Focus changes keep the previous workspace session warm. Teardown is
      // reserved for tabs that disappear or workspaces that are deleted.
      for (const workspaceId of previousIds) {
        if (!currentIdSet.has(workspaceId)) unmountedIds.add(workspaceId);
      }
      if (action.type === workspaceDeleted.type) {
        unmountedIds.add((action as ReturnType<typeof workspaceDeleted>).payload[0]);
      }

      previousFocusedId = currentFocusedId;
      previousIds = currentIds;

      for (const workspaceId of unmountedIds) {
        if (unmountedWorkspaceIds.has(workspaceId)) continue;
        unmountedWorkspaceIds.add(workspaceId);
        yield* put(workspaceUnmounted(workspaceId));
      }
      if (focusChanged && currentFocusedId) {
        unmountedWorkspaceIds.delete(currentFocusedId);
        if (!(yield* selectIsWorkspaceSessionLive.effect(currentFocusedId))) {
          yield* put(workspaceHydrationRequested(currentFocusedId));
        }
      }
    }
  } finally {
    lifecycleChanges.close();
  }
}
