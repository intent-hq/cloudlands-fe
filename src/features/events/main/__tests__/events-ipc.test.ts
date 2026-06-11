import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { BrowserWindow } from 'electron';

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, Function>();
  const fromId = vi.fn();
  const removeHandler = vi.fn((channel: string) => {
    handlers.delete(channel);
  });

  return {
    handlers,
    fromId,
    removeHandler,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      electronMocks.handlers.set(channel, handler);
    }),
    removeHandler: electronMocks.removeHandler,
  },
  BrowserWindow: {
    fromId: electronMocks.fromId,
  },
}));

import { EVENTS_CHANNELS } from '../../../../shared/ipc/channels';
import {
  cleanupEventsIPC,
  setupEventsIPC,
} from '../events.ipc';
import {
  addRendererSubscription,
  clearRendererSubscriptions,
  rendererSubscriptions,
  deliverEventToSubscriptions,
  windowCloseListeners,
} from '../renderer-subscription-registry';
import type { WorkspaceEvent } from '../../types';

function makeWindow(closedListeners: Array<() => void> = []) {
  return {
    isDestroyed: vi.fn(() => false),
    once: vi.fn((_event: string, listener: () => void) => {
      closedListeners.push(listener);
    }),
    removeListener: vi.fn(),
    webContents: { send: vi.fn() },
  } as unknown as BrowserWindow;
}

function makeEvent(): WorkspaceEvent {
  return {
    id: 'evt-1',
    workspaceId: 'ws-1',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'file:changed',
    actor: { type: 'system', id: 'system' },
    data: { path: '/tmp/file.ts' },
    metadata: {},
  } as WorkspaceEvent;
}

describe('events IPC renderer subscription cleanup', () => {
  beforeEach(() => {
    clearRendererSubscriptions();
    windowCloseListeners.clear();
    electronMocks.handlers.clear();
    electronMocks.fromId.mockReset();
    electronMocks.removeHandler.mockClear();
  });

  afterEach(() => {
    cleanupEventsIPC();
    vi.clearAllMocks();
  });

  it('removes close-listener registry entries when a subscribed window closes', async () => {
    const closedListeners: Array<() => void> = [];
    const window = makeWindow(closedListeners);

    electronMocks.fromId.mockReturnValue(window);
    setupEventsIPC();

    const subscribe = electronMocks.handlers.get(EVENTS_CHANNELS.SUBSCRIBE);
    expect(subscribe).toBeDefined();

    await subscribe?.({ sender: { id: 42 } }, { subscriptionId: 'sub-a', filters: [] });
    await subscribe?.({ sender: { id: 42 } }, { subscriptionId: 'sub-b', filters: [] });

    expect(rendererSubscriptions.has('sub-a')).toBe(true);
    expect(rendererSubscriptions.has('sub-b')).toBe(true);
    expect(windowCloseListeners.has('sub-a')).toBe(true);
    expect(windowCloseListeners.has('sub-b')).toBe(true);

    closedListeners[0]();

    expect(rendererSubscriptions.has('sub-a')).toBe(false);
    expect(rendererSubscriptions.has('sub-b')).toBe(false);
    expect(windowCloseListeners.has('sub-a')).toBe(false);
    expect(windowCloseListeners.has('sub-b')).toBe(false);
  });

  it('does not retain subscriptions for destroyed windows', async () => {
    electronMocks.fromId.mockReturnValue(undefined);
    setupEventsIPC();

    const subscribe = electronMocks.handlers.get(EVENTS_CHANNELS.SUBSCRIBE);
    await subscribe?.({ sender: { id: 42 } }, { subscriptionId: 'sub-stale', filters: [] });

    expect(rendererSubscriptions.has('sub-stale')).toBe(false);
    expect(windowCloseListeners.has('sub-stale')).toBe(false);
  });

  it('removes the old close listener when a subscription id is replaced', async () => {
    const oldClosedListeners: Array<() => void> = [];
    const newClosedListeners: Array<() => void> = [];
    const oldWindow = makeWindow(oldClosedListeners);
    const newWindow = makeWindow(newClosedListeners);

    electronMocks.fromId
      .mockReturnValueOnce(oldWindow)
      .mockReturnValueOnce(newWindow);
    setupEventsIPC();

    const subscribe = electronMocks.handlers.get(EVENTS_CHANNELS.SUBSCRIBE);
    await subscribe?.({ sender: { id: 42 } }, { subscriptionId: 'sub-reused', filters: [] });
    await subscribe?.({ sender: { id: 43 } }, { subscriptionId: 'sub-reused', filters: [] });

    expect(oldWindow.removeListener).toHaveBeenCalledWith('closed', oldClosedListeners[0]);
    expect(rendererSubscriptions.size).toBe(1);
    expect(rendererSubscriptions.get('sub-reused')?.windowId).toBe(43);
    expect(windowCloseListeners.get('sub-reused')?.window).toBe(newWindow);
  });

  it('prunes stale destroyed-window subscriptions during delivery', () => {
    const staleListener = vi.fn();
    const staleWindow = makeWindow();
    addRendererSubscription('sub-stale', { windowId: 99, filters: [] });
    windowCloseListeners.set('sub-stale', { window: staleWindow, listener: staleListener });
    electronMocks.fromId.mockReturnValue(undefined);

    deliverEventToSubscriptions(makeEvent());

    expect(rendererSubscriptions.has('sub-stale')).toBe(false);
    expect(windowCloseListeners.has('sub-stale')).toBe(false);
    expect(staleWindow.removeListener).toHaveBeenCalledWith('closed', staleListener);
  });

  it('only evaluates global and matching-workspace subscriptions during delivery', () => {
    const wsWindow = makeWindow();
    const otherWindow = makeWindow();
    const globalWindow = makeWindow();

    addRendererSubscription('sub-ws-1', {
      windowId: 1,
      filters: [{ field: 'workspaceId', operator: 'equals', value: 'ws-1' }],
    });
    addRendererSubscription('sub-ws-2', {
      windowId: 2,
      filters: [{ field: 'workspaceId', operator: 'equals', value: 'ws-2' }],
    });
    addRendererSubscription('sub-global', {
      windowId: 3,
      filters: [{ field: 'type', operator: 'equals', value: 'file:changed' }],
    });

    electronMocks.fromId.mockImplementation((id: number) => {
      if (id === 1) return wsWindow;
      if (id === 2) return otherWindow;
      if (id === 3) return globalWindow;
      return undefined;
    });

    deliverEventToSubscriptions(makeEvent());

    expect(electronMocks.fromId).toHaveBeenCalledWith(1);
    expect(electronMocks.fromId).not.toHaveBeenCalledWith(2);
    expect(electronMocks.fromId).toHaveBeenCalledWith(3);
    expect(wsWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(otherWindow.webContents.send).not.toHaveBeenCalled();
    expect(globalWindow.webContents.send).toHaveBeenCalledTimes(1);
  });
});