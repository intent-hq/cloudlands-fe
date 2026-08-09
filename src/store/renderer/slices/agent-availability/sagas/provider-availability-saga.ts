import { all, call, cancelled, put, takeEvery, takeLeading } from 'typed-redux-saga';

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  PROVIDER_AVAILABILITY_KEY_TO_ID,
  type ProviderAvailabilityResult,
} from '$shared/types/provider-availability';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { selectHasCheckedOnce } from '../agent-availability-selectors';
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
  try {
    const result: SingleProviderResult = yield* call(
      invoke<SingleProviderResult>,
      IPC_CHANNELS.PROVIDERS.CHECK_SINGLE,
      providerId,
    );
    if (result?.success && result.data) {
      yield* put(checkSingleProviderSuccess(providerId, result.data));
      return;
    }
    yield* put(checkSingleProviderFailure(providerId));
  } catch (error) {
    logger.error(`Provider availability check failed for ${providerId}`, { error });
    yield* put(checkSingleProviderFailure(providerId));
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

export function* handleBulkProviderRequest(
  action: ReturnType<typeof ensureProvidersChecked> | ReturnType<typeof checkAllProvidersRequested>,
) {
  if (action.type === ensureProvidersChecked.type) {
    const hasCheckedOnce = yield* selectHasCheckedOnce.effect();
    if (hasCheckedOnce) return;
  }
  yield* call(checkAllProvidersWorker);
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
  yield* call(hydrateProviderCatalog);
  yield* takeEveryFromElectronChannel(IPC_CHANNELS.BACKEND.STATUS, handleBackendStatus);
  yield* takeEvery(checkSingleProviderRequested, handleSingleProviderRequest);
  yield* takeLeading(
    [ensureProvidersChecked, checkAllProvidersRequested],
    handleBulkProviderRequest,
  );
}
