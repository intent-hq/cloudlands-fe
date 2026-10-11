import { prepareBackendNativeReview } from './backend-transport';
import { createNativeReviewTransportRuntime } from './native-review-transport-runtime';

/** Compatibility binding for existing renderer callers until the Svelte cutover. */
export function createNativeReviewTransport(prepare = prepareBackendNativeReview) {
  return createNativeReviewTransportRuntime(prepare);
}
