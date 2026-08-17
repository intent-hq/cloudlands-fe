import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  getAllWindows: vi.fn(),
  fromId: vi.fn(),
  appOn: vi.fn(),
  appEmit: vi.fn(),
  broadcastToBrowserIpcClients: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
    emit: electronMocks.appEmit,
    getAppPath: vi.fn(() => '/tmp/app'),
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'Intent'),
  },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
    fromId: electronMocks.fromId,
    getFocusedWindow: vi.fn(() => undefined),
    fromWebContents: vi.fn(() => undefined),
  },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: {},
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: electronMocks.broadcastToBrowserIpcClients,
}));

import { sendToWorkspaceWindows } from '../system.ipc';

function makeWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
  };
}

describe('sendToWorkspaceWindows routing', () => {
  beforeEach(() => {
    electronMocks.getAllWindows.mockReset();
    electronMocks.fromId.mockReset();
    electronMocks.broadcastToBrowserIpcClients.mockReset();
  });

  it('does not fall back to all Electron windows for a workspace with no matching windows', () => {
    const winA = makeWindow();
    const winB = makeWindow();
    electronMocks.getAllWindows.mockReturnValue([winA, winB]);

    sendToWorkspaceWindows('ws-missing', 'agent:status-changed', {
      workspaceId: 'ws-missing',
    });

    expect(electronMocks.getAllWindows).not.toHaveBeenCalled();
    expect(winA.webContents.send).not.toHaveBeenCalled();
    expect(winB.webContents.send).not.toHaveBeenCalled();
    expect(electronMocks.broadcastToBrowserIpcClients).toHaveBeenCalledWith(
      'agent:status-changed',
      { workspaceId: 'ws-missing' },
      'ws-missing',
    );
  });

  it('preserves global broadcast behavior when no workspace context exists', () => {
    const winA = makeWindow();
    const winB = makeWindow();
    electronMocks.getAllWindows.mockReturnValue([winA, winB]);
    electronMocks.broadcastToBrowserIpcClients.mockReturnValue(false);

    const delivery = sendToWorkspaceWindows(undefined, 'websocket-api:discovery-auto-disabled', {});

    expect(winA.webContents.send).toHaveBeenCalledWith('websocket-api:discovery-auto-disabled', {});
    expect(winB.webContents.send).toHaveBeenCalledWith('websocket-api:discovery-auto-disabled', {});
    expect(electronMocks.broadcastToBrowserIpcClients).toHaveBeenCalledWith(
      'websocket-api:discovery-auto-disabled',
      {},
      undefined,
    );
    expect(delivery).toEqual({ windowCount: 2, browserClientsNotified: false, delivered: true });
  });

  // Regression (intent-hq/monorepo#2602): delivery used to be invisible to the
  // caller — a workspace-scoped message dropped because no window has the
  // workspace open reported nothing, so openTab/focusTab claimed success on
  // messages nothing received.
  it('reports zero delivery when a workspace-scoped message reaches no window or browser client', () => {
    electronMocks.broadcastToBrowserIpcClients.mockReturnValue(false);

    const delivery = sendToWorkspaceWindows('ws-missing', 'agent:status-changed', {
      workspaceId: 'ws-missing',
    });

    expect(delivery).toEqual({ windowCount: 0, browserClientsNotified: false, delivered: false });
  });

  it('counts browser-mode WebSocket delivery even when no Electron window matches', () => {
    electronMocks.broadcastToBrowserIpcClients.mockReturnValue(true);

    const delivery = sendToWorkspaceWindows('ws-missing', 'agent:status-changed', {
      workspaceId: 'ws-missing',
    });

    expect(delivery).toEqual({ windowCount: 0, browserClientsNotified: true, delivered: true });
  });
});

describe('browser IPC broadcast adapter delivery acknowledgment', () => {
  // The adapter is mocked at module scope for the routing tests above, so
  // load the real implementation here.
  async function realAdapter() {
    return await vi.importActual<typeof import('../../../../main/browser-ipc-broadcast-adapter')>(
      '../../../../main/browser-ipc-broadcast-adapter',
    );
  }

  // Regression (intent-hq/monorepo#2602 review): a registered hook used to
  // count as delivery merely by existing, so a stale/clientless bridge made
  // zero-delivery detection report phantom success.
  it('does not count a hook that fails to acknowledge delivery', async () => {
    const adapter = await realAdapter();
    const unregister = adapter.registerBrowserIpcBroadcast(() => {
      // legacy void hook: no acknowledgment
    });
    try {
      expect(adapter.broadcastToBrowserIpcClients('agent:status-changed', {}, 'ws-1')).toBe(false);
    } finally {
      unregister();
    }
  });

  it('does not count a hook that explicitly reports no connected clients', async () => {
    const adapter = await realAdapter();
    const unregister = adapter.registerBrowserIpcBroadcast(() => false);
    try {
      expect(adapter.broadcastToBrowserIpcClients('agent:status-changed', {}, 'ws-1')).toBe(false);
    } finally {
      unregister();
    }
  });

  it('counts delivery only when the hook acknowledges a connected client', async () => {
    const adapter = await realAdapter();
    const hook = vi.fn(() => true);
    const unregister = adapter.registerBrowserIpcBroadcast(hook);
    try {
      expect(adapter.broadcastToBrowserIpcClients('agent:status-changed', {}, 'ws-1')).toBe(true);
      expect(hook).toHaveBeenCalledWith('agent:status-changed', {}, 'ws-1');
    } finally {
      unregister();
    }
  });

  it('reports no delivery when no hook is registered', async () => {
    const adapter = await realAdapter();
    expect(adapter.broadcastToBrowserIpcClients('agent:status-changed', {}, 'ws-1')).toBe(false);
  });
});

describe('window close cleanup', () => {
  it('emits window-workspace-state-changed when a window closes so open-workspace listeners reconcile', () => {
    // system.ipc.ts registers this at module scope.
    const createdHandler = electronMocks.appOn.mock.calls.find(
      ([event]) => event === 'browser-window-created',
    )?.[1] as ((event: unknown, window: unknown) => void) | undefined;
    expect(createdHandler).toBeDefined();

    const closedHandlers: Array<() => void> = [];
    const window = {
      id: 42,
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'closed') closedHandlers.push(cb);
      }),
    };
    createdHandler!({}, window);
    expect(closedHandlers).toHaveLength(1);

    // Regression: the closed cleanup used to delete the tracking maps
    // silently, leaking notification services (and their daemon agent:idle
    // subscriptions) for workspaces only open in the closed window.
    electronMocks.appEmit.mockClear();
    closedHandlers[0]();
    expect(electronMocks.appEmit).toHaveBeenCalledWith('window-workspace-state-changed');
  });
});
