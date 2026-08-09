/**
 * Setup Prompt Saga
 *
 * Evaluates whether the ACTIVE backend needs first-run setup — no workspaces
 * and no ready providers — and stores the result in the setup-prompt slice.
 * Runs once on boot and again on every backend `connected` status (daemon
 * restart / reconnect; a backend switch recreates the window and boots
 * fresh). The evaluation waits for the workspace list and the bulk provider
 * check to settle so it never decides on unhydrated state.
 */

import { delay, put, race, take, takeLatest } from 'typed-redux-saga';

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import {
  selectHasCheckedOnce,
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
import { replaceWorkspaceList, setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import { evaluateSetupStateRequested, setupEvaluationCompleted } from '../setup-prompt-slice';
import { hasReadyProvider } from '../setup-prompt-utils';

/**
 * Bounded wait for the reconnect-triggered bulk provider re-check to settle
 * before evaluating, so the evaluation doesn't read the pre-reconnect map.
 */
const PROVIDER_CHECK_SETTLE_TIMEOUT_MS = 15_000;

export function* evaluateSetupStateWorker() {
  // Wait for the workspace list to hydrate (the layout dispatches
  // loadWorkspacesRequested on boot).
  while (!(yield* selectWorkspaceHasLoaded.effect())) {
    yield* take([setWorkspaceHasLoaded, replaceWorkspaceList]);
  }

  if (!(yield* selectHasCheckedOnce.effect())) {
    // Boot: make sure a bulk provider check runs (no-op if one is already in
    // flight) and wait for it to settle.
    yield* put(ensureProvidersChecked());
    yield* take(checkAllProvidersComplete);
  } else {
    // Reconnect: the availability saga re-checks providers on the same
    // backend `connected` status that triggered this evaluation. Give that
    // fresh check a bounded window to settle before reading the map.
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

export function* setupPromptSaga() {
  yield* takeLatest(evaluateSetupStateRequested, evaluateSetupStateWorker);
  yield* takeEveryFromElectronChannel(IPC_CHANNELS.BACKEND.STATUS, handleBackendStatus);
  // Boot-time evaluation: the `connected` broadcast can precede renderer
  // listeners attaching, so don't rely on it for the first run.
  yield* put(evaluateSetupStateRequested());
}
