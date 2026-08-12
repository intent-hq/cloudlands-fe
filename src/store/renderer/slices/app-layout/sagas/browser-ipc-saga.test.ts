import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isElectron: vi.fn(() => true) }));
vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron }));

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
    state = { workspace: { activeWorkspaceId: 'ws-1' }, panelLayout: { byWorkspaceId: {} } };
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
    ]);

    first.cancel();
    await first.toPromise();
    expect(offById.mock.calls).toEqual([
      ['browser:open-tab', 'browser:open-tab-listener'],
      ['browser:close-tab', 'browser:close-tab-listener'],
    ]);

    const restarted = start();
    expect(on).toHaveBeenCalledTimes(4);
    restarted.cancel();
    await restarted.toPromise();
  });

  it('maps every position and replacement branch exactly without leaking wire-only fields', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit({ url: 'https://one.test' });
    await emit({ url: 'https://two.test', position: 'adjacent' });
    await emit({ url: 'https://three.test', position: 'same' });
    await emit({ url: 'https://four.test', workspaceId: 'ws-2', workspace_id: 'wire-only' });
    state = {
      workspace: { activeWorkspaceId: 'ws-1' },
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
    await emit({ url: 'https://replace.test', position: 'replace' });
    state = {
      workspace: { activeWorkspaceId: 'ws-1' },
      panelLayout: {
        byWorkspaceId: { 'ws-1': { panels: { one: { tabs: [{ id: 'note-1', type: 'note' }] } } } },
      },
    };
    await emit({ url: 'https://new.test', position: 'replace' });

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

  it('no-ops for invalid payloads and when neither workspace source is available', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    await emit({});
    await emit({ url: 7 });
    state = { workspace: { activeWorkspaceId: null }, panelLayout: { byWorkspaceId: {} } };
    await emit({ url: 'https://ignored.test' });
    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('closes a closable browser tab via browser:close-tab (monorepo#1931)', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      workspace: { activeWorkspaceId: 'ws-1' },
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

  it('falls back to the active workspace when browser:close-tab has no workspaceId', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      workspace: { activeWorkspaceId: 'ws-1' },
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

    expect(actions).toEqual([
      {
        type: 'panelLayout/closeTab',
        payload: { wsId: 'ws-1', tabId: 'browser-1', panelId: undefined, timestamp: NOW },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores browser:close-tab for missing, non-browser, or non-closable tabs and bad payloads', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    state = {
      workspace: { activeWorkspaceId: 'ws-1' },
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
    state = { workspace: { activeWorkspaceId: null }, panelLayout: { byWorkspaceId: {} } };
    await emit({ tabId: 'browser-1' }, 'browser:close-tab');

    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('does not subscribe outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);
    await start().toPromise();
    expect(on.mock.calls).toEqual([]);
  });
});
