import { all, call, cancelled, put, takeEvery } from 'typed-redux-saga';

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  PROVIDER_AVAILABILITY_KEY_TO_ID,
  type ProviderAvailabilityResult,
} from '$shared/types/provider-availability';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { selectHasCheckedOnce, selectProviderCheckEpochMap } from '../agent-availability-selectors';
import {
  checkAllProvidersComplete,
  checkAllProvidersRequested,
  checkSingleProviderFailure,
  checkSingleProviderRequested,
  checkSingleProviderSuccess,
  ensureProvidersChecked,
  setAllProvidersLoading,
  setNpxStatus,
} from '../agent-availability-slice';
import type { ProviderStatus } from '../agent-availability-types';
import { hydrateProviderCatalog } from '../../provider-catalog/sagas/provider-catalog-saga';

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
      return;
    }
    yield* put(checkSingleProviderFailure(providerId, epoch));
  } catch (error) {
    logger.error(`Provider availability check failed for ${providerId}`, { error });
    yield* put(checkSingleProviderFailure(providerId, epoch));
  }
}

export function* checkAllProvidersWorker() {
  const providerIds = Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID);
  yield* put(setAllProvidersLoading(Object.fromEntries(providerIds.map((id) => [id, true]))));

  try {
    try {
      const result: IpcResult<ProviderAvailabilityResult> = yield* call(
        invoke<IpcResult<ProviderAvailabilityResult>>,
        IPC_CHANNELS.PROVIDERS.GET_AVAILABILITY,
      );
      if (result?.success && result.data?.npx) {
        yield* put(setNpxStatus(result.data.npx));
      }
    } catch (error) {
      logger.warn('GET_AVAILABILITY call failed; npx status unavailable', { error });
    }

    yield* all(providerIds.map((providerId) => call(checkSingleProviderWorker, providerId)));
  } finally {
    const wasCancelled = yield* cancelled();
    if (!wasCancelled) yield* put(checkAllProvidersComplete());
  }
}

function* handleCheckAllProvidersRequest(_action: ReturnType<typeof checkAllProvidersRequested>) {
  yield* call(checkAllProvidersWorker);
}

function* handleEnsureProvidersChecked(_action: ReturnType<typeof ensureProvidersChecked>) {
  const hasCheckedOnce = yield* selectHasCheckedOnce.effect();
  if (!hasCheckedOnce) yield* put(checkAllProvidersRequested());
}

function* handleBackendStatus(payload: { status?: string }) {
  if (payload.status !== 'connected') return;
  yield* call(hydrateProviderCatalog);
  yield* put(checkAllProvidersRequested());
}

function* handleSingleProviderRequest(action: ReturnType<typeof checkSingleProviderRequested>) {
  yield* call(checkSingleProviderWorker, action.payload[0]);
}

/** Unregistered until the S20 middleware cutover. */
export function* providerAvailabilitySaga() {
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
  yield* call(hydrateProviderCatalog);
  yield* takeEveryFromElectronChannel(IPC_CHANNELS.BACKEND.STATUS, handleBackendStatus);
}
