/**
 * Setup Prompt Saga
 *
 * Evaluates whether the ACTIVE backend needs first-run setup — no workspaces
 * and no ready providers — and stores the result in the setup-prompt slice.
 * Runs on boot, on every backend `connected` status (daemon restart /
 * reconnect; a backend switch recreates the window and boots fresh), and
 * after every successful bulk provider check. The evaluation refreshes the
 * workspace list and waits for the bulk provider check to settle so it never
 * decides on unhydrated or stale state.
 */

import { delay, put, race, take, takeLatest } from 'typed-redux-saga';

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import {
  selectHasCheckedOnce,
  selectIsAnyProviderLoading,
  selectProviderStatusMap,
} from '../../agent-availability/agent-availability-selectors';
import {
  checkAllProvidersComplete,
  ensureProvidersChecked,
} from '../../agent-availability/agent-availability-slice';
import {
  selectCurrentConnection,
  selectCurrentConnectionId,
} from '../../connections/connections-selectors';
import {
  selectWorkspaceHasLoaded,
  selectWorkspaceItems,
} from '../../workspace/workspace-selectors';
import {
  loadWorkspacesRequested,
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '../../workspace/workspace-slice';
import { evaluateSetupStateRequested, setupEvaluationCompleted } from '../setup-prompt-slice';
import { hasReadyProvider } from '../setup-prompt-utils';

/** Bounded wait for the workspace-list refresh dispatched by the worker. */
const WORKSPACE_REFRESH_TIMEOUT_MS = 15_000;

/**
 * Bounded wait for an in-flight bulk provider re-check to settle before
 * evaluating, so the evaluation doesn't read a half-updated map.
 */
const PROVIDER_CHECK_SETTLE_TIMEOUT_MS = 15_000;

export function* evaluateSetupStateWorker() {
  // Refresh the workspace list so the evaluation reads the connected
  // backend's current state — on reconnect the cached list can predate the
  // disconnect (e.g. workspaces removed while away). The lifecycle read saga
  // single-flights this with any load already running, and either way its
  // completion dispatches replaceWorkspaceList; the timeout only covers a
  // failed read.
  yield* put(loadWorkspacesRequested());
  yield* race({
    refreshed: take(replaceWorkspaceList),
    timedOut: delay(WORKSPACE_REFRESH_TIMEOUT_MS),
  });
  while (!(yield* selectWorkspaceHasLoaded.effect())) {
    yield* take([setWorkspaceHasLoaded, replaceWorkspaceList]);
  }

  // Provider availability registers this ensure watcher before its async
  // catalog hydration, so one request cannot be missed. An all-failed sweep
  // deliberately leaves hasCheckedOnce false: stop without presenting an
  // empty status map as a confirmed setup verdict and wait for reconnect to
  // trigger one fresh check/evaluation instead of polling offline forever.
  if (!(yield* selectHasCheckedOnce.effect())) {
    yield* put(ensureProvidersChecked());
    const { settled } = yield* race({
      settled: take(checkAllProvidersComplete),
      timedOut: delay(PROVIDER_CHECK_SETTLE_TIMEOUT_MS),
    });
    if (!settled || !(yield* selectHasCheckedOnce.effect())) return;
  }

  // If a re-check is in flight (e.g. the reconnect-triggered one), give it a
  // bounded window to settle rather than reading the half-updated map.
  // The provider watcher retains a reconnect-triggered request as one trailing
  // sweep when an older check is still running. Each completion re-triggers a
  // coalesced evaluation, so the final fresh results are always observed.
  if (yield* selectIsAnyProviderLoading.effect()) {
    yield* race({
      settled: take(checkAllProvidersComplete),
      timedOut: delay(PROVIDER_CHECK_SETTLE_TIMEOUT_MS),
    });
  }

  const connection = yield* selectCurrentConnection.effect();
  const connectionId = yield* selectCurrentConnectionId.effect();
  const workspaceCount = (yield* selectWorkspaceItems.effect()).length;
  const statusMap = yield* selectProviderStatusMap.effect();

  yield* put(
    setupEvaluationCompleted({
      connectionId,
      isLocal: connection?.isLocal ?? connectionId === LOCAL_CONNECTION_ID,
      setupNeeded: workspaceCount === 0 && !hasReadyProvider(statusMap),
    }),
  );
}

function* handleBackendStatus(payload: { status?: string }) {
  if (payload.status !== 'connected') return;
  yield* put(evaluateSetupStateRequested());
}

export function* requestReevaluation() {
  // All-failed sweeps leave provider readiness unknown. Reconnect owns the
  // next attempt; do not turn a failed completion into another setup cycle.
  if (!(yield* selectHasCheckedOnce.effect())) return;
  yield* put(evaluateSetupStateRequested());
}

export function* setupPromptSaga() {
  yield* takeSingleFlightInContext(
    evaluateSetupStateRequested,
    () => 'setup-evaluation',
    evaluateSetupStateWorker,
  );
  yield* takeEveryFromElectronChannel(IPC_CHANNELS.BACKEND.STATUS, handleBackendStatus);
  // Every successful bulk provider check re-evaluates, so an evaluation that
  // read a pre-reconnect provider map is corrected as soon as the fresh
  // post-reconnect check completes.
  yield* takeLatest(checkAllProvidersComplete, requestReevaluation);
  // Boot-time evaluation: the `connected` broadcast can precede renderer
  // listeners attaching, so don't rely on it for the first run.
  yield* put(evaluateSetupStateRequested());
}
