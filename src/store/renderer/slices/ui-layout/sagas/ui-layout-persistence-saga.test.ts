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
  setSidebarSide,
  toggleSidebarSide,
  uiLayoutReducer,
} from '../ui-layout-slice';
import { uiLayoutPersistenceSaga } from './ui-layout-persistence-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function sidebarHarness() {
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  let state = uiLayoutReducer(undefined, { type: '@@INIT' });
  const send = (action: Parameters<typeof uiLayoutReducer>[1]) => {
    state = uiLayoutReducer(state, action);
    channel.put(action);
  };
  const task = runSaga(
    {
      channel,
      dispatch: (action) => {
        dispatched.push(action);
        send(action);
        return action;
      },
      getState: () => ({ uiLayout: state }),
    },
    uiLayoutPersistenceSaga,
  );
  return { dispatched, send, state: () => state, task };
}

describe('uiLayoutPersistenceSaga', () => {
  beforeEach(() => vi.resetAllMocks());

  it('hydrates a valid stored sidebar side on startup without rewriting settings', async () => {
    storage.getJSON.mockImplementation((key: string) =>
      key === 'layout-settings' ? { sidebarSide: 'right', spacesSidebarWidth: 248 } : undefined,
    );

    const { dispatched, state, task } = sidebarHarness();
    await settle();

    expect(state().sidebarSide).toBe('right');
    expect(dispatched).toEqual([setSidebarSide('right')]);
    expect(storage.setJSON).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('persists explicit side changes without overwriting unrelated layout settings', async () => {
    let settings: Record<string, unknown> = {
      spacesSidebarWidth: 248,
      spacesSidebarCollapsed: true,
      tabbedSidebarPinned: false,
    };
    storage.getJSON.mockImplementation((key: string) =>
      key === 'layout-settings' ? settings : undefined,
    );
    storage.setJSON.mockImplementation((_key: string, value: Record<string, unknown>) => {
      settings = value;
    });
    const { send, task } = sidebarHarness();

    send(setSidebarSide('right'));
    await settle();
    send(setSidebarSide('left'));
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      ['layout-settings', { ...settings, sidebarSide: 'right' }],
      ['layout-settings', { ...settings, sidebarSide: 'left' }],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('persists the reducer result after each sidebar toggle', async () => {
    storage.getJSON.mockReturnValue({ spacesSidebarWidth: 248 });
    const { send, state, task } = sidebarHarness();

    send(toggleSidebarSide());
    await settle();
    expect(state().sidebarSide).toBe('right');

    send(toggleSidebarSide());
    await settle();
    expect(state().sidebarSide).toBe('left');
    expect(storage.setJSON.mock.calls).toEqual([
      ['layout-settings', { spacesSidebarWidth: 248, sidebarSide: 'right' }],
      ['layout-settings', { spacesSidebarWidth: 248, sidebarSide: 'left' }],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it.each([undefined, null, 'bad', [], {}, { sidebarSide: 'middle' }])(
    'keeps the default sidebar side for malformed stored settings: %j',
    async (stored) => {
      storage.getJSON.mockReturnValue(stored);
      const { dispatched, state, task } = sidebarHarness();
      await settle();

      expect(state().sidebarSide).toBe('left');
      expect(dispatched).toEqual([]);
      task.cancel();
      await task.toPromise();
    },
  );

  it('keeps sidebar watchers alive after hydration and write storage failures', async () => {
    storage.getJSON
      .mockImplementationOnce(() => {
        throw new Error('unavailable');
      })
      .mockReturnValue({ spacesSidebarWidth: 248 });
    storage.setJSON.mockImplementationOnce(() => {
      throw new Error('full');
    });
    const { send, state, task } = sidebarHarness();

    expect(state().sidebarSide).toBe('left');
    send(setSidebarSide('right'));
    await settle();
    send(toggleSidebarSide());
    await settle();

    expect(state().sidebarSide).toBe('left');
    expect(storage.setJSON.mock.calls).toEqual([
      ['layout-settings', { spacesSidebarWidth: 248, sidebarSide: 'right' }],
      ['layout-settings', { spacesSidebarWidth: 248, sidebarSide: 'left' }],
    ]);
    task.cancel();
    await task.toPromise();
  });

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
      hydrateResizablePanelSize('bad-size', undefined),
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
    expect(storage.setJSON.mock.calls).toEqual([['group', { sizes: [25, 75], collapsed: [] }]]);
    task.cancel();
    await task.toPromise();
  });

  it('survives a storage failure, ignores malformed actions, and cancels cleanly', async () => {
    storage.getItem
      .mockImplementationOnce(() => {
        throw new Error('unavailable');
      })
      .mockReturnValueOnce('12');
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch }, uiLayoutPersistenceSaga);
    channel.put(requestResizablePanelSize('first'));
    channel.put({ type: requestResizablePanelSize.type, payload: [] });
    channel.put(requestResizablePanelSize('second'));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      hydrateResizablePanelSize('first', undefined),
      hydrateResizablePanelSize('second', 12),
    ]);
    task.cancel();
    await task.toPromise();
    expect(task.isCancelled()).toBe(true);
  });
});
