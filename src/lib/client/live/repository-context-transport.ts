import { captureBackendRepositoryRoute } from './backend-transport';
import { createRepositoryContextTransportRuntime } from './repository-context-transport-runtime';

/** Compatibility binding for existing renderer callers until the Svelte cutover. */
export function createRepositoryContextTransport(captureRoute = captureBackendRepositoryRoute) {
  return createRepositoryContextTransportRuntime(captureRoute);
}
