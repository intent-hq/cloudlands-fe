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

export interface VideoPreview {
  id: string;
  workspaceId: string;
  status: 'loading' | 'ready' | 'error';
  url: string | null;
  error: 'network' | 'unsupported' | null;
}

export const initialState = { previews: createCollection<VideoPreview, 'id'>('id') };
// A view ID identifies one mounted source and is never reused for a different request.
export const videoPreviewRequested =
  createAction<[id: string, workspaceId: string, url: string]>('videoPreview/requested');
export const videoPreviewReleased = createAction<[id: string]>('videoPreview/released');
export const videoPreviewReady = createAction<[id: string, url: string]>('videoPreview/ready');
export const videoPreviewFailed =
  createAction<[id: string, error: NonNullable<VideoPreview['error']>]>('videoPreview/failed');
export const videoPreviewReducer = createReducer(initialState);
videoPreviewReducer.with(videoPreviewRequested, (state, { payload: [id, workspaceId] }) => ({
  previews: upsertItem(state.previews, {
    id,
    workspaceId,
    status: 'loading',
    url: null,
    error: null,
  }),
}));
videoPreviewReducer.with(videoPreviewReady, (state, { payload: [id, url] }) => {
  const entry = getItem(state.previews, id);
  return entry
    ? { previews: upsertItem(state.previews, { ...entry, status: 'ready', url }) }
    : state;
});
videoPreviewReducer.with(videoPreviewFailed, (state, { payload: [id, error] }) => {
  const entry = getItem(state.previews, id);
  return entry
    ? { previews: upsertItem(state.previews, { ...entry, status: 'error', error, url: null }) }
    : state;
});
videoPreviewReducer.with(videoPreviewReleased, (state, { payload: [id] }) => ({
  previews: removeItem(state.previews, id),
}));
videoPreviewReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) => ({
  previews: getItems(state.previews)
    .filter((entry) => entry.workspaceId === workspaceId)
    .reduce((previews, entry) => removeItem(previews, entry.id), state.previews),
}));
