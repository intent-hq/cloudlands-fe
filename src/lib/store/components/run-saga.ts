import type { SagaName } from '../types';
import { registeredAppStore } from '../saga-registration';

/**
 * Start a saga through the configured package Store and return its cleanup function.
 * Used by RunSaga.svelte for mount-scoped saga lifetimes.
 */
export function runSaga(sagaName: SagaName): () => void {
  return registeredAppStore.runSaga(sagaName);
}

