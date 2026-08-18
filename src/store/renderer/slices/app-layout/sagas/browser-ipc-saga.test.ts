import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isElectron: vi.fn(() => true),
  invoke: vi.fn(() => Promise.resolve()),
  storage: new Map<string, unknown>(),
}));
vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron, invoke: mocks.invoke }));
// Transitive imports of the panel-layout saga (pulled in for on-demand
// hydration, monorepo#2789) that must not drag in the real app store / IPC;
// storage is Map-backed because the global localStorage mock always
// returns null.
vi.mock('$features/layout/panel-layout-adapter', () => ({
  clearPanelLayoutAdapter: vi.fn(),
}));
vi.mock('$features/layout/panel-layout-history.client', () => ({
  loadPanelLayoutHistory: vi.fn(),
  savePanelLayoutHistory: vi.fn(),
}));
vi.mock('../../../utils/safe-local-storage-saga', () => ({
  // A stored Error simulates a throwing restore path (hydration failure).
  getLocalStorageJSON: function* (key: string) {
    const value = mocks.storage.get(key);
    if (value instanceof Error) throw value;
    return value;
  },
  setLocalStorageJSON: function* (key: string, value: unknown) {
    mocks.storage.set(key, value);
  },
  removeLocalStorageItem: function* (key: string) {
    mocks.storage.delete(key);
  },
}));

import { PANEL_LAYOUT_STORAGE_KEY_PREFIX } from '../../panel-layout/panel-layout-types';
import { panelLayoutReducer } from '../../panel-layout/panel-layout-slice';
import { browserIpcSaga } from './browser-ipc-saga';

const NOW = new Date('2026-07-31T00:00:00.000Z').getTime();
const TAB = (url: string) => ({
  type: 'browser',
  title: 'Browser',
  browserUrl: url,
  closable: true,
});
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const persistedLayout = (tabs: unknown[]) => ({
  root: { type: 'panel', panelId: 'panel-1' },
  panels: { 'panel-1': { id: 'panel-1', tabs, activeTabId: null } },
  focusedPanelId: 'panel-1',
  canvasWidth: null,
  canvasWidthSource: null,
});

describe('browserIpcSaga', () => {
  let handlers: Record<string, (payload: unknown) => void>;
  let on: ReturnType<typeof vi.fn>;
  let offById: ReturnType<typeof vi.fn>;
  let state: any;

  const start = (dispatch: (action: unknown) => void = vi.fn()) =>
    runSaga({ dispatch, getState: () => state }, browserIpcSaga);
  const emit = async (payload: unknown, channel = 'browser:open-tab') => {
    handlers[channel](payload);
    await settle();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    handlers = {};
    on = vi.fn((channel: string, next: (payload: unknown) => void) => {
      handlers[channel] = next;
      return `${channel}-listener`;
    });
    offById = vi.fn();
    window.electronAPI = { ...window.electronAPI, on, offById };
    state = { panelLayout: { byWorkspaceId: {} }, tabState: { workspaceStacks: [] } };
    mocks.isElectron.mockReturnValue(true);
  });

  afterEach(() => {
    delete (window as Partial<Window>).electronAPI;
    mocks.storage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('prevents duplicate starts, then removes and reinstalls the listeners around cancellation', async () => {
    const first = start();
    const duplicate = start();
    await duplicate.toPromise();
    expect(on.mock.calls).toEqual([
      ['browser:open-tab', handlers['browser:open-tab']],
      ['browser:close-tab', handlers['browser:close-tab']],
      ['browser:focus-tab', handlers['browser:focus-tab']],
      ['browser:list-tabs-request', handlers['browser:list-tabs-request']],
    ]);

    first.cancel();
    await first.toPromise();
    expect(offById.mock.calls).toEqual([
      ['browser:open-tab', 'browser:open-tab-listener'],
      ['browser:close-tab', 'browser:close-tab-listener'],
      ['browser:focus-tab', 'browser:focus-tab-listener'],
      ['browser:list-tabs-request', 'browser:list-tabs-request-listener'],
    ]);

    const restarted = start();
    expect(on).toHaveBeenCalledTimes(8);
    restarted.cancel();
    await restarted.toPromise();
  });

  it('maps every position and replacement branch exactly without leaking wire-only fields', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({ url: 'https://one.test', workspaceId: 'ws-1' });
    await emit({ url: 'https://two.test', position: 'adjacent', workspaceId: 'ws-1' });
    await emit({ url: 'https://three.test', position: 'same', workspaceId: 'ws-1' });
    await emit({ url: 'https://four.test', workspaceId: 'ws-2', workspace_id: 'wire-only' });
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              one: { tabs: [{ id: 'note-1', type: 'note' }] },
              two: { tabs: [{ id: 'browser-1', type: 'browser' }] },
            },
          },
        },
      },
    };
    await emit({ url: 'https://replace.test', position: 'replace', workspaceId: 'ws-1' });
    state = {
      panelLayout: {
        byWorkspaceId: { 'ws-1': { panels: { one: { tabs: [{ id: 'note-1', type: 'note' }] } } } },
      },
    };
    await emit({ url: 'https://new.test', position: 'replace', workspaceId: 'ws-1' });

    expect(actions).toEqual([
      {
        type: 'panelLayout/openTabInAdjacentOrSplit',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://one.test'),
          sourcePanelId: undefined,
          animated: false,
          force: false,
          newTabId: `tab-${NOW}-i`,
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/openTabInAdjacentOrSplit',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://two.test'),
          sourcePanelId: undefined,
          animated: false,
          force: false,
          newTabId: `tab-${NOW}-i`,
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/openTab',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://three.test'),
          panelId: undefined,
          newTabId: `tab-${NOW}-i`,
          force: false,
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/openTabInAdjacentOrSplit',
        payload: {
          wsId: 'ws-2',
          tab: TAB('https://four.test'),
          sourcePanelId: undefined,
          animated: false,
          force: false,
          newTabId: `tab-${NOW}-i`,
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-1', 'browser-1', 'https://replace.test'],
      },
      {
        type: 'panelLayout/setActiveTab',
        payload: { wsId: 'ws-1', tabId: 'browser-1', panelId: undefined, timestamp: NOW },
      },
      {
        type: 'panelLayout/openTab',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://new.test'),
          panelId: undefined,
          newTabId: `tab-${NOW}-i`,
          force: false,
          timestamp: NOW,
        },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('uses the main-provided tabId and forwards allowDuplicate on every position branch (monorepo#2541)', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({
      url: 'https://one.test',
      workspaceId: 'ws-1',
      tabId: 'tab-main-1',
      allowDuplicate: true,
    });
    await emit({
      url: 'https://two.test',
      position: 'same',
      workspaceId: 'ws-1',
      tabId: 'tab-main-2',
      allowDuplicate: true,
    });
    await emit({
      url: 'https://three.test',
      position: 'replace',
      workspaceId: 'ws-1',
      tabId: 'tab-main-3',
    });

    expect(actions).toEqual([
      {
        type: 'panelLayout/openTabInAdjacentOrSplit',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://one.test'),
          sourcePanelId: undefined,
          animated: false,
          force: false,
          allowDuplicate: true,
          newTabId: 'tab-main-1',
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/openTab',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://two.test'),
          panelId: undefined,
          newTabId: 'tab-main-2',
          force: false,
          timestamp: NOW,
          allowDuplicate: true,
        },
      },
      {
        type: 'panelLayout/openTab',
        payload: {
          wsId: 'ws-1',
          tab: TAB('https://three.test'),
          panelId: undefined,
          newTabId: 'tab-main-3',
          force: false,
          timestamp: NOW,
        },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('no-ops for invalid payloads and when neither workspace source is available', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    await emit({});
    await emit({ url: 7 });
    state = { panelLayout: { byWorkspaceId: {} } };
    await emit({ url: 'https://ignored.test' });
    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('closes a closable browser tab via browser:close-tab (monorepo#1931)', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-2': {
            panels: {
              one: { tabs: [{ id: 'browser-1', type: 'browser', closable: true }] },
            },
          },
        },
      },
    };

    await emit({ tabId: 'browser-1', workspaceId: 'ws-2' }, 'browser:close-tab');

    expect(actions).toEqual([
      {
        type: 'panelLayout/closeTab',
        payload: { wsId: 'ws-2', tabId: 'browser-1', panelId: undefined, timestamp: NOW },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('rejects browser:close-tab when workspaceId is missing', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              one: { tabs: [{ id: 'browser-1', type: 'browser', closable: true }] },
            },
          },
        },
      },
    };

    await emit({ tabId: 'browser-1' }, 'browser:close-tab');

    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores browser:close-tab for missing, non-browser, or non-closable tabs and bad payloads', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              one: {
                tabs: [
                  { id: 'note-1', type: 'note', closable: true },
                  { id: 'browser-pinned', type: 'browser', closable: false },
                ],
              },
            },
          },
        },
      },
    };

    await emit({}, 'browser:close-tab');
    await emit({ tabId: 7 }, 'browser:close-tab');
    await emit({ tabId: 'missing-tab' }, 'browser:close-tab');
    await emit({ tabId: 'note-1' }, 'browser:close-tab');
    await emit({ tabId: 'browser-pinned' }, 'browser:close-tab');
    state = { panelLayout: { byWorkspaceId: {} } };
    await emit({ tabId: 'browser-1' }, 'browser:close-tab');

    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('dispatches focusBrowserTabRequested for the payload workspace, active or not (monorepo#2756)', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({ tabId: 'browser-1', workspaceId: 'ws-background' }, 'browser:focus-tab');

    expect(actions).toEqual([
      {
        type: 'appLayout/focusBrowserTabRequested',
        payload: ['ws-background', 'browser-1'],
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores browser:focus-tab without workspaceId or tabId', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({}, 'browser:focus-tab');
    await emit({ tabId: 'browser-1' }, 'browser:focus-tab');
    await emit({ tabId: 7, workspaceId: 'ws-1' }, 'browser:focus-tab');
    await emit({ workspaceId: 'ws-1' }, 'browser:focus-tab');

    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it("answers a list-tabs request with the requested workspace's browser tabs even when backgrounded", async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-active': {
            panels: { one: { tabs: [{ id: 'browser-x', type: 'browser', browserUrl: 'http://x/' }] } },
          },
          'ws-background': {
            panels: {
              one: {
                tabs: [
                  { id: 'note-1', type: 'note' },
                  {
                    id: 'browser-1',
                    type: 'browser',
                    browserUrl: 'http://a/',
                    title: 'A',
                    closable: true,
                  },
                  { id: 'browser-pinned', type: 'browser', browserUrl: 'http://b/', closable: false },
                ],
              },
            },
          },
        },
      },
    };

    await emit({ workspaceId: 'ws-background', requestId: 'req-1' }, 'browser:list-tabs-request');

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
      requestId: 'req-1',
      tabs: [
        { tabId: 'browser-1', url: 'http://a/', title: 'A', closable: true },
        { tabId: 'browser-pinned', url: 'http://b/', title: 'Browser', closable: false },
      ],
    });
    task.cancel();
    await task.toPromise();
  });

  it('never resolves a requestId for a workspace this window does not host (monorepo#2602)', async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-here': {
            panels: { one: { tabs: [{ id: 'browser-1', type: 'browser', browserUrl: 'http://a/' }] } },
          },
        },
      },
      tabState: { workspaceStacks: [['ws-here']] },
    };

    await emit({ workspaceId: 'ws-elsewhere', requestId: 'req-2' }, 'browser:list-tabs-request');
    await emit({ requestId: 'req-3' }, 'browser:list-tabs-request');

    expect(mocks.invoke).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('answers concurrent list requests for two workspaces with their own tabs and requestIds', async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-a': {
            panels: {
              one: { tabs: [{ id: 'tab-a', type: 'browser', browserUrl: 'http://a/', title: 'A' }] },
            },
          },
          'ws-b': {
            panels: {
              one: { tabs: [{ id: 'tab-b', type: 'browser', browserUrl: 'http://b/', title: 'B' }] },
            },
          },
        },
      },
    };

    await emit({ workspaceId: 'ws-a', requestId: 'req-a' }, 'browser:list-tabs-request');
    await emit({ workspaceId: 'ws-b', requestId: 'req-b' }, 'browser:list-tabs-request');

    expect(mocks.invoke.mock.calls).toEqual([
      [
        'browser:list-tabs-response',
        { requestId: 'req-a', tabs: [{ tabId: 'tab-a', url: 'http://a/', title: 'A', closable: true }] },
      ],
      [
        'browser:list-tabs-response',
        { requestId: 'req-b', tabs: [{ tabId: 'tab-b', url: 'http://b/', title: 'B', closable: true }] },
      ],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('replies with an empty tab list for a held workspace with no browser tabs', async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': { panels: { one: { tabs: [{ id: 'note-1', type: 'note' }] } } },
        },
      },
    };

    await emit({ workspaceId: 'ws-1', requestId: 'req-4' }, 'browser:list-tabs-request');

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
      requestId: 'req-4',
      tabs: [],
    });
    task.cancel();
    await task.toPromise();
  });

  describe('background hydration for hosted-but-unvisited workspaces (monorepo#2789)', () => {
    const startWithReducer = () => {
      const actions: unknown[] = [];
      const task = start((action: any) => {
        actions.push(action);
        state = { ...state, panelLayout: panelLayoutReducer(state.panelLayout, action) };
      });
      return { actions, task };
    };
    const hostedState = (wsId: string) => {
      state = { panelLayout: { byWorkspaceId: {} }, tabState: { workspaceStacks: [[wsId]] } };
    };
    const seedStorage = (wsId: string, tabs: unknown[]) => {
      mocks.storage.set(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${wsId}`, persistedLayout(tabs));
    };

    it('hydrates the persisted layout and answers listTabs for a hosted-but-unvisited workspace', async () => {
      const { task } = startWithReducer();
      hostedState('ws-hyd-1');
      seedStorage('ws-hyd-1', [
        { id: 'note-1', type: 'note', title: 'Note' },
        { id: 'browser-1', type: 'browser', title: 'A', browserUrl: 'http://a/', closable: true },
      ]);

      await emit({ workspaceId: 'ws-hyd-1', requestId: 'req-h1' }, 'browser:list-tabs-request');

      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
        requestId: 'req-h1',
        tabs: [{ tabId: 'browser-1', url: 'http://a/', title: 'A', closable: true }],
      });
      task.cancel();
      await task.toPromise();
    });

    it('answers with an empty-but-truthful tab list when nothing is stored for a hosted workspace', async () => {
      const { task } = startWithReducer();
      hostedState('ws-hyd-2');

      await emit({ workspaceId: 'ws-hyd-2', requestId: 'req-h2' }, 'browser:list-tabs-request');

      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
        requestId: 'req-h2',
        tabs: [],
      });
      task.cancel();
      await task.toPromise();
    });

    it('hydrates at most once for back-to-back requests (idempotent double-hydration)', async () => {
      const { actions, task } = startWithReducer();
      hostedState('ws-hyd-3');
      seedStorage('ws-hyd-3', [
        { id: 'browser-1', type: 'browser', title: 'A', browserUrl: 'http://a/', closable: true },
      ]);

      await emit({ workspaceId: 'ws-hyd-3', requestId: 'req-h3a' }, 'browser:list-tabs-request');
      await emit({ workspaceId: 'ws-hyd-3', requestId: 'req-h3b' }, 'browser:list-tabs-request');

      const restores = actions.filter(
        (action: any) => action.type === 'panelLayout/initializeLayout',
      );
      expect(restores).toHaveLength(1);
      expect(mocks.invoke.mock.calls.map(([, payload]: any[]) => payload)).toEqual([
        {
          requestId: 'req-h3a',
          tabs: [{ tabId: 'browser-1', url: 'http://a/', title: 'A', closable: true }],
        },
        {
          requestId: 'req-h3b',
          tabs: [{ tabId: 'browser-1', url: 'http://a/', title: 'A', closable: true }],
        },
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('closes a tab in a hosted-but-unvisited workspace after hydrating it', async () => {
      const { actions, task } = startWithReducer();
      hostedState('ws-hyd-4');
      seedStorage('ws-hyd-4', [
        { id: 'browser-1', type: 'browser', title: 'A', browserUrl: 'http://a/', closable: true },
      ]);

      await emit({ tabId: 'browser-1', workspaceId: 'ws-hyd-4' }, 'browser:close-tab');

      expect(actions).toContainEqual(
        expect.objectContaining({
          type: 'panelLayout/closeTab',
          payload: expect.objectContaining({ wsId: 'ws-hyd-4', tabId: 'browser-1' }),
        }),
      );
      task.cancel();
      await task.toPromise();
    });

    it('stays silent for a workspace neither hydrated nor in this window tab bar', async () => {
      const { actions, task } = startWithReducer();
      hostedState('ws-hyd-5');

      await emit({ workspaceId: 'ws-not-here', requestId: 'req-h5' }, 'browser:list-tabs-request');

      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(actions).toEqual([]);
      task.cancel();
      await task.toPromise();
    });

    it('opens with position "replace" against the hydrated layout, reusing the persisted browser tab', async () => {
      const { actions, task } = startWithReducer();
      hostedState('ws-hyd-6');
      seedStorage('ws-hyd-6', [
        { id: 'browser-1', type: 'browser', title: 'A', browserUrl: 'http://a/', closable: true },
      ]);

      await emit(
        { url: 'http://replaced/', position: 'replace', workspaceId: 'ws-hyd-6' },
        'browser:open-tab',
      );

      expect(actions).toContainEqual({
        type: 'panelLayout/updateTabBrowserUrl',
        payload: ['ws-hyd-6', 'browser-1', 'http://replaced/'],
      });
      expect(actions).toContainEqual(
        expect.objectContaining({
          type: 'panelLayout/setActiveTab',
          payload: expect.objectContaining({ wsId: 'ws-hyd-6', tabId: 'browser-1' }),
        }),
      );
      expect(actions.map((action: any) => action.type)).not.toContain('panelLayout/openTab');
      task.cancel();
      await task.toPromise();
    });

    it('replies with a truthful hydration error instead of tabs when the restore throws', async () => {
      const { task } = startWithReducer();
      hostedState('ws-hyd-err-1');
      mocks.storage.set(
        `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-hyd-err-1`,
        new Error('storage exploded'),
      );

      await emit({ workspaceId: 'ws-hyd-err-1', requestId: 'req-e1' }, 'browser:list-tabs-request');

      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('browser:list-tabs-response', {
        requestId: 'req-e1',
        error: 'layout hydration failed: storage exploded',
      });
      task.cancel();
      await task.toPromise();
    });

    it('retries hydration on the next request after a failed one instead of answering empty', async () => {
      const { task } = startWithReducer();
      hostedState('ws-hyd-err-2');
      const key = `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-hyd-err-2`;
      mocks.storage.set(key, new Error('storage exploded'));

      await emit({ workspaceId: 'ws-hyd-err-2', requestId: 'req-e2a' }, 'browser:list-tabs-request');
      mocks.storage.set(
        key,
        persistedLayout([
          { id: 'browser-1', type: 'browser', title: 'A', browserUrl: 'http://a/', closable: true },
        ]),
      );
      await emit({ workspaceId: 'ws-hyd-err-2', requestId: 'req-e2b' }, 'browser:list-tabs-request');

      expect(mocks.invoke.mock.calls.map(([, payload]: any[]) => payload)).toEqual([
        { requestId: 'req-e2a', error: 'layout hydration failed: storage exploded' },
        {
          requestId: 'req-e2b',
          tabs: [{ tabId: 'browser-1', url: 'http://a/', title: 'A', closable: true }],
        },
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('survives a hydration failure in close/focus handlers and keeps servicing requests', async () => {
      const { actions, task } = startWithReducer();
      hostedState('ws-hyd-err-3');
      mocks.storage.set(
        `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-hyd-err-3`,
        new Error('storage exploded'),
      );

      await emit({ tabId: 'browser-1', workspaceId: 'ws-hyd-err-3' }, 'browser:close-tab');
      expect(actions.map((action: any) => action.type)).not.toContain('panelLayout/closeTab');

      await emit({ tabId: 'browser-1', workspaceId: 'ws-hyd-err-3' }, 'browser:focus-tab');
      expect(actions).toContainEqual({
        type: 'appLayout/focusBrowserTabRequested',
        payload: ['ws-hyd-err-3', 'browser-1'],
      });

      // The saga is still alive: a later healthy request is answered.
      state = {
        ...state,
        tabState: { workspaceStacks: [['ws-hyd-err-3', 'ws-hyd-ok']] },
      };
      seedStorage('ws-hyd-ok', [
        { id: 'browser-2', type: 'browser', title: 'B', browserUrl: 'http://b/', closable: true },
      ]);
      await emit({ workspaceId: 'ws-hyd-ok', requestId: 'req-ok' }, 'browser:list-tabs-request');
      expect(mocks.invoke).toHaveBeenCalledWith('browser:list-tabs-response', {
        requestId: 'req-ok',
        tabs: [{ tabId: 'browser-2', url: 'http://b/', title: 'B', closable: true }],
      });
      task.cancel();
      await task.toPromise();
    });
  });

  it('does not subscribe outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);
    await start().toPromise();
    expect(on.mock.calls).toEqual([]);
  });
});
