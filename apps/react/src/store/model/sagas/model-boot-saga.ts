import { buffers, eventChannel } from 'redux-saga';
import { onBackendReconnected } from '@/features/backend/backend-transport';
import { selectCanAdministerHost } from '../../principal/principal-selectors';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { selectModelBootContext } from '../model-selectors';
import { loadModelCatalog } from './model-catalog-request';
import { createModelBootSaga } from '../../../../../../src/store/renderer/slices/model/sagas/model-boot-saga-factory';

/** Settings owner supplies its real client; connection admission drives initial/retry reads. */
export function createReactModelBootSaga(
  settings: Parameters<typeof createModelBootSaga>[0]['settings'],
) {
  return createModelBootSaga({
    settings,
    selectCanAdministerHost,
    selectActiveProviderId,
    selectModelBootContext,
    loadModelCatalog,
    createBackendConnectedChannel: () =>
      eventChannel<{ reconnected: boolean }>(
        (emit) => onBackendReconnected(() => emit({ reconnected: true })),
        buffers.sliding(1),
      ),
  }).modelBootSaga;
}
