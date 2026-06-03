/**
 * Agent Availability Saga
 *
 * Handles IPC calls for provider availability checks, terminal event
 * listeners for install tracking, and polling fallback.
 */

import {
  call,
  delay,
  fork,
  put,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { invoke } from '$lib/electron-bridge';
import {
  CODEX_CHANNELS,
  PROVIDERS_CHANNELS,
} from '$shared/ipc/channels';
import { ACP_PROVIDERS } from '$shared/config/provider-config';
import { createLogger } from '$lib/utils/client-logger';
import { takeEveryFromElectronChannel } from '$store/renderer/utils/ipc-channel';
import type { ManagedInstallStatus, ProviderStatus } from '../agent-availability-types';
import {
  checkSingleProviderRequested,
  checkSingleProviderSuccess,
  checkSingleProviderFailure,
  checkAllProvidersRequested,
  checkAllProvidersComplete,
  setAllProvidersLoading,
  fetchProviderUserInfoRequested,
  fetchProviderUserInfoSuccess,
  fetchProviderUserInfoComplete,
  trackInstallTerminal,
  removeWatchedTerminal,
  ensureProvidersChecked,
  setManagedInstallStatus,
} from '../agent-availability-slice';
import {
  selectHasCheckedOnce,
  selectIsAnyProviderLoading,
  selectWatchedTerminalIds,
  selectProviderStatusMap,
} from '../agent-availability-selectors';

const logger = createLogger('agent-availability-saga');

type CheckSingleResult = {
  success: boolean;
  providerId: string;
  data?: ProviderStatus;
  error?: string;
};

type ManagedInstallStatusResult = {
  success: boolean;
  data?: ManagedInstallStatus;
  error?: string;
};

export function* handleCodexManagedInstallStatusEvent(
  status: ManagedInstallStatus,
): SagaGenerator<void> {
  yield* put(setManagedInstallStatus('codex', status));
}

export function* hydrateCodexManagedInstallStatus(): SagaGenerator<void> {
  try {
    const result: ManagedInstallStatusResult = yield* call(
      invoke<ManagedInstallStatusResult>,
      CODEX_CHANNELS.MANAGED_INSTALL_STATUS,
    );
    if (result.success && result.data) {
      yield* put(setManagedInstallStatus('codex', result.data));
    }
  } catch (err) {
    logger.debug('Failed to hydrate Codex managed install status', { error: (err as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Single provider check
// ---------------------------------------------------------------------------

function* handleCheckSingleProvider(
  action: ReturnType<typeof checkSingleProviderRequested>,
): SagaGenerator<void> {
  const [providerId] = action.payload;
  try {
    const result: CheckSingleResult = yield* call(
      invoke<CheckSingleResult>,
      PROVIDERS_CHANNELS.CHECK_SINGLE,
      providerId,
    );
    if (result.success && result.data) {
      yield* put(checkSingleProviderSuccess(providerId, result.data));
    } else {
      yield* put(checkSingleProviderFailure(providerId));
    }
  } catch (err) {
    logger.error(`Failed to check provider ${providerId}`, err as Error);
    yield* put(checkSingleProviderFailure(providerId));
  }
}

// ---------------------------------------------------------------------------
// Check all providers
// ---------------------------------------------------------------------------

function* handleCheckAllProviders(): SagaGenerator<void> {
  const providerIds = Object.values(ACP_PROVIDERS).map((p) => p.id);
  const loadingInit: Record<string, boolean> = {};
  for (const id of providerIds) loadingInit[id] = true;
  yield* put(setAllProvidersLoading(loadingInit));

  // Check each provider sequentially via dispatched actions so the reducer
  // tracks individual loading states. We dispatch and wait for completion
  // by checking each one inline here.
  for (const id of providerIds) {
    try {
      const result: CheckSingleResult = yield* call(
        invoke<CheckSingleResult>,
        PROVIDERS_CHANNELS.CHECK_SINGLE,
        id,
      );
      if (result.success && result.data) {
        yield* put(checkSingleProviderSuccess(id, result.data));
      } else {
        yield* put(checkSingleProviderFailure(id));
      }
    } catch (err) {
      logger.error(`Failed to check provider ${id}`, err as Error);
      yield* put(checkSingleProviderFailure(id));
    }
  }
  yield* put(checkAllProvidersComplete());
}

// ---------------------------------------------------------------------------
// Fetch provider user info
// ---------------------------------------------------------------------------

export function* handleFetchProviderUserInfo(
  action: ReturnType<typeof fetchProviderUserInfoRequested>,
): SagaGenerator<void> {
  const [providerId] = action.payload;

  try {
    const result: CheckSingleResult = yield* call(
      invoke<CheckSingleResult>,
      PROVIDERS_CHANNELS.CHECK_SINGLE,
      providerId,
    );
    if (!result.success || !result.data) return;
    const statusMap = yield* selectProviderStatusMap.effect();
    if (!statusMap[providerId]) return;
    yield* put(fetchProviderUserInfoSuccess(providerId, result.data));
  } catch (err) {
    logger.error(`Failed to fetch user info for ${providerId}`, err as Error);
  } finally {
    yield* put(fetchProviderUserInfoComplete(providerId));
  }
}


// ---------------------------------------------------------------------------
// Terminal event listeners
// ---------------------------------------------------------------------------

const COMMAND_FINISHED = 'terminal:professional:command:finished' as const;
const TERMINAL_EXIT = 'terminal:professional:exit' as const;

function* watchTerminalCommandFinished(): Generator {
  yield* takeEveryFromElectronChannel<{ terminalId?: string }>(
    COMMAND_FINISHED,
    function* (data) {
      const terminalId = data?.terminalId;
      if (!terminalId) return;
      logger.debug('Auto-refreshing providers after terminal command finished', { terminalId });
      yield* put(checkAllProvidersRequested());
    },
  );
}

function* watchTerminalExit(): Generator {
  yield* takeEveryFromElectronChannel<{ terminalId?: string }>(
    TERMINAL_EXIT,
    function* (data) {
      const terminalId = data?.terminalId;
      if (!terminalId) return;
      const watchedIds = yield* selectWatchedTerminalIds.effect();
      if (watchedIds.includes(terminalId)) {
        yield* put(removeWatchedTerminal(terminalId));
      }
      logger.debug('Auto-refreshing providers after terminal exited', { terminalId });
      yield* put(checkAllProvidersRequested());
    },
  );
}

function* watchCodexManagedInstallStatus(): Generator {
  yield* takeEveryFromElectronChannel<ManagedInstallStatus>(
    CODEX_CHANNELS.MANAGED_INSTALL_STATUS,
    handleCodexManagedInstallStatusEvent,
  );
  yield* takeEveryFromElectronChannel<ManagedInstallStatus>(
    CODEX_CHANNELS.MANAGED_INSTALL_PROGRESS,
    handleCodexManagedInstallStatusEvent,
  );
}

// ---------------------------------------------------------------------------
// Polling — when install terminals are being watched, poll every 5s (max 5 min)
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_DURATION_MS = 5 * 60_000;

function* providerPollingSaga(): SagaGenerator<void> {
  yield* takeEvery(trackInstallTerminal, function* () {
    const watchedIds = yield* selectWatchedTerminalIds.effect();
    if (watchedIds.length === 0) return;

    const startedAt = Date.now();
    while (true) {
      yield* delay(POLL_INTERVAL_MS);
      const currentIds = yield* selectWatchedTerminalIds.effect();
      if (currentIds.length === 0) return;
      if (Date.now() - startedAt > POLL_MAX_DURATION_MS) {
        logger.debug('Provider install poll duration cap reached — stopping');
        return;
      }
      yield* put(checkAllProvidersRequested());
    }
  });
}

// ---------------------------------------------------------------------------
// Ensure providers checked once
// ---------------------------------------------------------------------------

function* handleEnsureProvidersChecked(): SagaGenerator<void> {
  const hasChecked = yield* selectHasCheckedOnce.effect();
  const isLoading = yield* selectIsAnyProviderLoading.effect();
  if (hasChecked || isLoading) return;
  yield* put(checkAllProvidersRequested());
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* agentAvailabilitySaga(): SagaGenerator<void> {
  yield* fork(hydrateCodexManagedInstallStatus);
  yield* fork(watchTerminalCommandFinished);
  yield* fork(watchTerminalExit);
  yield* fork(watchCodexManagedInstallStatus);
  yield* fork(providerPollingSaga);
  yield* takeEvery(checkSingleProviderRequested, handleCheckSingleProvider);
  yield* takeEvery(checkAllProvidersRequested, handleCheckAllProviders);
  yield* takeEvery(fetchProviderUserInfoRequested, handleFetchProviderUserInfo);
  yield* takeEvery(ensureProvidersChecked, handleEnsureProvidersChecked);
}