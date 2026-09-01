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
  setCollapsed,
  setCollapsiblePanelCollapsed,
  setDiffIndicators,
  setDiffSideBySide,
  setFoldUnchanged,
  setLineWrapping,
  setResizablePanelGroupLayout,
  setResizablePanelSize,
  setSidebarSide,
  toggleDiffIndicators,
  toggleDiffSideBySide,
  toggleFoldUnchanged,
  toggleLineWrapping,
  toggleSidebar,
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

  it('hydrates valid editor options and the collapsed sidebar state on startup', async () => {
    storage.getJSON.mockImplementation((key: string) =>
      key === 'editor-settings'
        ? {
            lineWrapping: false,
            foldUnchanged: false,
            diffSideBySide: false,
            diffIndicators: false,
            futureOption: true,
          }
        : undefined,
    );
    storage.getItem.mockImplementation((key: string) =>
      key === 'workspace-left-panel-collapsed' ? 'true' : null,
    );

    const { dispatched, state, task } = sidebarHarness();
    await settle();

    expect(state()).toMatchObject({
      lineWrapping: false,
      foldUnchanged: false,
      diffSideBySide: false,
      diffIndicators: false,
      sidebarCollapsed: true,
    });
    expect(dispatched).toEqual([
      setLineWrapping(false),
      setFoldUnchanged(false),
      setDiffSideBySide(false),
      setDiffIndicators(false),
      setCollapsed(true),
    ]);
    expect(storage.setJSON).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('rejects non-boolean editor fields and non-exact collapsed values', async () => {
    storage.getJSON.mockImplementation((key: string) =>
      key === 'editor-settings'
        ? {
            lineWrapping: 'false',
            foldUnchanged: 0,
            diffSideBySide: null,
            diffIndicators: 'true',
          }
        : undefined,
    );
    storage.getItem.mockReturnValue('TRUE');

    const { dispatched, state, task } = sidebarHarness();
    await settle();

    expect(state()).toMatchObject({
      lineWrapping: true,
      foldUnchanged: true,
      diffSideBySide: true,
      diffIndicators: true,
      sidebarCollapsed: false,
    });
    expect(dispatched).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('persists every editor set and toggle result while preserving unrelated fields', async () => {
    let editorSettings: Record<string, unknown> = { futureOption: 'keep' };
    storage.getJSON.mockImplementation((key: string) =>
      key === 'editor-settings' ? editorSettings : undefined,
    );
    storage.setJSON.mockImplementation((key: string, value: Record<string, unknown>) => {
      if (key === 'editor-settings') editorSettings = value;
    });
    const { send, task } = sidebarHarness();

    for (const action of [
      setLineWrapping(false),
      setFoldUnchanged(false),
      setDiffSideBySide(false),
      setDiffIndicators(false),
      toggleLineWrapping(),
      toggleFoldUnchanged(),
      toggleDiffSideBySide(),
      toggleDiffIndicators(),
    ]) {
      send(action);
      await settle();
    }

    expect(storage.setJSON.mock.calls.map(([, value]) => value)).toEqual([
      {
        futureOption: 'keep',
        lineWrapping: false,
        foldUnchanged: true,
        diffSideBySide: true,
        diffIndicators: true,
      },
      {
        futureOption: 'keep',
        lineWrapping: false,
        foldUnchanged: false,
        diffSideBySide: true,
        diffIndicators: true,
      },
      {
        futureOption: 'keep',
        lineWrapping: false,
        foldUnchanged: false,
        diffSideBySide: false,
        diffIndicators: true,
      },
      {
        futureOption: 'keep',
        lineWrapping: false,
        foldUnchanged: false,
        diffSideBySide: false,
        diffIndicators: false,
      },
      {
        futureOption: 'keep',
        lineWrapping: true,
        foldUnchanged: false,
        diffSideBySide: false,
        diffIndicators: false,
      },
      {
        futureOption: 'keep',
        lineWrapping: true,
        foldUnchanged: true,
        diffSideBySide: false,
        diffIndicators: false,
      },
      {
        futureOption: 'keep',
        lineWrapping: true,
        foldUnchanged: true,
        diffSideBySide: true,
        diffIndicators: false,
      },
      {
        futureOption: 'keep',
        lineWrapping: true,
        foldUnchanged: true,
        diffSideBySide: true,
        diffIndicators: true,
      },
    ]);
    expect(editorSettings).toEqual({
      futureOption: 'keep',
      lineWrapping: true,
      foldUnchanged: true,
      diffSideBySide: true,
      diffIndicators: true,
    });
    task.cancel();
    await task.toPromise();
  });

  it('persists explicit and toggled collapsed sidebar results', async () => {
    const { send, state, task } = sidebarHarness();

    send(setCollapsed(true));
    await settle();
    send(toggleSidebar());
    await settle();

    expect(state().sidebarCollapsed).toBe(false);
    expect(storage.setItem.mock.calls).toEqual([
      ['workspace-left-panel-collapsed', 'true'],
      ['workspace-left-panel-collapsed', 'false'],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('keeps editor and collapsed sidebar watchers alive after storage failures', async () => {
    let editorReads = 0;
    storage.getJSON.mockImplementation((key: string) => {
      if (key !== 'editor-settings') return undefined;
      if (editorReads++ === 0) throw new Error('unavailable');
      return {};
    });
    storage.getItem.mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    storage.setJSON.mockImplementationOnce(() => {
      throw new Error('full');
    });
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('full');
    });
    const { send, task } = sidebarHarness();

    send(setLineWrapping(false));
    await settle();
    send(toggleLineWrapping());
    await settle();
    send(setCollapsed(true));
    await settle();
    send(toggleSidebar());
    await settle();

    expect(storage.setJSON).toHaveBeenCalledTimes(2);
    expect(storage.setItem.mock.calls).toEqual([
      ['workspace-left-panel-collapsed', 'true'],
      ['workspace-left-panel-collapsed', 'false'],
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
    storage.getItem.mockImplementation((key: string) => {
      if (key === 'first') throw new Error('unavailable');
      if (key === 'second') return '12';
      return null;
    });
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
