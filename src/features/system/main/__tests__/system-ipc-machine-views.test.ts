/**
 * Machine rail: one window hosts a renderer per machine (its own, plus a
 * machine view for each other machine). Each renderer hosts that machine's
 * workspaces, shown or hidden, so agent browser ops for a machine reach its
 * renderer even while the window shows another machine.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;
type Listener = (...args: unknown[]) => void;

interface FakeContents {
  id: number;
  destroyed: boolean;
  isDestroyed: () => boolean;
  send: ReturnType<typeof vi.fn>;
  on: (event: string, listener: Listener) => void;
  once: (event: string, listener: Listener) => void;
  emit: (event: string) => void;
}

interface FakeWindow {
  id: number;
  backendId: string;
  destroyed: boolean;
  isDestroyed: () => boolean;
  on: ReturnType<typeof vi.fn>;
  webContents: FakeContents;
}

const fakes = vi.hoisted(() => ({
  handle: vi.fn(),
  appOn: vi.fn(),
  getFocusedWindow: vi.fn(),
  windows: new Map<number, unknown>(),
  contents: new Map<number, unknown>(),
  /** Machine view → its window and backend. */
  views: new Map<unknown, { window: unknown; backendId: string }>(),
  /** Window → the machine view it shows (absent: its own renderer). */
  shown: new Map<unknown, unknown>(),
}));

vi.mock('electron', () => ({
  app: {
    on: fakes.appOn,
    emit: vi.fn(),
    getAppPath: vi.fn(),
    getVersion: vi.fn(),
    getName: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [...fakes.windows.values()],
    fromId: (id: number) => fakes.windows.get(id) ?? null,
    getFocusedWindow: fakes.getFocusedWindow,
    fromWebContents: (sender: unknown) =>
      fakes.views.get(sender)?.window ??
      [...fakes.windows.values()].find(
        (window) => (window as { webContents: unknown }).webContents === sender,
      ) ??
      null,
  },
  webContents: { fromId: (id: number) => fakes.contents.get(id) ?? null },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: fakes.handle, removeHandler: vi.fn() },
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false, on: vi.fn() },
  shell: {},
}));

vi.mock('../../../../main/window-backend', () => {
  const windowOf = (sender: unknown) =>
    fakes.views.get(sender)?.window ??
    [...fakes.windows.values()].find(
      (window) => (window as { webContents: unknown }).webContents === sender,
    ) ??
    null;
  const shownOf = (window: unknown) =>
    fakes.shown.get(window) ?? (window as { webContents: unknown }).webContents;
  return {
    getBackendIdForWindow: (window: { backendId: string }) => window.backendId,
    getBackendIdForWebContents: (sender: unknown) =>
      fakes.views.get(sender)?.backendId ??
      (windowOf(sender) as { backendId: string } | null)?.backendId ??
      'local',
    getWindowForWebContents: windowOf,
    isMachineViewOf: (window: unknown, sender: unknown) =>
      fakes.views.get(sender)?.window === window,
    getShownRendererWebContents: shownOf,
    getRendererWebContents: (window: { webContents: unknown }) => [
      window.webContents,
      ...[...fakes.views].filter(([, view]) => view.window === window).map(([sender]) => sender),
    ],
  };
});

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
  getBackendIdForRendererKey,
  getRendererKeysForWorkspace,
  getViewedWorkspaceIdForWindow,
  getWindowIdForWorkspace,
  getWindowIdsForWorkspace,
  hasWorkspaceShellFor,
  sendToWorkspaceWindows,
  setupSystemIPC,
} from '../system.ipc';
import { IPC_CHANNELS } from '../../../../shared/ipc-registry';
import { ANY_HOST } from '../window-workspace-tracking';

let nextId = 500;

function makeContents(): FakeContents {
  const listeners = new Map<string, Listener[]>();
  const contents: FakeContents = {
    id: nextId++,
    destroyed: false,
    isDestroyed: () => contents.destroyed,
    send: vi.fn(),
    on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    once: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    emit: (event) => listeners.get(event)?.forEach((listener) => listener()),
  };
  fakes.contents.set(contents.id, contents);
  return contents;
}

function makeWindow(backendId = 'local'): FakeWindow {
  const window: FakeWindow = {
    id: nextId++,
    backendId,
    destroyed: false,
    isDestroyed: () => window.destroyed,
    on: vi.fn(),
    webContents: makeContents(),
  };
  fakes.windows.set(window.id, window);
  for (const [event, listener] of fakes.appOn.mock.calls) {
    if (event === 'browser-window-created') (listener as Listener)({}, window);
  }
  return window;
}

function makeView(window: FakeWindow, backendId: string): FakeContents {
  const view = makeContents();
  fakes.views.set(view, { window, backendId });
  return view;
}

function handlerFor(channel: string): Handler {
  const call = fakes.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

const reportTabStrip = (sender: FakeContents, workspaceIds: string[]) =>
  handlerFor(IPC_CHANNELS.WINDOW.SET_OPEN_WORKSPACE_TABS)({ sender }, { workspaceIds });

const reportViewed = (sender: FakeContents, workspaceId?: string) =>
  handlerFor(IPC_CHANNELS.WINDOW.SET_IN_WORKSPACE)(
    { sender },
    { inWorkspace: !!workspaceId, workspaceId },
  );

const reportBackgroundHosting = (sender: FakeContents, workspaceIds: string[]) =>
  handlerFor(IPC_CHANNELS.BROWSER.BACKGROUND_HOSTED_WORKSPACES)({ sender }, { workspaceIds });

beforeEach(() => {
  fakes.handle.mockReset();
  fakes.getFocusedWindow.mockReset().mockReturnValue(null);
  fakes.windows.clear();
  fakes.contents.clear();
  fakes.views.clear();
  fakes.shown.clear();
  setupSystemIPC();
});

describe('workspace hosting by machine views', () => {
  it('routes a hidden machine view’s open workspace to that view, not the window’s own renderer', async () => {
    const window = makeWindow('local');
    const viewB = makeView(window, 'b');
    await reportTabStrip(window.webContents, ['ws-home']);
    await reportTabStrip(viewB, ['ws-b']);

    expect(getWindowIdsForWorkspace('ws-b', 'b')).toEqual([window.id]);
    expect(getWindowIdsForWorkspace('ws-b', 'local')).toEqual([]);
    expect(getAllOpenWorkspaceIds()).toEqual(expect.arrayContaining(['ws-home', 'ws-b']));

    const delivery = sendToWorkspaceWindows(
      'ws-b',
      IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST,
      { workspaceId: 'ws-b', requestId: 'req-1' },
      'b',
    );
    expect(delivery.delivered).toBe(true);
    expect(viewB.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST, {
      workspaceId: 'ws-b',
      requestId: 'req-1',
    });
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it('asks a hidden machine view to background-host a workspace of its machine', async () => {
    const window = makeWindow('local');
    const viewB = makeView(window, 'b');
    await reportTabStrip(window.webContents, []);
    await reportTabStrip(viewB, []);
    fakes.getFocusedWindow.mockReturnValue(window);

    expect(adoptWorkspaceForBackgroundHosting('ws-b', 'b')).toEqual({
      windowId: window.id,
      adopted: true,
    });
    expect(viewB.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.BROWSER.HOST_WORKSPACE, {
      workspaceId: 'ws-b',
      backendId: 'b',
    });
    expect(window.webContents.send).not.toHaveBeenCalled();

    await reportBackgroundHosting(viewB, ['ws-b']);
    sendToWorkspaceWindows('ws-b', IPC_CHANNELS.BROWSER.OPEN_TAB, { workspaceId: 'ws-b' }, 'b');
    expect(viewB.send).toHaveBeenLastCalledWith(IPC_CHANNELS.BROWSER.OPEN_TAB, {
      workspaceId: 'ws-b',
    });
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it('keeps “what the window shows” on the shown renderer', async () => {
    const window = makeWindow('local');
    const viewB = makeView(window, 'b');
    await reportViewed(window.webContents, 'ws-home');
    await reportViewed(viewB, 'ws-b');

    expect(getViewedWorkspaceIdForWindow(window.id)).toBe('ws-home');
    expect(getWindowIdForWorkspace('ws-b', ANY_HOST)).toBeUndefined();
    // The hidden view still hosts its workspace for routing.
    expect(getWindowIdsForWorkspace('ws-b', 'b')).toEqual([window.id]);

    fakes.shown.set(window, viewB);
    expect(getViewedWorkspaceIdForWindow(window.id)).toBe('ws-b');
    expect(getWindowIdForWorkspace('ws-b', 'b')).toBe(window.id);
    expect(getWindowIdForWorkspace('ws-home', ANY_HOST)).toBeUndefined();
  });

  it('resolves the backend of a workspace hosted by a hidden view from that view', async () => {
    const window = makeWindow('local');
    const viewB = makeView(window, 'b');
    await reportTabStrip(viewB, ['ws-b']);

    expect(getRendererKeysForWorkspace('ws-b', ANY_HOST).map(getBackendIdForRendererKey)).toEqual([
      'b',
    ]);
  });

  it('forgets a machine view’s workspaces once the view is gone', async () => {
    const window = makeWindow('local');
    const viewB = makeView(window, 'b');
    await reportTabStrip(viewB, ['ws-b']);

    viewB.destroyed = true;
    expect(getWindowIdsForWorkspace('ws-b', 'b')).toEqual([]);
    expect(getAllOpenWorkspaceIds()).not.toContain('ws-b');
  });

  it('forgets a machine view’s entries when the view is destroyed', async () => {
    const window = makeWindow('local');
    const viewB = makeView(window, 'b');
    await reportTabStrip(viewB, ['ws-b']);
    expect(hasWorkspaceShellFor('b')).toBe(true);

    viewB.emit('destroyed');
    expect(getAllOpenWorkspaceIds()).not.toContain('ws-b');
    expect(hasWorkspaceShellFor('b')).toBe(false);
  });

  it('drops what a machine view hosted in the background once it reloads', async () => {
    const window = makeWindow('local');
    const viewB = makeView(window, 'b');
    await reportTabStrip(viewB, []);
    fakes.getFocusedWindow.mockReturnValue(window);
    adoptWorkspaceForBackgroundHosting('ws-b', 'b');
    await reportBackgroundHosting(viewB, ['ws-b']);
    expect(getWindowIdsForWorkspace('ws-b', 'b')).toEqual([window.id]);

    viewB.emit('did-navigate');
    expect(getWindowIdsForWorkspace('ws-b', 'b')).toEqual([]);
  });

  it('knows which machines run the workspace shell, on their own backend', async () => {
    const window = makeWindow('local');
    makeView(window, 'b');
    await reportTabStrip(window.webContents, []);

    expect(hasWorkspaceShellFor('local')).toBe(true);
    // The view exists but has not reported its tab strip yet.
    expect(hasWorkspaceShellFor('b')).toBe(false);
  });
});
