import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  getItems,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';

export interface PdfPreview {
  id: string;
  requestId: string;
  workspaceId: string;
  status: 'loading' | 'ready' | 'error';
  url: string | null;
  error: 'missing' | 'large' | 'load' | null;
}
export const initialState = { previews: createCollection<PdfPreview, 'id'>('id') };
export const pdfPreviewRequested =
  createAction<
    [
      viewId: string,
      requestId: string,
      workspaceId: string,
      path: string,
      options?: { gitRootId?: string; mimeType?: string },
    ]
  >('pdfPreview/requested');
export const pdfPreviewReleased =
  createAction<[viewId: string, requestId: string]>('pdfPreview/released');
export const pdfPreviewReady =
  createAction<[viewId: string, requestId: string, url: string]>('pdfPreview/ready');
export const pdfPreviewFailed =
  createAction<[viewId: string, requestId: string, error: NonNullable<PdfPreview['error']>]>(
    'pdfPreview/failed',
  );
export const pdfPreviewReducer = createReducer(initialState);
pdfPreviewReducer.with(pdfPreviewRequested, (state, { payload: [id, requestId, workspaceId] }) => ({
  previews: upsertItem(state.previews, {
    id,
    requestId,
    workspaceId,
    status: 'loading',
    url: null,
    error: null,
  }),
}));
pdfPreviewReducer.with(pdfPreviewReady, (state, { payload: [id, requestId, url] }) => {
  const entry = getItem(state.previews, id);
  return entry?.requestId === requestId
    ? { previews: upsertItem(state.previews, { ...entry, status: 'ready', url }) }
    : state;
});
pdfPreviewReducer.with(pdfPreviewFailed, (state, { payload: [id, requestId, error] }) => {
  const entry = getItem(state.previews, id);
  return entry?.requestId === requestId
    ? { previews: upsertItem(state.previews, { ...entry, status: 'error', error, url: null }) }
    : state;
});
pdfPreviewReducer.with(pdfPreviewReleased, (state, { payload: [id, requestId] }) =>
  getItem(state.previews, id)?.requestId === requestId
    ? { previews: removeItem(state.previews, id) }
    : state,
);
pdfPreviewReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) => ({
  previews: getItems(state.previews)
    .filter((entry) => entry.workspaceId === workspaceId)
    .reduce((previews, entry) => removeItem(previews, entry.id), state.previews),
}));
