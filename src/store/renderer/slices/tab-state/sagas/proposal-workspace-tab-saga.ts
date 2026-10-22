import { call, delay, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import {
  bulkUpdateWorkspaceEntities,
  replaceWorkspaceList,
  setWorkspaceEntity,
} from '../../workspace/workspace-slice';
import { selectIsWorkspaceTabOpen } from '../tab-state-selectors';
import { proposalWorkspaceCreated, restoreWorkspaceTab } from '../tab-state-slice';

/**
 * How long to wait for a proposal-created workspace to reach the workspace
 * list before giving up on its background tab. The bridge's
 * `workspace:created` handler refetches the list for unknown IDs; that
 * single-flight refetch normally lands well inside this window.
 */
export const PROPOSAL_WORKSPACE_TAB_WAIT_MS = 30_000;

const WORKSPACE_ENTITY_ACTIONS = [
  setWorkspaceEntity,
  replaceWorkspaceList,
  bulkUpdateWorkspaceEntities,
];

function* waitForWorkspaceEntity(workspaceId: string): SagaGenerator<void> {
  while (!(yield* selectWorkspaceById.effect(workspaceId))) {
    yield* take(WORKSPACE_ENTITY_ACTIONS);
  }
}

/**
 * Add a proposal-created workspace to the tab strip WITHOUT focusing it, in
 * windows that show the workspace whose conversation proposed it. The tab is
 * added only once the workspace row is loaded: a tab for an unknown ID would
 * be pruned by the workspace-tab reconciliation saga as a ghost.
 */
function* openProposalWorkspaceTab(
  action: ReturnType<typeof proposalWorkspaceCreated>,
): SagaGenerator<void> {
  const [workspaceId, sourceWorkspaceId] = action.payload;
  const sourceTabOpen = yield* selectIsWorkspaceTabOpen.effect(sourceWorkspaceId);
  if (!sourceTabOpen) return;
  const { timedOut } = yield* race({
    loaded: call(waitForWorkspaceEntity, workspaceId),
    timedOut: delay(PROPOSAL_WORKSPACE_TAB_WAIT_MS),
  });
  if (timedOut) return;
  yield* put(restoreWorkspaceTab(workspaceId));
}

export function* proposalWorkspaceTabSaga(): SagaGenerator<void> {
  yield* takeEvery(proposalWorkspaceCreated, openProposalWorkspaceTab);
}
