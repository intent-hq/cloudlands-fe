import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  initialState,
  pdfPreviewReducer as reduce,
  pdfPreviewRequested as request,
  pdfPreviewReady as ready,
  pdfPreviewFailed as failed,
  pdfPreviewReleased as release,
} from './pdf-preview-slice';

describe('PDF preview state', () => {
  it('tracks loading, ready and retry without storing document bytes', () => {
    const loading = reduce(initialState, request('view', 'first', 'ws', 'report.pdf'));
    expect(getItem(loading.previews, 'view')).toMatchObject({
      status: 'loading',
      url: null,
      error: null,
    });
    const loaded = reduce(loading, ready('view', 'first', 'blob:one'));
    expect(getItem(loaded.previews, 'view')).toMatchObject({ status: 'ready', url: 'blob:one' });
    const retry = reduce(loaded, request('view', 'second', 'ws', 'report.pdf'));
    expect(getItem(retry.previews, 'view')).toMatchObject({ status: 'loading', url: null });
    const failure = reduce(retry, failed('view', 'second', 'large'));
    expect(getItem(failure.previews, 'view')).toMatchObject({ status: 'error', error: 'large' });
    expect(JSON.parse(JSON.stringify(failure))).toEqual(failure);
  });

  it('ignores stale reads and releases after a view requests another document', () => {
    const state = reduce(initialState, request('view', 'new', 'ws', 'new.pdf'));
    expect(reduce(state, ready('view', 'old', 'blob:old'))).toBe(state);
    expect(reduce(state, failed('view', 'old', 'missing'))).toBe(state);
    expect(reduce(state, release('view', 'old'))).toBe(state);
    expect(getItems(reduce(state, release('view', 'new')).previews)).toEqual([]);
  });

  it('clears only previews belonging to the closed workspace', () => {
    let state = reduce(initialState, request('one', 'r1', 'ws1', 'a.pdf'));
    state = reduce(state, request('two', 'r2', 'ws2', 'b.pdf'));
    state = reduce(state, workspaceUnmounted('ws1'));
    expect(getItems(state.previews).map((entry) => entry.id)).toEqual(['two']);
  });
});
