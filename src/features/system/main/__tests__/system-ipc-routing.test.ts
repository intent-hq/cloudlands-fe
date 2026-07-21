import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

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

    sendToWorkspaceWindows(undefined, 'specialists:files-changed', {});

    expect(winA.webContents.send).toHaveBeenCalledWith('specialists:files-changed', {});
    expect(winB.webContents.send).toHaveBeenCalledWith('specialists:files-changed', {});
    expect(electronMocks.broadcastToBrowserIpcClients).toHaveBeenCalledWith(
      'specialists:files-changed',
      {},
      undefined,
    );
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