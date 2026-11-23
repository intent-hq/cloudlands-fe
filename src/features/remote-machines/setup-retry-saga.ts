/**
 * Retry setup on a remote agent's setup-failed card: one `agent.retrySetup`
 * per agent at a time, pending under `setupRetryKey(agentId)`. The run then
 * reports through `agent:updated`; a refusal toasts the daemon's message.
 */
import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import {
  remoteMachineOperationSettled,
  remoteMachineOperationStarted,
  remoteSetupRetryRequested,
  setupRetryKey,
} from './remote-machines-slice';
import { notifySetupRetryRefused, retryRemoteSetup } from './setup-retry';

function* retrySetup(action: ReturnType<typeof remoteSetupRetryRequested>): SagaGenerator<void> {
  const [{ workspaceId, agentId, machine }] = action.payload;
  const key = setupRetryKey(agentId);
  if (store.state.remoteMachines.pending[key]) return;
  yield* put(remoteMachineOperationStarted(key, 'retrying-setup'));
  try {
    const outcome = yield* call(retryRemoteSetup, { workspaceId, agentId });
    if (!outcome.ok) yield* call(notifySetupRetryRefused, machine, outcome);
  } finally {
    yield* put(remoteMachineOperationSettled(key, null));
  }
}

export function* setupRetrySaga(): SagaGenerator<void> {
  yield* takeEvery(remoteSetupRetryRequested, retrySetup);
}
