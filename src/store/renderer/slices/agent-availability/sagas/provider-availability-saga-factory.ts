import { all, call, cancelled, put, race, take, takeEvery } from 'typed-redux-saga';
import { buffers, eventChannel } from 'redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  PROVIDER_AVAILABILITY_KEY_TO_ID,
  type ProviderAvailabilityResult,
} from '$shared/types/provider-availability';
import {
  takeLatestInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import {
  checkAllProvidersComplete,
  checkAllProvidersRequested,
  checkSingleProviderFailure,
  checkSingleProviderRequested,
  checkSingleProviderSuccess,
  ensureProvidersChecked,
  prepareOnboardingAdaptersRequested,
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
import { hostExecutionConnectionChanged } from '../../host-execution/host-execution-slice';
import { reloadModelsForProvider } from '../../model/model-slice';
import { providerModelsCacheCleared } from '../../provider-models/provider-models-slice';
import type * as projections0 from '../../principal/principal-projections';
import type * as projections1 from '../agent-availability-projections';

import type { ReadSelector, ProviderReadState } from '../../provider-catalog/provider-read-types';

export function createProviderAvailabilitySaga<State extends ProviderReadState>({
  selectPrincipalConnectionContext,
  selectHostRole,
  selectHasCheckedOnce,
  selectProviderCheckEpochMap,
  selectIsAnyProviderLoading,
  selectProviderDiscoveryRevision,
  selectProviderModelsRefreshPending,
  selectProviderModelsRefreshRevision,
  readSingleProvider,
  readAvailability,
  authLifetime,
}: {
  selectPrincipalConnectionContext: ReadSelector<
    typeof projections0.getPrincipalConnectionContext,
    State
  >;
  selectHostRole: ReadSelector<typeof projections0.getHostRole, State>;
  selectHasCheckedOnce: ReadSelector<typeof projections1.getHasCheckedOnce, State>;
  selectProviderCheckEpochMap: ReadSelector<typeof projections1.getProviderCheckEpochMap, State>;
  selectIsAnyProviderLoading: ReadSelector<typeof projections1.getIsAnyProviderLoading, State>;
  selectProviderDiscoveryRevision: ReadSelector<
    typeof projections1.getProviderDiscoveryRevision,
    State
  >;
  selectProviderModelsRefreshPending: ReadSelector<
    typeof projections1.getProviderModelsRefreshPending,
    State
  >;
  selectProviderModelsRefreshRevision: ReadSelector<
    typeof projections1.getProviderModelsRefreshRevision,
    State
  >;
  readSingleProvider: (
    id: string,
  ) => Promise<{ success: boolean; data?: ProviderStatus; error?: string }>;
  readAvailability: () => Promise<{
    success: boolean;
    data?: ProviderAvailabilityResult;
    error?: string;
  }>;
  authLifetime: { start: () => void; dispose: () => void };
}) {
  const logger = createLogger('ProviderAvailabilitySaga');

  interface IpcResult<T> {
    success: boolean;
    data?: T;
    error?: string;
  }

  interface SingleProviderResult extends IpcResult<ProviderStatus> {
    providerId?: string;
  }

  function* checkSingleProviderWorker(providerId: string) {
    // Snapshot the provider's check generation before the probe: the reducer
    // discards the terminal action when a newer check started meanwhile, so a
    // slow stale probe (e.g. a focus-triggered sweep that started before an
    // install finished) can never overwrite a fresher result.
    const connection = yield* selectPrincipalConnectionContext.effect();
    const role = yield* selectHostRole.effect();
    const epoch = (yield* selectProviderCheckEpochMap.effect())[providerId] ?? 0;
    if (!connection || (role !== 'owner' && role !== 'member')) {
      // A request can precede admission; settle its spinner without claiming a probe ran.
      yield* put(checkSingleProviderFailure(providerId, epoch));
      return;
    }
    try {
      const result: SingleProviderResult = yield* call(readSingleProvider, providerId);
      if (connection !== (yield* selectPrincipalConnectionContext.effect())) return;
      if (result?.success && result.data) {
        yield* put(checkSingleProviderSuccess(providerId, result.data, epoch));
        const currentEpoch = (yield* selectProviderCheckEpochMap.effect())[providerId] ?? 0;
        return currentEpoch === epoch ? result.data : undefined;
      }
      yield* put(checkSingleProviderFailure(providerId, epoch));
    } catch (error) {
      if (connection !== (yield* selectPrincipalConnectionContext.effect())) return;
      logger.error(`Provider availability check failed for ${providerId}`, { error });
      yield* put(checkSingleProviderFailure(providerId, epoch));
    } finally {
      if (yield* cancelled()) yield* put(checkSingleProviderFailure(providerId, epoch));
    }
  }

  function* discoverProviders(silent: boolean) {
    const connection = yield* selectPrincipalConnectionContext.effect();
    yield* put(providerDiscoveryStarted());
    const revision = yield* selectProviderDiscoveryRevision.effect();
    try {
      const result = yield* call(readAvailability);
      if (connection !== (yield* selectPrincipalConnectionContext.effect())) return false;
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
      if (connection !== (yield* selectPrincipalConnectionContext.effect())) return false;
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

  function* checkAllProvidersWorker(silent = false) {
    const connection = yield* selectPrincipalConnectionContext.effect();
    const role = yield* selectHostRole.effect();
    // Static catalog hydration is allowed before admission; host probes are not.
    // The authority owner retries discovery when owner/member admission arrives.
    if (!connection || (role !== 'owner' && role !== 'member')) return;
    yield* put(prepareOnboardingAdaptersRequested());
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
      if (!wasCancelled && connection === (yield* selectPrincipalConnectionContext.effect()))
        yield* put(checkAllProvidersComplete());
    }
  }

  function* handleCheckAllProvidersRequest(action: ReturnType<typeof checkAllProvidersRequested>) {
    yield* race({
      checked: call(checkAllProvidersWorker, action.payload[1] === true),
      changed: take(hostExecutionConnectionChanged),
    });
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

  function* handleSingleProviderRequest(action: ReturnType<typeof checkSingleProviderRequested>) {
    const role = yield* selectHostRole.effect();
    if (
      (role === 'owner' || role === 'member') &&
      (yield* selectPrincipalConnectionContext.effect())
    )
      yield* put(prepareOnboardingAdaptersRequested());
    yield* call(checkSingleProviderWorker, action.payload[0]);
  }

  function* providerAvailabilityReadSaga() {
    authLifetime.start();
    try {
      // Register request ownership before async catalog hydration so setup's one
      // boot-time ensure cannot be missed. This removes the need for setup polling
      // without initiating an extra sweep from provider availability itself.
      yield* takeEvery(checkSingleProviderRequested, handleSingleProviderRequest);
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
      // Keep this owner alive so root teardown reaches its cleanup block.
      yield* take(providerAvailabilityStopped);
    } finally {
      authLifetime.dispose();
      yield* put(providerAvailabilityStopped());
    }
  }

  return { checkSingleProviderWorker, checkAllProvidersWorker, providerAvailabilityReadSaga };
}
