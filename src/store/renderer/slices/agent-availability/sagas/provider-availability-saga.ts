import { all, call, cancelled, delay, put, take, takeEvery, takeLatest } from 'typed-redux-saga';
import { buffers, eventChannel } from 'redux-saga';

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { m } from '$shared/paraglide/messages.js';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import { closeTerminalOverlay, openTerminalOverlay } from '../../terminals/terminals-slice';
import { selectWorkspaceTerminalState } from '../../terminals/terminals-selectors';
import {
  PROVIDER_AVAILABILITY_KEY_TO_ID,
  type ProviderAvailabilityResult,
} from '$shared/types/provider-availability';
import {
  takeLatestInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import {
  selectHasCheckedOnce,
  selectProviderCheckEpochMap,
  selectProviderLoadingMap,
  selectIsAnyProviderLoading,
  selectProviderDiscoveryRevision,
  selectProviderModelsRefreshPending,
  selectProviderModelsRefreshRevision,
} from '../agent-availability-selectors';
import {
  checkAllProvidersComplete,
  checkAllProvidersRequested,
  claudeLoginRequested,
  claudeLoginStarted,
  checkSingleProviderFailure,
  checkSingleProviderRequested,
  checkSingleProviderSuccess,
  ensureProvidersChecked,
  setAllProvidersLoading,
  setNpxStatus,
  providerAvailabilityPanelOpened,
  providerAvailabilityPanelClosed,
  providerDiscoveryStarted,
  providerDiscoverySettled,
  providerModelsRefreshHandled,
  providerAvailabilityStopped,
} from '../agent-availability-slice';
import type { ProviderStatus } from '../agent-availability-types';
import { hydrateProviderCatalog } from '../../provider-catalog/sagas/provider-catalog-saga';
import { reloadModelsForProvider } from '../../model/model-slice';
import { providerModelsCacheCleared } from '../../provider-models/provider-models-slice';

const logger = createLogger('ProviderAvailabilitySaga');

interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface SingleProviderResult extends IpcResult<ProviderStatus> {
  providerId?: string;
}

export function* checkSingleProviderWorker(providerId: string) {
  // Snapshot the provider's check generation before the probe: the reducer
  // discards the terminal action when a newer check started meanwhile, so a
  // slow stale probe (e.g. a focus-triggered sweep that started before an
  // install finished) can never overwrite a fresher result.
  const epoch = (yield* selectProviderCheckEpochMap.effect())[providerId] ?? 0;
  try {
    const result: SingleProviderResult = yield* call(
      invoke<SingleProviderResult>,
      IPC_CHANNELS.PROVIDERS.CHECK_SINGLE,
      providerId,
    );
    if (result?.success && result.data) {
      yield* put(checkSingleProviderSuccess(providerId, result.data, epoch));
      const currentEpoch = (yield* selectProviderCheckEpochMap.effect())[providerId] ?? 0;
      return currentEpoch === epoch ? result.data : undefined;
    }
    yield* put(checkSingleProviderFailure(providerId, epoch));
  } catch (error) {
    logger.error(`Provider availability check failed for ${providerId}`, { error });
    yield* put(checkSingleProviderFailure(providerId, epoch));
  } finally {
    if (yield* cancelled()) yield* put(checkSingleProviderFailure(providerId, epoch));
  }
}

function* discoverProviders(silent: boolean) {
  yield* put(providerDiscoveryStarted());
  const revision = yield* selectProviderDiscoveryRevision.effect();
  try {
    const result = yield* call(
      invoke<IpcResult<ProviderAvailabilityResult>>,
      IPC_CHANNELS.PROVIDERS.GET_AVAILABILITY,
    );
    if (!result?.success || !result.data) {
      yield* put(
        providerDiscoverySettled(revision, {
          error: silent ? null : result?.error || m.settings_providers_checkError(),
          failed: true,
        }),
      );
      return false;
    }
    yield* put(
      providerDiscoverySettled(revision, {
        hiddenProviders: result.data.hiddenProviders,
        error: null,
      }),
    );
    if (result.data.npx) yield* put(setNpxStatus(result.data.npx));
    return true;
  } catch (error) {
    yield* put(
      providerDiscoverySettled(revision, {
        error: silent
          ? null
          : error instanceof Error
            ? error.message
            : m.settings_providers_unknownError(),
        failed: true,
      }),
    );
    return false;
  }
}

export function* checkAllProvidersWorker(silent = false) {
  const refreshModels = yield* selectProviderModelsRefreshPending.effect();
  const refreshRevision = yield* selectProviderModelsRefreshRevision.effect();
  const providerIds = Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID);
  yield* put(setAllProvidersLoading(Object.fromEntries(providerIds.map((id) => [id, true]))));

  try {
    const [discovered] = yield* all([
      call(discoverProviders, silent),
      all(providerIds.map((providerId) => call(checkSingleProviderWorker, providerId))),
    ]);
    if (
      discovered &&
      refreshModels &&
      refreshRevision === (yield* selectProviderModelsRefreshRevision.effect())
    ) {
      yield* put(providerModelsRefreshHandled(refreshRevision));
      yield* put(providerModelsCacheCleared());
      yield* put(reloadModelsForProvider());
    }
  } finally {
    const wasCancelled = yield* cancelled();
    if (!wasCancelled) yield* put(checkAllProvidersComplete());
  }
}

function* handleCheckAllProvidersRequest(action: ReturnType<typeof checkAllProvidersRequested>) {
  yield* call(checkAllProvidersWorker, action.payload[1] === true);
}

function* handleEnsureProvidersChecked(_action: ReturnType<typeof ensureProvidersChecked>) {
  const hasCheckedOnce = yield* selectHasCheckedOnce.effect();
  if (!hasCheckedOnce && !(yield* selectIsAnyProviderLoading.effect()))
    yield* put(checkAllProvidersRequested());
}

function* watchPanelRefresh(
  action:
    | ReturnType<typeof providerAvailabilityPanelOpened>
    | ReturnType<typeof providerAvailabilityPanelClosed>,
) {
  if (action.type === providerAvailabilityPanelClosed.type) return;
  const events = eventChannel<boolean>((emit) => {
    const focus = () => emit(true);
    const visibility = () => {
      if (document.visibilityState === 'visible') emit(true);
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, buffers.sliding(1));
  try {
    yield* put(checkAllProvidersRequested());
    while (true) {
      yield* take(events);
      yield* put(checkAllProvidersRequested(false, true));
    }
  } finally {
    events.close();
  }
}

function* handleBackendStatus(payload: { status?: string }) {
  if (payload.status !== 'connected') return;
  yield* call(hydrateProviderCatalog);
  yield* put(checkAllProvidersRequested());
}

function* handleSingleProviderRequest(action: ReturnType<typeof checkSingleProviderRequested>) {
  yield* call(checkSingleProviderWorker, action.payload[0]);
}

export function* openClaudeLoginWorker(action: ReturnType<typeof claudeLoginRequested>) {
  try {
    const result = yield* call(
      invoke<{ ok: boolean; terminalId?: string; error?: string }>,
      IPC_CHANNELS.TERMINAL.CREATE_WITH_COMMAND,
      { workspaceId: ROOT_WORKSPACE_ID, command: 'claude auth login', interactive: true },
    );
    if (!result.ok || !result.terminalId) {
      throw new Error(result.error || m.terminal_adapter_openFailed_error());
    }
    yield* put(openTerminalOverlay(ROOT_WORKSPACE_ID, result.terminalId));
    yield* put(claudeLoginStarted(result.terminalId));
    yield* put(action.success(undefined));
  } catch (cause) {
    yield* put(
      action.failure(
        cause instanceof Error ? cause : new Error(m.terminal_adapter_openFailed_error()),
      ),
    );
  } finally {
    if (yield* cancelled()) {
      yield* put(action.failure(new Error(m.terminal_adapter_openFailed_error())));
    }
  }
}

function* coalesceClaudeLoginRequests(
  launch: { pending?: ReturnType<typeof claudeLoginRequested> },
  action: ReturnType<typeof claudeLoginRequested>,
) {
  if (!launch.pending) {
    launch.pending = action;
    try {
      yield* call(openClaudeLoginWorker, action);
    } finally {
      launch.pending = undefined;
    }
    return;
  }
  const pending = launch.pending;
  try {
    yield* call(() => pending.promise);
    yield* put(action.success(undefined));
  } catch (cause) {
    yield* put(action.failure(cause instanceof Error ? cause : new Error(String(cause))));
  } finally {
    if (yield* cancelled()) {
      yield* put(action.failure(new Error(m.terminal_adapter_openFailed_error())));
    }
  }
}

function* dismissClaudeLoginOnSuccess(action: ReturnType<typeof claudeLoginStarted>) {
  const [terminalId] = action.payload;
  while (true) {
    yield* delay(2000);
    const before = yield* selectWorkspaceTerminalState.effect(ROOT_WORKSPACE_ID);
    if (!before.isOpen || before.activeTerminalId !== terminalId || before.selectedScriptId) return;
    if ((yield* selectProviderLoadingMap.effect())['claude-code']) continue;
    const status = yield* call(checkSingleProviderWorker, 'claude-code');
    if (status?.available && status.authenticated === true) {
      const current = yield* selectWorkspaceTerminalState.effect(ROOT_WORKSPACE_ID);
      if (current.isOpen && current.activeTerminalId === terminalId && !current.selectedScriptId) {
        yield* put(closeTerminalOverlay(ROOT_WORKSPACE_ID));
      }
      return;
    }
  }
}

export function* providerAvailabilitySaga() {
  try {
    // Register request ownership before async catalog hydration so setup's one
    // boot-time ensure cannot be missed. This removes the need for setup polling
    // without initiating an extra sweep from provider availability itself.
    yield* takeEvery(checkSingleProviderRequested, handleSingleProviderRequest);
    yield* takeEvery(claudeLoginRequested, coalesceClaudeLoginRequests, {});
    yield* takeLatest(claudeLoginStarted, dismissClaudeLoginOnSuccess);
    yield* takeEvery(ensureProvidersChecked, handleEnsureProvidersChecked);
    yield* takeSingleFlightInContext(
      checkAllProvidersRequested,
      () => 'all-providers',
      handleCheckAllProvidersRequest,
    );
    yield* takeLatestInContext(
      [providerAvailabilityPanelOpened, providerAvailabilityPanelClosed],
      (action) => action.payload[0],
      watchPanelRefresh,
    );
    yield* call(hydrateProviderCatalog);
    yield* takeEveryFromElectronChannel(IPC_CHANNELS.BACKEND.STATUS, handleBackendStatus);
    // Keep this owner alive so root teardown reaches its cleanup block.
    yield* take(providerAvailabilityStopped);
  } finally {
    yield* put(providerAvailabilityStopped());
  }
}
