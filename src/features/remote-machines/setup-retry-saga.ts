/**
 * Retry setup on a remote agent's setup-failed card: one `agent.retrySetup`
 * per agent at a time, pending under `setupRetryKey(agentId)`. After the
 * reply the key stays set until `agent:updated` moves the agent's setup out
 * of `failed` (the session is never patched here), so the button does not
 * come back in between. A refusal or a reconnect clears it; a refusal toasts
 * the daemon's message.
 */
import { call, delay, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  remoteMachineOperationSettled,
  remoteMachineOperationStarted,
  remoteSetupRetryRequested,
  setupRetryKey,
} from './remote-machines-slice';
import { notifySetupRetryRefused, retryRemoteSetup } from './setup-retry';

/** Give up waiting for `agent:updated` after this long, so the button cannot stay held. */
const SETUP_UPDATE_WAIT_MS = 60_000;

const setupStillFailed = (agentId: string) =>
  store.state.agentSessions?.byAgentId[agentId]?.setup?.state === 'failed';

function* retrySetup(action: ReturnType<typeof remoteSetupRetryRequested>): SagaGenerator<void> {
  const [{ workspaceId, agentId, machine }] = action.payload;
  const key = setupRetryKey(agentId);
  if (store.state.remoteMachines.pending[key]) return;
  yield* put(remoteMachineOperationStarted(key, 'retrying-setup'));
  try {
    const outcome = yield* call(retryRemoteSetup, { workspaceId, agentId });
    if (!outcome.ok) {
      yield* call(notifySetupRetryRefused, machine, outcome);
      return;
    }
    if (setupStillFailed(agentId))
      yield* race({
        reconnected: take(backendReconnected),
        // Saga takes see the state after the reducer ran.
        changed: take(() => !setupStillFailed(agentId)),
        timeout: delay(SETUP_UPDATE_WAIT_MS),
      });
  } finally {
    yield* put(remoteMachineOperationSettled(key, null));
  }
}

export function* setupRetrySaga(): SagaGenerator<void> {
  yield* takeEvery(remoteSetupRetryRequested, retrySetup);
}
