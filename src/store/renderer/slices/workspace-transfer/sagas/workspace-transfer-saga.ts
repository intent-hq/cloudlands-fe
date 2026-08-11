/**
 * Workspace Transfer Saga
 *
 * Fetches the read-only `workspace.transfer.plan` (PROTOCOL §5.1) when the
 * wizard advances to the confirm step. `takeLatest` so a Back → Next cycle
 * cancels the stale fetch instead of racing two responses.
 */

import { all, call, put, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import {
  transferPlanFailed,
  transferPlanLoaded,
  transferPlanRequested,
} from '../workspace-transfer-slice';
import { selectTransferWorkspaceId } from '../workspace-transfer-selectors';
import type { TransferPlanWireResult } from '../workspace-transfer-types';

const logger = createLogger('WorkspaceTransferSaga');

export function* fetchTransferPlan(): SagaGenerator<void> {
  const workspaceId = yield* selectTransferWorkspaceId.effect();
  if (!workspaceId) return;
  try {
    const result = yield* call(backendRequest<TransferPlanWireResult>, 'workspace.transfer.plan', {
      workspaceId,
    });
    yield* put(transferPlanLoaded(result.plan));
  } catch (error) {
    logger.error('workspace.transfer.plan failed', { workspaceId, error });
    yield* put(transferPlanFailed(error instanceof Error ? error.message : String(error)));
  }
}

export function* workspaceTransferSaga(): SagaGenerator<void> {
  yield* all([takeLatest(transferPlanRequested, fetchTransferPlan)]);
}
