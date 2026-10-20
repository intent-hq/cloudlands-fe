/**
 * Background hosting for agent browser ops: when no window has a workspace
 * open (its tab was closed, or it was not reopened since a restart), main
 * asks one window on the owning backend to host it in the background, then
 * routes workspace-scoped messages there like an open workspace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;
type Listener = (...args: unknown[]) => void;

interface FakeWindow {
  id: number;
  backendId: string;
  destroyed: boolean;
  isDestroyed: () => boolean;
  on: ReturnType<typeof vi.fn>;
  webContents: {
    isDestroyed: () => boolean;
    send: ReturnType<typeof vi.fn>;
    on: (event: string, listener: Listener) => void;
    emit: (event: string) => void;
  };
}

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  appOn: vi.fn(),
  appEmit: vi.fn(),
  fromWebContents: vi.fn(),
  fromId: vi.fn(),
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn((): unknown[] => []),
}));

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
    emit: electronMocks.appEmit,
    getAppPath: vi.fn(),
    getVersion: vi.fn(),
    getName: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
    fromId: electronMocks.fromId,
    getFocusedWindow: electronMocks.getFocusedWindow,
    fromWebContents: electronMocks.fromWebContents,
  },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: electronMocks.handle, removeHandler: vi.fn() },
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false, on: vi.fn() },
  shell: {},
}));

vi.mock('../../../../main/window-backend', () => ({
  getBackendIdForWindow: (window: { backendId?: string }) => window.backendId ?? 'local',
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(() => false),
}));

vi.mock('../../../../shared/main/async-utils', () => ({
  findAuggieAsync: vi.fn(),
  findVSCodeAsync: vi.fn(),
}));

import {
  adoptWorkspaceForBackgroundHosting,
  getAllOpenWorkspaceIds,
  getWindowIdsForWorkspace,
  sendToWorkspaceWindows,
  setupSystemIPC,
} from '../system.ipc';
import { IPC_CHANNELS } from '../../../../shared/ipc-registry';
import { ANY_HOST } from '../window-workspace-tracking';

const windows = new Map<number, FakeWindow>();

function makeWindow(id: number, backendId = 'local'): FakeWindow {
  const listeners = new Map<string, Listener[]>();
  const window: FakeWindow = {
    id,
    backendId,
    destroyed: false,
    isDestroyed: () => window.destroyed,
    on: vi.fn(),
    webContents: {
      isDestroyed: () => window.destroyed,
      send: vi.fn(),
      on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
      emit: (event) => listeners.get(event)?.forEach((listener) => listener()),
    },
  };
  windows.set(id, window);
  // Fire the app-level hook system.ipc uses to observe each new window.
  for (const [event, listener] of electronMocks.appOn.mock.calls) {
    if (event === 'browser-window-created') (listener as Listener)({}, window);
  }
  return window;
}

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

async function reportTabStrip(window: FakeWindow, workspaceIds: string[]) {
  electronMocks.fromWebContents.mockReturnValue(window);
  await handlerFor(IPC_CHANNELS.WINDOW.SET_OPEN_WORKSPACE_TABS)({ sender: {} }, { workspaceIds });
}

let nextWindowId = 100;

beforeEach(() => {
  electronMocks.handle.mockReset();
  electronMocks.fromWebContents.mockReset();
  electronMocks.getFocusedWindow.mockReset().mockReturnValue(null);
  electronMocks.fromId.mockReset().mockImplementation((id: number) => windows.get(id) ?? null);
  windows.clear();
  setupSystemIPC();
});

function freshId() {
  return nextWindowId++;
}

async function reportBackgroundHosting(window: FakeWindow, workspaceIds: string[]) {
  electronMocks.fromWebContents.mockReturnValue(window);
  await handlerFor(IPC_CHANNELS.BROWSER.BACKGROUND_HOSTED_WORKSPACES)(
    { sender: {} },
    { workspaceIds },
  );
}

describe('adoptWorkspaceForBackgroundHosting', () => {
  afterEach(() => vi.useRealTimers());

  it('asks an app window on the owning backend to host the workspace and routes to it', async () => {
    const win = makeWindow(freshId());
    await reportTabStrip(win, ['ws-viewed']);
    expect(getWindowIdsForWorkspace('ws-closed', 'local')).toEqual([]);

    expect(adoptWorkspaceForBackgroundHosting('ws-closed', 'local')).toEqual({
      windowId: win.id,
      adopted: true,
    });

    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith(
      IPC_CHANNELS.BROWSER.HOST_WORKSPACE,
      { workspaceId: 'ws-closed', backendId: 'local' },
    );
    expect(getWindowIdsForWorkspace('ws-closed', 'local')).toEqual([win.id]);
    expect(getAllOpenWorkspaceIds()).toContain('ws-closed');

    const delivery = sendToWorkspaceWindows(
      'ws-closed',
      IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST,
      { workspaceId: 'ws-closed', requestId: 'req-1' },
      ANY_HOST,
    );
    expect(delivery.delivered).toBe(true);
    expect(win.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST, {
      workspaceId: 'ws-closed',
      requestId: 'req-1',
    });
  });

  it('prefers the focused app window and skips windows on other backends', async () => {
    const remote = makeWindow(freshId(), 'remote-1');
    const first = makeWindow(freshId());
    const focused = makeWindow(freshId());
    await reportTabStrip(remote, []);
    await reportTabStrip(first, []);
    await reportTabStrip(focused, []);
    electronMocks.getFocusedWindow.mockReturnValue(focused);

    expect(adoptWorkspaceForBackgroundHosting('ws-closed', 'local').windowId).toBe(focused.id);
    expect(adoptWorkspaceForBackgroundHosting('ws-remote', 'remote-1').windowId).toBe(remote.id);
    expect(first.webContents.send).not.toHaveBeenCalled();
  });

  it('only reports the host when a window already has the workspace open', async () => {
    const win = makeWindow(freshId());
    await reportTabStrip(win, ['ws-open']);

    expect(adoptWorkspaceForBackgroundHosting('ws-open', 'local')).toEqual({
      windowId: win.id,
      adopted: false,
    });
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('returns no window when no app window is connected to the backend', async () => {
    const remote = makeWindow(freshId(), 'remote-1');
    await reportTabStrip(remote, []);
    // A window that never reported a tab strip (e.g. a dev console) cannot host.
    makeWindow(freshId());

    expect(adoptWorkspaceForBackgroundHosting('ws-closed', 'local')).toEqual({
      windowId: undefined,
      adopted: false,
    });
    expect(getWindowIdsForWorkspace('ws-closed', ANY_HOST)).toEqual([]);
  });

  it('lets an adoption the window never confirms lapse, so the next op adopts again', async () => {
    vi.useFakeTimers();
    const win = makeWindow(freshId());
    await reportTabStrip(win, []);
    adoptWorkspaceForBackgroundHosting('ws-lost', 'local');
    // A report sent before the request arrived does not cancel the adoption.
    await reportBackgroundHosting(win, []);
    expect(getWindowIdsForWorkspace('ws-lost', 'local')).toEqual([win.id]);

    vi.advanceTimersByTime(10_001);
    expect(getWindowIdsForWorkspace('ws-lost', 'local')).toEqual([]);
    expect(adoptWorkspaceForBackgroundHosting('ws-lost', 'local').adopted).toBe(true);
    expect(win.webContents.send).toHaveBeenCalledTimes(2);
  });

  it('keeps a confirmed adoption and drops it once the window stops reporting it', async () => {
    vi.useFakeTimers();
    const win = makeWindow(freshId());
    await reportTabStrip(win, []);
    adoptWorkspaceForBackgroundHosting('ws-kept', 'local');
    await reportBackgroundHosting(win, ['ws-kept']);

    vi.advanceTimersByTime(60_000);
    expect(getWindowIdsForWorkspace('ws-kept', 'local')).toEqual([win.id]);

    // The workspace was deleted: the window reports it no longer hosts it.
    await reportBackgroundHosting(win, []);
    expect(getWindowIdsForWorkspace('ws-kept', 'local')).toEqual([]);
    expect(getAllOpenWorkspaceIds()).not.toContain('ws-kept');
  });

  it('routes only to the real window once the workspace is opened in one', async () => {
    const host = makeWindow(freshId());
    const other = makeWindow(freshId());
    await reportTabStrip(host, []);
    await reportTabStrip(other, []);
    electronMocks.getFocusedWindow.mockReturnValue(host);
    adoptWorkspaceForBackgroundHosting('ws-later', 'local');
    await reportBackgroundHosting(host, ['ws-later']);

    await reportTabStrip(other, ['ws-later']);
    expect(getWindowIdsForWorkspace('ws-later', 'local')).toEqual([other.id]);

    // Closing it there hands routing back to the background host.
    await reportTabStrip(other, []);
    expect(getWindowIdsForWorkspace('ws-later', 'local')).toEqual([host.id]);
  });

  it('forgets the adoption when the window renderer reloads or crashes', async () => {
    const win = makeWindow(freshId());
    await reportTabStrip(win, []);
    adoptWorkspaceForBackgroundHosting('ws-a', 'local');
    expect(getWindowIdsForWorkspace('ws-a', 'local')).toEqual([win.id]);

    win.webContents.emit('did-navigate');
    expect(getWindowIdsForWorkspace('ws-a', 'local')).toEqual([]);

    adoptWorkspaceForBackgroundHosting('ws-b', 'local');
    win.webContents.emit('render-process-gone');
    expect(getWindowIdsForWorkspace('ws-b', 'local')).toEqual([]);
  });
});
