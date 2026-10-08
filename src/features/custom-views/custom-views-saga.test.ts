import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import type { StoreAction } from '@themislib/themis/types';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import type { CustomView, CustomViewsSnapshot } from '$shared/types/custom-views';
import { customViewsSaga } from './custom-views-saga';
import {
  customViewFrameClosed,
  customViewFrameOpened,
  customViewFrameStatus,
  customViewsReceived,
  customViewsReducer,
  editCustomView,
  initialCustomViewsState,
  loadCustomViews,
  reloadCustomViewFrame,
  removeCustomView,
  saveCustomView,
  selectCustomView,
  startCustomView,
  stopCustomView,
} from './custom-views-slice';

const platform = vi.hoisted(() => ({ available: true }));
vi.mock('$lib/utils/platform-capabilities', () => ({ hasCapability: () => platform.available }));

const view: CustomView = {
  id: 'efcc1165-5813-4404-b774-2a89c6ee3a98',
  name: 'Dashboard',
  directory: '/tmp/app',
  command: 'npm start',
  port: 3000,
  icon: 'chart',
};
const stopped: CustomViewsSnapshot = {
  views: [view],
  runtimes: [{ id: view.id, status: 'stopped', logs: '' }],
};
const running: CustomViewsSnapshot = {
  views: [view],
  runtimes: [{ id: view.id, status: 'running', url: 'http://127.0.0.1:3000/', logs: 'Ready' }],
};
const tasks: Task[] = [];
const settle = () => vi.advanceTimersByTimeAsync(0);
function setup() {
  let state = initialCustomViewsState;
  const channel = stdChannel();
  const dispatch = (action: StoreAction<unknown>) => {
    state = customViewsReducer(state, action);
    channel.put(action);
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ customViews: state }) },
    customViewsSaga,
  );
  tasks.push(task);
  return { dispatch, state: () => state };
}
function handler(channel: string, data: CustomViewsSnapshot) {
  const fn = vi.fn().mockResolvedValue({ success: true, data });
  registerMockIpcHandler(channel, fn);
  return fn;
}

beforeEach(() => {
  vi.useFakeTimers();
  platform.available = true;
  resetMockIpcRouter();
});
afterEach(() => {
  tasks.splice(0).forEach((task) => task.cancel());
  vi.useRealTimers();
  resetMockIpcRouter();
});

describe('custom view IPC lifecycle', () => {
  it('loads, saves an edit, and removes the selected registration through exact IPC payloads', async () => {
    const list = handler('custom-views:list', stopped);
    const edited = { ...view, name: 'Renamed' };
    const save = handler('custom-views:save', { ...stopped, views: [edited] });
    const remove = handler('custom-views:remove', { views: [], runtimes: [] });
    const h = setup();
    h.dispatch(loadCustomViews());
    await settle();
    expect(list).toHaveBeenCalledWith();
    expect(getItems(h.state().views)).toEqual([view]);
    h.dispatch(editCustomView(view.id));
    h.dispatch(saveCustomView(edited));
    await settle();
    expect(save).toHaveBeenCalledWith(edited);
    expect(getItems(h.state().views)).toEqual([edited]);
    expect(h.state().editorOpen).toBe(false);
    h.dispatch(removeCustomView(view.id));
    await settle();
    expect(remove).toHaveBeenCalledWith({ id: view.id });
    expect(getItems(h.state().views)).toEqual([]);
    expect(h.state().selectedId).toBeNull();
  });

  it('starts on selection once, keeps running on deselection, polls, and stops polling after stop', async () => {
    const start = handler('custom-views:start', running);
    const list = handler('custom-views:list', running);
    const stop = handler('custom-views:stop', stopped);
    const h = setup();
    h.dispatch(customViewsReceived(stopped));
    h.dispatch(selectCustomView(view.id));
    await settle();
    expect(start).toHaveBeenCalledWith({ id: view.id });
    h.dispatch(selectCustomView(null));
    h.dispatch(selectCustomView(view.id));
    await settle();
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(list).toHaveBeenCalledTimes(1);
    h.dispatch(stopCustomView(view.id));
    await settle();
    expect(stop).toHaveBeenCalledWith({ id: view.id });
    await vi.advanceTimersByTimeAsync(4000);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reports a save failure without closing the form and retries successfully', async () => {
    const save = handler('custom-views:save', stopped);
    save.mockResolvedValueOnce({
      success: false,
      error: { code: 'storage-failed', message: 'Disk full' },
    });
    const h = setup();
    h.dispatch(editCustomView(null));
    h.dispatch(saveCustomView(view));
    await settle();
    expect(h.state()).toMatchObject({ editorOpen: true, busy: false, error: 'storage-failed' });
    h.dispatch(saveCustomView(view));
    await settle();
    expect(h.state()).toMatchObject({ editorOpen: false, error: null });
  });

  it('serializes a removal behind a pending poll so the old snapshot cannot resurrect the view', async () => {
    let resolve!: (value: unknown) => void;
    registerMockIpcHandler(
      'custom-views:list',
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const remove = handler('custom-views:remove', { views: [], runtimes: [] });
    const h = setup();
    h.dispatch(loadCustomViews());
    h.dispatch(removeCustomView(view.id));
    await settle();
    expect(remove).not.toHaveBeenCalled();
    resolve({ success: true, data: stopped });
    await settle();
    expect(remove).toHaveBeenCalledWith({ id: view.id });
    expect(getItems(h.state().views)).toEqual([]);
  });

  it('keeps a failed edit visible through runtime polling and clears it on a successful save', async () => {
    const save = handler('custom-views:save', running);
    save.mockResolvedValueOnce({
      success: false,
      error: { code: 'storage-failed', message: 'Disk full' },
    });
    handler('custom-views:list', running);
    const h = setup();
    h.dispatch(customViewsReceived(running));
    h.dispatch(editCustomView(view.id));
    h.dispatch(saveCustomView(view));
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.state()).toMatchObject({ editorOpen: true, error: 'storage-failed' });
    h.dispatch(saveCustomView(view));
    await settle();
    expect(h.state()).toMatchObject({ editorOpen: false, error: null });
  });

  it('clears a failed initial load when the user retries', async () => {
    const list = handler('custom-views:list', stopped);
    list.mockResolvedValueOnce({
      success: false,
      error: { code: 'storage-failed', message: 'Unavailable' },
    });
    const h = setup();
    h.dispatch(loadCustomViews());
    await settle();
    expect(h.state().error).toBe('storage-failed');
    h.dispatch(loadCustomViews());
    await settle();
    expect(h.state().error).toBeNull();
    expect(getItems(h.state().views)).toEqual([view]);
  });

  it('does not invoke native commands on the web', async () => {
    platform.available = false;
    const start = handler('custom-views:start', running);
    const h = setup();
    h.dispatch(startCustomView(view.id));
    await settle();
    expect(start).not.toHaveBeenCalled();
    expect(h.state().error).toBe('desktop-only');
  });

  it('reports transport failure and accepts a later retry', async () => {
    const start = handler('custom-views:start', running);
    start.mockRejectedValueOnce(new Error('Bridge unavailable'));
    const h = setup();
    h.dispatch(startCustomView(view.id));
    await settle();
    expect(h.state().error).toBe('desktop-only');
    h.dispatch(startCustomView(view.id));
    await settle();
    expect(h.state().error).toBeNull();
    expect(getItems(h.state().runtimes)[0].status).toBe('running');
  });

  it('times out a stalled frame, cancels the timer after load, and ignores a closed frame', async () => {
    const h = setup();
    h.dispatch(customViewFrameOpened(view.id));
    await vi.advanceTimersByTimeAsync(15000);
    expect(h.state().frame.status).toBe('slow');
    h.dispatch(reloadCustomViewFrame(view.id));
    h.dispatch(customViewFrameStatus(view.id, h.state().frame.revision, 'loaded'));
    await vi.advanceTimersByTimeAsync(15000);
    expect(h.state().frame.status).toBe('loaded');
    h.dispatch(reloadCustomViewFrame(view.id));
    h.dispatch(customViewFrameClosed(view.id));
    await vi.advanceTimersByTimeAsync(15000);
    expect(h.state().frame.status).toBe('idle');
  });
});
