import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { all, put, type SagaGenerator } from 'typed-redux-saga';

import { selectActiveWorkspaceIds } from '../../tab-state/tab-state-selectors';
import { workspaceUnmounted } from '../workspace-lifecycle-slice';

export function* workspaceTabCleanupSaga(): SagaGenerator<void> {
  let previousIds = yield* selectActiveWorkspaceIds.effect();

  yield* takeLatestFromSelector(
    selectActiveWorkspaceIds,
    function* ({ payload }: SelectorChannelPayload<string[]>): SagaGenerator<void> {
      const currentIds = new Set(payload);
      const removedIds = previousIds.filter((workspaceId) => !currentIds.has(workspaceId));
      previousIds = payload;
      yield* all(removedIds.map((workspaceId) => put(workspaceUnmounted(workspaceId))));
    },
  );
}
