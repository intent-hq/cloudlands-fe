import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isElectron: vi.fn(() => true),
  isFocusInTerminal: vi.fn(() => false),
  navigateToRoute: vi.fn(async () => undefined),
  navigateToNewWorkspace: vi.fn(async () => undefined),
  dispatchWindowEvent: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron }));
vi.mock('$lib/utils/keyboardShortcuts', () => ({ isFocusInTerminal: mocks.isFocusInTerminal }));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.navigateToRoute }));
vi.mock('$features/new-workspace/route/new-workspace-navigation', () => ({
  navigateToNewWorkspace: mocks.navigateToNewWorkspace,
}));
vi.mock('$lib/utils/window-events', () => ({ dispatchWindowEvent: mocks.dispatchWindowEvent }));
vi.mock('$lib/utils/client-logger', () => ({ createLogger: () => ({ warn: mocks.warn }) }));

import { menuIpcSaga } from './menu-ipc-saga';

const CHANNELS = [
  'navigate',
  'deep-link',
  'menu:new-agent',
  'menu:new-note',
  'menu:new-terminal',
  'menu:new-browser',
  'menu:close-tab',
  'menu:reopen-closed-tab',
  'menu:select-previous-tab',
  'menu:select-next-tab',
  'menu:zoom-in',
  'menu:zoom-out',
  'menu:reset-zoom',
];
const NOW = new Date('2026-07-31T00:00:00.000Z').getTime();
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('menuIpcSaga', () => {
  let handlers: Map<string, (payload: unknown) => void>;
  let on: ReturnType<typeof vi.fn>;
  let offById: ReturnType<typeof vi.fn>;
  let state: any;

  const start = (dispatch: (action: unknown) => void = vi.fn()) =>
    runSaga({ dispatch, getState: () => state }, menuIpcSaga);
  const emit = async (channel: string, payload: unknown = { workspaceId: 'ws-1' }) => {
    handlers.get(channel)?.(payload);
    await settle();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    handlers = new Map();
    on = vi.fn((channel: string, handler: (payload: unknown) => void) => {
      handlers.set(channel, handler);
      return `listener:${channel}`;
    });
    offById = vi.fn();
    window.electronAPI = { ...window.electronAPI, on, offById };
    state = { panelLayout: { byWorkspaceId: {} } };
    mocks.isElectron.mockReturnValue(true);
    mocks.isFocusInTerminal.mockReturnValue(false);
  });

  afterEach(() => {
    delete (window as Partial<Window>).electronAPI;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('subscribes once per channel, rejects a duplicate start, and removes every listener', async () => {
    const first = start();
    const duplicate = start();
    await duplicate.toPromise();
    expect(on.mock.calls.map(([channel]) => channel)).toEqual(CHANNELS);

    first.cancel();
    await first.toPromise();
    expect(offById.mock.calls).toEqual(CHANNELS.map((channel) => [channel, `listener:${channel}`]));

    const restarted = start();
    expect(on).toHaveBeenCalledTimes(CHANNELS.length * 2);
    restarted.cancel();
    await restarted.toPromise();
  });

  it('maps every successful menu command to exact actions in arrival order', async () => {
    const actions: unknown[] = [];
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            focusedPanelId: 'panel-1',
            panels: {
              'panel-1': { activeTabId: 'browser-1', tabs: [{ id: 'browser-1', type: 'browser' }] },
            },
          },
        },
      },
    };
    const task = start((action) => actions.push(action));

    await emit('navigate', '/?create=true');
    await emit('navigate', '/workspace/new');
    await emit('navigate', '/settings');
    for (const channel of CHANNELS.slice(2)) await emit(channel);

    expect(mocks.navigateToRoute.mock.calls).toEqual([['/settings']]);
    expect(mocks.navigateToNewWorkspace).toHaveBeenCalledTimes(2);
    expect(actions).toEqual([
      { type: 'workspaceAgents/createAgentRequested', payload: ['ws-1'] },
      { type: 'noteReadTracking/createNoteRequested', payload: ['ws-1'] },
      { type: 'terminals/createTerminalRequested', payload: ['ws-1'] },
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-1',
          tab: {
            type: 'browser',
            title: 'Browser',
            browserUrl: 'about:blank',
            closable: true,
          },
          newTabId: `tab-${NOW}-i`,
          force: false,
          timestamp: NOW,
        },
      },
      {
        type: 'panelLayout/closeActiveTab',
        payload: { wsId: 'ws-1', panelId: undefined, timestamp: NOW },
      },
      {
        type: 'panelLayout/reopenClosedTab',
        payload: { wsId: 'ws-1', newTabId: `tab-${NOW}-i`, timestamp: NOW },
      },
      {
        type: 'panelLayout/selectPreviousTab',
        payload: { wsId: 'ws-1', panelId: undefined, timestamp: NOW },
      },
      {
        type: 'panelLayout/selectNextTab',
        payload: { wsId: 'ws-1', panelId: undefined, timestamp: NOW },
      },
      { type: 'browser/tabZoomRequested', payload: ['ws-1', 'browser-1', 'in'] },
      { type: 'browser/tabZoomRequested', payload: ['ws-1', 'browser-1', 'out'] },
      { type: 'browser/tabZoomRequested', payload: ['ws-1', 'browser-1', 'reset'] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('routes New Browser through configured rightmost-column placement', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));

    await emit('menu:new-browser', { workspaceId: 'ws-1' });

    expect(actions).toEqual([
      {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: {
          wsId: 'ws-1',
          tab: {
            type: 'browser',
            title: 'Browser',
            browserUrl: 'about:blank',
            closable: true,
          },
          newTabId: `tab-${NOW}-i`,
          force: false,
          timestamp: NOW,
        },
      },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('preserves terminal focus, failure logging, and all no-op paths', async () => {
    const actions: unknown[] = [];
    const task = start((action) => actions.push(action));
    mocks.isFocusInTerminal.mockReturnValue(true);
    await emit('menu:new-agent');
    expect(mocks.dispatchWindowEvent.mock.calls).toEqual([
      ['workspace:new-terminal', { workspaceId: 'ws-1' }],
    ]);

    const failure = new Error('nav failed');
    mocks.navigateToRoute.mockRejectedValueOnce(failure);
    await emit('navigate', '/broken');
    await emit('navigate', '');
    await emit('navigate', {});
    expect(mocks.warn.mock.calls).toEqual([
      ['Failed to navigate from menu IPC', { path: '/broken', error: failure }],
    ]);

    state = { panelLayout: { byWorkspaceId: {} } };
    for (const channel of CHANNELS.slice(1)) await emit(channel, {});
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            focusedPanelId: 'panel-1',
            panels: {
              'panel-1': { activeTabId: 'note-1', tabs: [{ id: 'note-1', type: 'note' }] },
            },
          },
        },
      },
    };
    await emit('menu:zoom-in');
    expect(actions).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('routes a menu command to its payload workspace after the active workspace changes', async () => {
    const actions: unknown[] = [];
    state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-2': {
            focusedPanelId: 'panel-2',
            panels: {
              'panel-2': { activeTabId: 'browser-2', tabs: [{ id: 'browser-2', type: 'browser' }] },
            },
          },
        },
      },
    };
    const task = start((action) => actions.push(action));

    await emit('menu:zoom-in', { workspaceId: 'ws-2' });

    expect(actions).toEqual([
      { type: 'browser/tabZoomRequested', payload: ['ws-2', 'browser-2', 'in'] },
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('does not subscribe outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);
    await start().toPromise();
    expect(on.mock.calls).toEqual([]);
  });
});
