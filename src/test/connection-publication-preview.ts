import { put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
import { selfPublicationRequested } from '$store/renderer/slices/connections/connections-slice';

/** Layout previews have no daemon/keychain and deliberately omit production sagas. */
export function setupUnavailablePublicationPreview(): () => void {
  return store.runSaga(function* (): SagaGenerator<void> {
    yield* takeEvery(selfPublicationRequested, function* (action) {
      yield* put(
        action.failure(new Error('Self publication is unavailable in the layout preview')),
      );
    });
  });
}
