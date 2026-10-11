import type { SagaGenerator } from 'typed-redux-saga';
import { backendRequest } from '@/features/backend/backend-transport';
import { selectDirectoryPickerListing } from '../directory-picker-selectors';
import { createDirectoryPickerSaga } from '../../../../../../src/store/renderer/slices/directory-picker/sagas/directory-picker-saga-factory';

/** Bind the canonical workflow to this renderer without importing the Svelte Store. */
export function* directoryPickerSaga(): SagaGenerator<void> {
  yield* createDirectoryPickerSaga({
    backendRequest,
    listingEffect: selectDirectoryPickerListing.effect,
  })();
}
