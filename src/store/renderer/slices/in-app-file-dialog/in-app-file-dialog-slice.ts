/**
 * in-app-file-dialog slice — open requests for the in-app stand-in of native
 * file dialogs (INTENT_IN_APP_PICKER, Intent OS).
 *
 * Main (src/main/file-dialogs.ts) pushes one request per open/save chooser to
 * the shown renderer; the saga records it here and `InAppFileDialogHost`
 * shows the oldest. Answering dispatches `inAppFileDialogAnswered`, which the
 * saga sends back to main and the reducer drops from the queue.
 */
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  addItem,
  createCollection,
  getItem,
  removeItem,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';

import type { InAppFileDialogRequest } from '$shared/in-app-file-dialog';

export type InAppFileDialogState = {
  /** Open requests in arrival order; the host shows the oldest. */
  requests: Collection<InAppFileDialogRequest, 'id'>;
};

/** @internal */
export const initialState: InAppFileDialogState = {
  requests: createCollection<InAppFileDialogRequest, 'id'>('id'),
};

/** Saga → reducer: main asked for a chooser. */
export const inAppFileDialogRequested = createAction<[request: InAppFileDialogRequest]>(
  'inAppFileDialog/requested',
);

/** Host → saga + reducer: the user chose `paths`, or cancelled (`null`). */
export const inAppFileDialogAnswered = createAction<[id: string, paths: string[] | null]>(
  'inAppFileDialog/answered',
);

export const inAppFileDialogReducer = createReducer<InAppFileDialogState>(initialState);
inAppFileDialogReducer.with(inAppFileDialogRequested, (state, { payload: [request] }) =>
  getItem(state.requests, request.id)
    ? state
    : { ...state, requests: addItem(state.requests, request) },
);
inAppFileDialogReducer.with(inAppFileDialogAnswered, (state, { payload: [id] }) => {
  const requests = removeItem(state.requests, id);
  return requests === state.requests ? state : { ...state, requests };
});
