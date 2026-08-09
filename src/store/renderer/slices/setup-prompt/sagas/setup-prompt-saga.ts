/**
 * Setup Prompt Saga
 *
 * Evaluates whether the ACTIVE backend needs first-run setup — no workspaces
 * and no ready providers — and stores the result in the setup-prompt slice.
 * Runs on boot, on every backend `connected` status (daemon restart /
 * reconnect; a backend switch recreates the window and boots fresh), and
 * after every settled bulk provider check. The evaluation refreshes the
 * workspace list and waits for the bulk provider check to settle so it never
 * decides on unhydrated or stale state.
 */

import { delay, put, race, take, takeLatest } from 'typed-redux-saga';

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
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
  selectActiveConnection,
  selectActiveConnectionId,
} from '../../connections/connections-selectors';
import { selectWorkspaceHasLoaded, selectWorkspaceItems } from '../../workspace/workspace-selectors';
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
 * Re-dispatch cadence while waiting for the first bulk provider check. The
 * availability saga registers its watcher only after an async catalog
 * hydration, so a single `ensureProvidersChecked` dispatched too early can be
 * missed entirely — retrying on a timer guarantees the check eventually runs.
 */
const PROVIDER_CHECK_RETRY_MS = 3_000;

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

  // Wait for the first bulk provider check, re-requesting on a timer in case
  // an earlier dispatch preceded the availability saga's watcher (see
  // PROVIDER_CHECK_RETRY_MS). Safe to repeat: ensureProvidersChecked no-ops
  // once hasCheckedOnce is true and takeLeading dedupes while one is running.
  while (!(yield* selectHasCheckedOnce.effect())) {
    yield* put(ensureProvidersChecked());
    yield* race({
      settled: take(checkAllProvidersComplete),
      retry: delay(PROVIDER_CHECK_RETRY_MS),
    });
  }

  // If a re-check is in flight (e.g. the reconnect-triggered one), give it a
  // bounded window to settle rather than reading the half-updated map.
  // Caveat: the bulk check runs under takeLeading, so a reconnect-triggered
  // request that arrives while a pre-reconnect check is still in flight is
  // dropped — the checkAllProvidersComplete observed here can belong to the
  // STALE check ("settled" does not imply "fresh"). That is acceptable: any
  // check that starts or finishes after we evaluate re-triggers evaluation
  // via the checkAllProvidersComplete watcher in the root saga, so a stale
  // read here is always corrected once fresh results land.
  if (yield* selectIsAnyProviderLoading.effect()) {
    yield* race({
      settled: take(checkAllProvidersComplete),
      timedOut: delay(PROVIDER_CHECK_SETTLE_TIMEOUT_MS),
    });
  }

  const connection = yield* selectActiveConnection.effect();
  const connectionId = yield* selectActiveConnectionId.effect();
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
  yield* put(evaluateSetupStateRequested());
}

export function* setupPromptSaga() {
  yield* takeLatest(evaluateSetupStateRequested, evaluateSetupStateWorker);
  yield* takeEveryFromElectronChannel(IPC_CHANNELS.BACKEND.STATUS, handleBackendStatus);
  // Every settled bulk provider check re-evaluates, so an evaluation that
  // read a pre-reconnect provider map is corrected as soon as the fresh
  // post-reconnect check completes.
  yield* takeLatest(checkAllProvidersComplete, requestReevaluation);
  // Boot-time evaluation: the `connected` broadcast can precede renderer
  // listeners attaching, so don't rely on it for the first run.
  yield* put(evaluateSetupStateRequested());
}
