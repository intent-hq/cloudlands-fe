import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  initialState,
  videoPreviewReducer as reduce,
  videoPreviewRequested as request,
  videoPreviewReady as ready,
  videoPreviewFailed as failed,
  videoPreviewReleased as release,
} from './video-preview-slice';

describe('video preview state', () => {
  it('tracks conversion outcomes without storing binary data', () => {
    expect(getItems(initialState.previews)).toEqual([]);
    const loading = reduce(initialState, request('view', 'ws', 'workspace-file://ws/a.mp4'));
    expect(getItem(loading.previews, 'view')).toMatchObject({ status: 'loading', url: null });
    const loaded = reduce(loading, ready('view', 'blob:one'));
    expect(getItem(loaded.previews, 'view')).toMatchObject({ status: 'ready', url: 'blob:one' });
    const failure = reduce(loading, failed('view', 'unsupported'));
    expect(getItem(failure.previews, 'view')).toMatchObject({
      status: 'error',
      error: 'unsupported',
    });
    expect(JSON.parse(JSON.stringify(failure))).toEqual(failure);
  });

  it('ignores late outcomes from a closed view', () => {
    const loading = reduce(initialState, request('old', 'ws', 'workspace-file://ws/a.mp4'));
    const released = reduce(loading, release('old'));
    expect(getItems(released.previews)).toEqual([]);
    expect(reduce(released, ready('old', 'blob:old'))).toBe(released);
    expect(reduce(released, failed('old', 'network'))).toBe(released);
  });

  it('clears only the unmounted workspace', () => {
    let state = reduce(initialState, request('one', 'ws1', 'workspace-file://ws1/a.mp4'));
    state = reduce(state, request('two', 'ws2', 'workspace-file://ws2/a.mp4'));
    expect(
      getItems(reduce(state, workspaceUnmounted('ws1')).previews).map((entry) => entry.id),
    ).toEqual(['two']);
  });
});
