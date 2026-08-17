import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isElectron: vi.fn(() => true),
  invoke: vi.fn(() => Promise.resolve()),
}));
vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron, invoke: mocks.invoke }));

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
};

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
    state = { panelLayout: { byWorkspaceId: {} } };
    mocks.isElectron.mockReturnValue(true);
  });

  afterEach(() => {
    delete (window as Partial<Window>).electronAPI;
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

  it('never resolves a requestId for a workspace this window does not hold (monorepo#2602)', async () => {
    const task = start();
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-here': {
            panels: { one: { tabs: [{ id: 'browser-1', type: 'browser', browserUrl: 'http://a/' }] } },
          },
        },
      },
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

  it('does not subscribe outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);
    await start().toPromise();
    expect(on.mock.calls).toEqual([]);
  });
});
