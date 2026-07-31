import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  getJSON: vi.fn(),
  setItem: vi.fn(),
  setJSON: vi.fn(),
}));

vi.mock('../../../utils/safe-local-storage-saga', () => ({
  getLocalStorageItem: function* (key: string) {
    return storage.getItem(key);
  },
  getLocalStorageJSON: function* (key: string) {
    return storage.getJSON(key);
  },
  setLocalStorageItem: function* (key: string, value: string) {
    storage.setItem(key, value);
  },
  setLocalStorageJSON: function* (key: string, value: unknown) {
    storage.setJSON(key, value);
  },
}));

import {
  hydrateCollapsiblePanelCollapsed,
  hydrateResizablePanelGroupLayout,
  hydrateResizablePanelSize,
  requestCollapsiblePanelCollapsed,
  requestResizablePanelGroupLayout,
  requestResizablePanelSize,
  setCollapsiblePanelCollapsed,
  setResizablePanelGroupLayout,
  setResizablePanelSize,
} from '../ui-layout-slice';
import { uiLayoutPersistenceSaga } from './ui-layout-persistence-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('uiLayoutPersistenceSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hydrates each valid stored shape and ignores malformed or missing values exactly', async () => {
    storage.getItem.mockImplementation((key: string) => {
      if (key === 'size') return '73';
      if (key === 'collapsed') return 'false';
      if (key === 'bad-size') return 'not-a-number';
      return null;
    });
    storage.getJSON.mockImplementation((key: string) =>
      key === 'group' ? { sizes: [30, 70], collapsed: ['left'] } : { sizes: 'bad' },
    );
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch }, uiLayoutPersistenceSaga);

    channel.put(requestResizablePanelSize('size'));
    channel.put(requestResizablePanelSize('bad-size'));
    channel.put(requestResizablePanelGroupLayout('group'));
    channel.put(requestResizablePanelGroupLayout('bad-group'));
    channel.put(requestCollapsiblePanelCollapsed('collapsed'));
    channel.put(requestCollapsiblePanelCollapsed('missing'));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      hydrateResizablePanelSize('size', 73),
      hydrateResizablePanelGroupLayout('group', { sizes: [30, 70], collapsed: ['left'] }),
      hydrateCollapsiblePanelCollapsed('collapsed', false),
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists every set trigger using its exact dynamic key and payload', async () => {
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn() }, uiLayoutPersistenceSaga);
    channel.put(setResizablePanelSize('size', 42));
    channel.put(setResizablePanelGroupLayout('group', { sizes: [25, 75], collapsed: [] }));
    channel.put(setCollapsiblePanelCollapsed('collapsed', true));
    await settle();

    expect(storage.setItem.mock.calls).toEqual([
      ['size', '42'],
      ['collapsed', 'true'],
    ]);
    expect(storage.setJSON.mock.calls).toEqual([
      ['group', { sizes: [25, 75], collapsed: [] }],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('survives a storage failure, ignores malformed actions, and cancels cleanly', async () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('unavailable');
    }).mockReturnValueOnce('12');
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch }, uiLayoutPersistenceSaga);
    channel.put(requestResizablePanelSize('first'));
    channel.put({ type: requestResizablePanelSize.type, payload: [] });
    channel.put(requestResizablePanelSize('second'));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      hydrateResizablePanelSize('second', 12),
    ]);
    task.cancel();
    await task.toPromise();
    expect(task.isCancelled()).toBe(true);
  });
});