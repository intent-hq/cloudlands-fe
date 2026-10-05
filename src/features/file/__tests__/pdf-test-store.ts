import { runSaga, stdChannel } from 'redux-saga';
import { createAppStoreMock } from '$store/renderer/utils/test-helpers/store-mock';
import {
  pdfPreviewReducer,
  initialState,
} from '$store/renderer/slices/pdf-preview/pdf-preview-slice';

/** Runs the production PDF reducer and saga for lifecycle tests. */
export function createPdfTestStore() {
  let state = { pdfPreview: initialState };
  const channel = stdChannel();
  const store = createAppStoreMock({
    state: () => state,
    dedupeEmits: true,
    dispatch(action: { type: string }) {
      state = { pdfPreview: pdfPreviewReducer(state.pdfPreview, action as never) };
      channel.put(action);
      store.emitState();
      return action;
    },
  });
  return Object.assign(store, {
    init() {
      state = { pdfPreview: initialState };
    },
    runSaga(saga: () => Generator) {
      const task = runSaga({ channel, dispatch: store.dispatch, getState: () => state }, saga);
      return () => task.cancel();
    },
  });
}
