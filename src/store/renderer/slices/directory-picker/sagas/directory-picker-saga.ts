import type { SagaGenerator } from 'typed-redux-saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import { selectDirectoryPickerListing } from '../directory-picker-selectors';
import { createDirectoryPickerSaga } from './directory-picker-saga-factory';

// Keep the source runtime's named startup API while the Svelte reference exists.
// React injects its own bindings into the same workflow; remove this owner at cutover.
// eslint-disable-next-line themis/pass-through-wrapper -- Preserve the source registry/test startup API until the Svelte renderer is retired at React cutover.
export function* directoryPickerSaga(): SagaGenerator<void> {
  yield* createDirectoryPickerSaga({
    backendRequest,
    listingEffect: selectDirectoryPickerListing.effect,
  })();
}
