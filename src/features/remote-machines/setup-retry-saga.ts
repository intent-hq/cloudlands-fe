/**
 * Retry setup on a remote agent's setup-failed card: one `agent.retrySetup`
 * per agent at a time, pending under `setupRetryKey(agentId)`. After the
 * reply the key stays set until `agent:updated` shows the new run (the
 * session is never patched here), so the button does not come back in
 * between. The new run is told apart from the failed one by its `startedAt`,
 * so a retry that fails fast, or whose `running` state is never seen,
 * releases at once in whichever order the reply and the update arrive. A
 * refusal, a reconnect or a fallback timeout also clears it; a refusal
 * toasts the daemon's message.
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

const storedSetup = (agentId: string) => store.state.agentSessions?.byAgentId[agentId]?.setup;

/**
 * The session shows a run other than the failed one the retry started from:
 * setup left `failed`, or its `startedAt` differs from the pre-request one or
 * equals the reply's (any state, a new failure included).
 */
function newRunObserved(
  agentId: string,
  run: { before: string | undefined; acknowledged: string | undefined },
): boolean {
  const setup = storedSetup(agentId);
  if (setup?.state !== 'failed') return true;
  if (setup.startedAt === undefined) return false;
  return setup.startedAt !== run.before || setup.startedAt === run.acknowledged;
}

function* retrySetup(action: ReturnType<typeof remoteSetupRetryRequested>): SagaGenerator<void> {
  const [{ workspaceId, agentId, machine }] = action.payload;
  const key = setupRetryKey(agentId);
  if (store.state.remoteMachines.pending[key]) return;
  // The failed run the retry starts from; a later `startedAt` is the new run.
  const before = storedSetup(agentId)?.startedAt;
  yield* put(remoteMachineOperationStarted(key, 'retrying-setup'));
  try {
    const outcome = yield* call(retryRemoteSetup, { workspaceId, agentId });
    if (!outcome.ok) {
      yield* call(notifySetupRetryRefused, machine, outcome);
      return;
    }
    const run = { before, acknowledged: outcome.setup?.startedAt };
    // The new run may already be stored, even finished, when the reply lands.
    if (!newRunObserved(agentId, run))
      yield* race({
        reconnected: take(backendReconnected),
        // Saga takes see the state after the reducer ran.
        changed: take(() => newRunObserved(agentId, run)),
        timeout: delay(SETUP_UPDATE_WAIT_MS),
      });
  } finally {
    yield* put(remoteMachineOperationSettled(key, null));
  }
}

export function* setupRetrySaga(): SagaGenerator<void> {
  yield* takeEvery(remoteSetupRetryRequested, retrySetup);
}
