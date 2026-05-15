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
  rendererSubscriptions,
  windowCloseListeners,
} from '../renderer-subscription-registry';

describe('events IPC renderer subscription cleanup', () => {
  beforeEach(() => {
    rendererSubscriptions.clear();
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
    const window = {
      isDestroyed: vi.fn(() => false),
      once: vi.fn((_event: string, listener: () => void) => {
        closedListeners.push(listener);
      }),
      removeListener: vi.fn(),
      webContents: { send: vi.fn() },
    } as unknown as BrowserWindow;

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
});