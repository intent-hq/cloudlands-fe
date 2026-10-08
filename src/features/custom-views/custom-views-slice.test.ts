import { describe, expect, it } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { CustomView } from '$shared/types/custom-views';
import {
  closeCustomViewEditor,
  customViewFrameClosed,
  customViewFrameOpened,
  customViewFrameStatus,
  customViewsReceived,
  customViewsReducer,
  customViewsRequestFinished,
  customViewsRequestStarted,
  editCustomView,
  reloadCustomViewFrame,
  selectCustomView,
} from './custom-views-slice';

const view: CustomView = {
  id: 'efcc1165-5813-4404-b774-2a89c6ee3a98',
  name: 'Dashboard',
  directory: '/tmp/app',
  command: 'npm start',
  port: 3000,
  icon: 'chart',
};

describe('custom view state', () => {
  it('loads registrations and clears selection when a removed view disappears', () => {
    const initial = customViewsReducer(undefined, { type: '@@INIT' });
    expect(initial.loaded).toBe(false);
    expect(getItems(initial.views)).toEqual([]);
    const loaded = customViewsReducer(
      initial,
      customViewsReceived({
        views: [view],
        runtimes: [{ id: view.id, status: 'stopped', logs: '' }],
      }),
    );
    expect(getItems(loaded.views)).toEqual([view]);
    expect(loaded.loaded).toBe(true);
    const selected = customViewsReducer(loaded, selectCustomView(view.id));
    expect(selected.selectedId).toBe(view.id);
    expect(customViewsReducer(selected, selectCustomView(null)).selectedId).toBeNull();
    expect(
      customViewsReducer(selected, customViewsReceived({ views: [view], runtimes: [] })).selectedId,
    ).toBe(view.id);
    expect(
      customViewsReducer(selected, customViewsReceived({ views: [], runtimes: [] })).selectedId,
    ).toBeNull();
  });

  it('keeps an unsuccessful edit open and clears its error when editing again', () => {
    const editing = customViewsReducer(undefined, editCustomView(view.id));
    expect(editing.editorOpen).toBe(true);
    expect(editing.editingId).toBe(view.id);
    const pending = customViewsReducer(editing, customViewsRequestStarted(true));
    expect(pending.busy).toBe(true);
    const failed = customViewsReducer(pending, customViewsRequestFinished('storage-failed'));
    expect(failed).toMatchObject({ busy: false, editorOpen: true, error: 'storage-failed' });
    expect(customViewsReducer(failed, editCustomView(null))).toMatchObject({
      editingId: null,
      error: null,
    });
    expect(customViewsReducer(failed, closeCustomViewEditor())).toMatchObject({
      editorOpen: false,
      editingId: null,
    });
  });

  it('ignores iframe events from an earlier reload or a different view', () => {
    const opened = customViewsReducer(undefined, customViewFrameOpened(view.id));
    expect(opened.frame.status).toBe('loading');
    const loaded = customViewsReducer(
      opened,
      customViewFrameStatus(view.id, opened.frame.revision, 'loaded'),
    );
    expect(loaded.frame.status).toBe('loaded');
    const reloaded = customViewsReducer(loaded, reloadCustomViewFrame(view.id));
    expect(reloaded.frame.status).toBe('loading');
    expect(
      customViewsReducer(reloaded, customViewFrameStatus(view.id, opened.frame.revision, 'loaded')),
    ).toBe(reloaded);
    expect(customViewsReducer(reloaded, customViewFrameClosed('another'))).toBe(reloaded);
    const failed = customViewsReducer(
      reloaded,
      customViewFrameStatus(view.id, reloaded.frame.revision, 'error'),
    );
    expect(failed.frame.status).toBe('error');
    expect(customViewsReducer(failed, customViewFrameClosed(view.id)).frame).toMatchObject({
      id: null,
      status: 'idle',
    });
  });
});
