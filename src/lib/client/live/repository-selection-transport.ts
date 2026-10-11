import { captureBackendRepositorySelection } from './backend-transport';
import { createRepositorySelectionTransportRuntime } from './repository-selection-transport-runtime';

/** Compatibility binding for existing renderer callers until the Svelte cutover. */
export function createRepositorySelectionTransport(capture = captureBackendRepositorySelection) {
  return createRepositorySelectionTransportRuntime(capture);
}
