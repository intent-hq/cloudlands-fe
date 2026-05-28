import type { SagaName } from '../types';
import {
  startSaga,
  stopSaga,
} from '../slices/saga-manager/saga-manager-slice';
import type { ReduxStore } from '../types';

/**
 * Start a saga by dispatching startSaga and return a cleanup function that dispatches stopSaga.
 * Used by both initStore (to start all sagas synchronously) and RunSaga.svelte.
 */
export function runSaga(store: ReduxStore, sagaName: SagaName): () => void {
  store.dispatch(startSaga(sagaName));
  return () => {
    store.dispatch(stopSaga(sagaName));
  };
}

