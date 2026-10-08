import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createCollection, getItem } from '@themislib/themis/utils/collections/collection-utils';
import type {
  CustomViewErrorCode,
  CustomViewInput,
  CustomViewsSnapshot,
} from '$shared/types/custom-views';
import type { CustomViewsState } from './custom-views-types';

export const initialCustomViewsState: CustomViewsState = {
  views: createCollection('id', []),
  runtimes: createCollection('id', []),
  loaded: false,
  busy: false,
  error: null,
  errorFromMutation: false,
  selectedId: null,
  editorOpen: false,
  editingId: null,
  frame: { id: null, revision: 0, status: 'idle' },
};

export const loadCustomViews = createAction('customViews/load');
export const saveCustomView = createAction<[input: CustomViewInput]>('customViews/save');
export const removeCustomView = createAction<[id: string]>('customViews/remove');
export const startCustomView = createAction<[id: string]>('customViews/start');
export const stopCustomView = createAction<[id: string]>('customViews/stop');
export const selectCustomView = createAction<[id: string | null]>('customViews/select');
export const editCustomView = createAction<[id: string | null]>('customViews/edit');
export const closeCustomViewEditor = createAction('customViews/closeEditor');
export const customViewsRequestStarted = createAction<[mutation: boolean]>(
  'customViews/requestStarted',
);
export const customViewsReceived =
  createAction<[snapshot: CustomViewsSnapshot]>('customViews/received');
export const customViewsRequestFinished = createAction<
  [error: CustomViewErrorCode | null, mutation?: boolean]
>('customViews/requestFinished');
export const customViewFrameOpened = createAction<[id: string]>('customViews/frameOpened');
export const reloadCustomViewFrame = createAction<[id: string]>('customViews/reloadFrame');
export const customViewFrameClosed = createAction<[id: string]>('customViews/frameClosed');
export const customViewFrameStatus =
  createAction<[id: string, revision: number, status: 'loaded' | 'slow' | 'error']>(
    'customViews/frameStatus',
  );

export const customViewsReducer = createReducer<CustomViewsState>(initialCustomViewsState);
customViewsReducer.with(customViewsRequestStarted, (state, { payload: [mutation] }) => ({
  ...state,
  busy: mutation,
  error: mutation ? null : state.error,
}));
customViewsReducer.with(customViewsReceived, (state, { payload: [snapshot] }) => {
  const views = createCollection('id', snapshot.views);
  return {
    ...state,
    views,
    runtimes: createCollection('id', snapshot.runtimes),
    loaded: true,
    selectedId: state.selectedId && getItem(views, state.selectedId) ? state.selectedId : null,
  };
});
customViewsReducer.with(
  customViewsRequestFinished,
  (state, { payload: [error, mutation = true] }) => ({
    ...state,
    busy: false,
    error: !mutation && state.errorFromMutation ? state.error : error,
    errorFromMutation: mutation ? error !== null : state.errorFromMutation,
    loaded: true,
  }),
);
customViewsReducer.with(selectCustomView, (state, { payload: [selectedId] }) => ({
  ...state,
  selectedId,
}));
customViewsReducer.with(editCustomView, (state, { payload: [editingId] }) => ({
  ...state,
  editingId,
  editorOpen: true,
  error: null,
  errorFromMutation: false,
}));
customViewsReducer.with(closeCustomViewEditor, (state) => ({
  ...state,
  editorOpen: false,
  editingId: null,
}));
for (const action of [customViewFrameOpened, reloadCustomViewFrame]) {
  customViewsReducer.with(action, (state, { payload: [id] }) => ({
    ...state,
    frame: { id, revision: state.frame.revision + 1, status: 'loading' },
  }));
}
customViewsReducer.with(customViewFrameClosed, (state, { payload: [id] }) =>
  state.frame.id === id ? { ...state, frame: { ...state.frame, id: null, status: 'idle' } } : state,
);
customViewsReducer.with(customViewFrameStatus, (state, { payload: [id, revision, status] }) =>
  state.frame.id === id && state.frame.revision === revision
    ? { ...state, frame: { ...state.frame, status } }
    : state,
);
