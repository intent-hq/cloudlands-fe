import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: any[]) => unknown;
const REQUEST_RETENTION_MS = 5 * 60 * 1000;
const REQUEST_CAPACITY = 256;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

const electronMocks = vi.hoisted(() => {
  const constructed: any[] = [];
  const loadURL = vi.fn(async (_url: string) => undefined);
  class MockBrowserWindow {
    static getAllWindows = vi.fn((): unknown[] => []);
    static fromId = vi.fn();
    static getFocusedWindow = vi.fn(() => undefined);
    static fromWebContents = vi.fn(() => undefined);

    id: number;
    destroyed = false;
    minimized = false;
    loadedUrl: string | null = null;
    restore = vi.fn(() => {
      this.minimized = false;
    });
    focus = vi.fn();
    show = vi.fn();
    once = vi.fn();
    closedHandlers: Array<() => void> = [];
    on = vi.fn((event: string, cb: () => void) => {
      if (event === 'closed') this.closedHandlers.push(cb);
    });
    loadURL = vi.fn((url: string) => {
      this.loadedUrl = url;
      return loadURL(url);
    });
    isDestroyed = () => this.destroyed;
    destroy = vi.fn(() => this._close());
    isMinimized = () => this.minimized;
    webContents = {
      isDestroyed: () => false,
      getURL: () => this.loadedUrl ?? '',
      on: vi.fn(),
      once: vi.fn(),
      executeJavaScript: vi.fn(async () => true),
      send: vi.fn(),
    };

    constructor(_options: Record<string, unknown>) {
      this.id = constructed.length + 1;
      constructed.push(this);
    }

    _close() {
      this.destroyed = true;
      this.closedHandlers.forEach((cb) => cb());
    }
  }
  return { MockBrowserWindow, constructed, loadURL, handle: vi.fn(), appOn: vi.fn() };
});

async function waitForWindowCount(count: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && electronMocks.constructed.length < count; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  expect(electronMocks.constructed).toHaveLength(count);
}

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
    getAppPath: vi.fn(() => '/tmp/app'),
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'Intent'),
  },
  BrowserWindow: electronMocks.MockBrowserWindow,
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: electronMocks.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: {},
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: vi.fn() }),
  getBackendIdForIpcSender: vi.fn((sender: { backendId?: string }) => sender.backendId ?? 'local'),
}));

vi.mock('../../../../shared/main/host-exec', () => ({ hostExec: vi.fn() }));
vi.mock('../../../../shared/main/host-exec-stream', () => ({ hostExecStream: vi.fn() }));
vi.mock('../../../../main/window', () => ({
  forwardRendererConsoleToMainLog: vi.fn(),
  stampWindowWithBackend: vi.fn((window: { backendId?: string }, backendId: string) => {
    window.backendId = backendId;
  }),
}));

import { WINDOW_CHANNELS } from '../../../../shared/ipc/channels';
import { _resetHudWindowRefForTests } from '../../../../main/hud-window';
import { setupSystemIPC } from '../system.ipc';
import { WindowOpenNewSchema } from '../../../../main/ipc-schemas';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

describe('HUD window singleton via WINDOW.OPEN_NEW', () => {
  it('bounds exact workspace item targets and rejects arbitrary target shapes', () => {
    expect(
      WindowOpenNewSchema.safeParse({
        workspaceTarget: { type: 'file', filePath: 'src/app.ts', line: 42 },
      }).success,
    ).toBe(true);
    for (const workspaceTarget of [
      { type: 'file', filePath: '' },
      { type: 'file', filePath: 'src/app.ts', line: -1 },
      { type: 'file', filePath: 'src/app.ts', workspaceId: 'other' },
      { type: 'note', noteId: 'n'.repeat(257) },
      { type: 'unknown', payload: {} },
    ])
      expect(WindowOpenNewSchema.safeParse({ workspaceTarget }).success).toBe(false);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.loadURL.mockResolvedValue(undefined);
    electronMocks.constructed.length = 0;
    electronMocks.MockBrowserWindow.getAllWindows.mockReturnValue([]);
    _resetHudWindowRefForTests();
    setupSystemIPC();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opening /hud twice reuses the first window and focuses it', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    const first = (await openNew({ sender: {} }, { route: '/hud' })) as {
      success: boolean;
      windowId: number;
    };
    expect(first.success).toBe(true);
    expect(electronMocks.constructed).toHaveLength(1);

    const second = (await openNew({ sender: {} }, { route: '/hud' })) as {
      success: boolean;
      windowId: number;
    };
    expect(second).toEqual({ success: true, windowId: first.windowId });
    expect(electronMocks.constructed).toHaveLength(1);
    expect(electronMocks.constructed[0].focus).toHaveBeenCalled();
    expect(electronMocks.constructed[0].show).toHaveBeenCalled();
  });

  it('a minimized HUD window is restored before focusing', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    await openNew({ sender: {} }, { route: '/hud' });
    const hud = electronMocks.constructed[0];
    hud.minimized = true;

    await openNew({ sender: {} }, { route: '/hud' });
    expect(hud.restore).toHaveBeenCalledTimes(1);
    expect(hud.focus).toHaveBeenCalled();
    expect(electronMocks.constructed).toHaveLength(1);
  });

  it('a destroyed HUD reference leads to a fresh window', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    await openNew({ sender: {} }, { route: '/hud' });
    electronMocks.constructed[0]._close();

    const result = (await openNew({ sender: {} }, { route: '/hud' })) as { windowId: number };
    expect(electronMocks.constructed).toHaveLength(2);
    expect(result.windowId).toBe(electronMocks.constructed[1].id);
  });

  it('non-HUD routes always create a new window', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    await openNew({ sender: {} }, { route: '/workspace/ws-1' });
    await openNew({ sender: {} }, { route: '/workspace/ws-2' });
    expect(electronMocks.constructed).toHaveLength(2);
  });

  it('keeps the latest exact agent while a dock workspace launch is hydrating', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    await openNew(
      { sender: {} },
      { route: '/workspace/ws-1', reuseExistingWorkspace: true, agentId: 'agent-first' },
    );
    const window = electronMocks.constructed[0];
    const surface = deferred<boolean>();
    window.webContents.executeJavaScript.mockReturnValueOnce(surface.promise);
    const loaded = window.webContents.once.mock.calls.find(
      ([event]: [string]) => event === 'did-finish-load',
    );
    expect(loaded).toBeDefined();
    loaded![1]();
    await openNew(
      { sender: {} },
      { route: '/workspace/ws-1', reuseExistingWorkspace: true, agentId: 'agent-latest' },
    );
    surface.resolve(true);
    await vi.waitFor(() =>
      expect(window.webContents.send).toHaveBeenCalledWith('notification:navigate', {
        workspaceId: 'ws-1',
        agentId: 'agent-latest',
      }),
    );
    expect(electronMocks.constructed).toHaveLength(1);
    expect(window.webContents.send).not.toHaveBeenCalledWith(
      'notification:navigate',
      expect.objectContaining({ agentId: 'agent-first' }),
    );
  });

  it('keeps the latest exact workspace item while the normal window is hydrating', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    await openNew(
      { sender: {} },
      {
        route: '/workspace/ws-1',
        reuseExistingWorkspace: true,
        workspaceTarget: { type: 'file', filePath: 'src/old.ts', line: 12 },
      },
    );
    const window = electronMocks.constructed[0];
    const surface = deferred<boolean>();
    window.webContents.executeJavaScript.mockReturnValueOnce(surface.promise);
    const loaded = window.webContents.once.mock.calls.find(
      ([event]: [string]) => event === 'did-finish-load',
    );
    loaded![1]();
    await openNew(
      { sender: {} },
      {
        route: '/workspace/ws-1',
        reuseExistingWorkspace: true,
        workspaceTarget: { type: 'note', noteId: 'note-latest' },
      },
    );
    surface.resolve(true);
    await vi.waitFor(() =>
      expect(window.webContents.send).toHaveBeenCalledWith('notification:navigate', {
        workspaceId: 'ws-1',
        workspaceTarget: { type: 'note', noteId: 'note-latest' },
      }),
    );
    expect(electronMocks.constructed).toHaveLength(1);
    expect(window.webContents.send).not.toHaveBeenCalledWith(
      'notification:navigate',
      expect.objectContaining({
        workspaceTarget: expect.objectContaining({ filePath: 'src/old.ts' }),
      }),
    );
  });

  it('hands an exact Assistant thread to a newly loaded normal window', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    await openNew(
      { sender: {} },
      { route: '/', reuseExistingWorkspace: true, agentId: 'chief-thread' },
    );
    const window = electronMocks.constructed[0];
    const loaded = window.webContents.once.mock.calls.find(
      ([event]: [string]) => event === 'did-finish-load',
    );
    expect(loaded).toBeDefined();
    loaded![1]();
    await vi.waitFor(() =>
      expect(window.webContents.send).toHaveBeenCalledWith('notification:navigate', {
        workspaceId: '__chief__',
        agentId: 'chief-thread',
        chief: true,
      }),
    );
  });

  it('registers the page-title listener on HUD and workspace windows', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    await openNew({ sender: {} }, { route: '/hud' });
    await openNew({ sender: {} }, { route: '/workspace/ws-1' });

    expect(electronMocks.constructed).toHaveLength(2);
    for (const window of electronMocks.constructed) {
      expect(window.on).toHaveBeenCalledWith('page-title-updated', expect.any(Function));
    }
  });

  it('accepts one BrowserWindow creation when two renderers handle the same app event', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    const request = { route: '/workspace/ws-1', requestId: 'evt-workspace-open-1' };

    const results = await Promise.all([
      openNew({ sender: { backendId: 'local', id: 1 } }, request),
      openNew({ sender: { backendId: 'local', id: 2 } }, request),
    ]);
    const repeated = await openNew({ sender: { backendId: 'local', id: 1 } }, request);

    expect(electronMocks.constructed).toHaveLength(1);
    expect(results[0]).toEqual({ success: true, windowId: electronMocks.constructed[0].id });
    expect(results[1]).toEqual(results[0]);
    expect(repeated).toEqual(results[0]);
  });

  it('accepts separate app events as separate BrowserWindow requests', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);

    await openNew(
      { sender: { backendId: 'local', id: 1 } },
      { route: '/workspace/ws-1', requestId: 'evt-workspace-open-1' },
    );
    await openNew(
      { sender: { backendId: 'local', id: 2 } },
      { route: '/workspace/ws-1', requestId: 'evt-workspace-open-2' },
    );

    expect(electronMocks.constructed).toHaveLength(2);
  });

  it('shares a pending request beyond settled-result retention', async () => {
    const navigation = deferred<void>();
    electronMocks.loadURL.mockReturnValue(navigation.promise);
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    const request = { route: '/workspace/ws-1', requestId: 'long-running-request' };

    const first = openNew({ sender: { id: 1 } }, request) as Promise<unknown>;
    await vi.waitFor(() => expect(electronMocks.constructed).toHaveLength(1));
    const startedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    vi.advanceTimersByTime(REQUEST_RETENTION_MS + 1);
    const duplicate = openNew({ sender: { id: 2 } }, request) as Promise<unknown>;

    expect(electronMocks.constructed).toHaveLength(1);
    navigation.resolve();
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(duplicateResult).toEqual(firstResult);
  });

  it('keeps all pending entries at capacity and rejects excess work without construction', async () => {
    const navigations: Array<ReturnType<typeof deferred<void>>> = [];
    electronMocks.loadURL.mockImplementation(() => {
      const navigation = deferred<void>();
      navigations.push(navigation);
      return navigation.promise;
    });
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    const pending: Array<Promise<unknown>> = [];
    for (let index = 0; index < REQUEST_CAPACITY; index += 1) {
      pending.push(
        openNew(
          { sender: { id: index } },
          { route: `/workspace/ws-${index}`, requestId: `pending-${index}` },
        ) as Promise<unknown>,
      );
      await waitForWindowCount(index + 1);
    }
    const startedAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    vi.advanceTimersByTime(REQUEST_RETENTION_MS + 1);

    const oldestDuplicate = openNew(
      { sender: { id: 999 } },
      { route: '/workspace/ws-0', requestId: 'pending-0' },
    ) as Promise<unknown>;
    const excess = (await openNew(
      { sender: { id: 1000 } },
      { route: '/workspace/excess', requestId: 'pending-excess' },
    )) as { success: boolean; error?: string };

    expect(electronMocks.constructed).toHaveLength(REQUEST_CAPACITY);
    expect(excess).toEqual({ success: false, error: expect.any(String) });
    navigations.forEach((navigation) => navigation.resolve());
    const results = await Promise.all(pending);
    expect(await oldestDuplicate).toEqual(results[0]);
    expect(electronMocks.constructed).toHaveLength(REQUEST_CAPACITY);
  });

  it('starts settled-result retention when window creation settles', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    const request = { route: '/workspace/ws-1', requestId: 'expiring-request' };

    const first = await openNew({ sender: {} }, request);
    const settledAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(settledAt);
    vi.advanceTimersByTime(REQUEST_RETENTION_MS + 1);
    const reused = await openNew({ sender: {} }, request);

    expect(reused).not.toEqual(first);
    expect(electronMocks.constructed).toHaveLength(2);
  });

  it('evicts the oldest settled entry while retaining newer and pending entries', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const delayedNavigation = deferred<void>();
    electronMocks.loadURL.mockReturnValue(delayedNavigation.promise);
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    const insertedFirst = openNew(
      { sender: {} },
      { route: '/workspace/inserted-first', requestId: 'inserted-first' },
    ) as Promise<unknown>;
    await vi.waitFor(() => expect(electronMocks.constructed).toHaveLength(1));

    electronMocks.loadURL.mockResolvedValue(undefined);
    await openNew(
      { sender: {} },
      { route: '/workspace/settled-first', requestId: 'settled-first' },
    );
    now = 1;
    delayedNavigation.resolve();
    await insertedFirst;
    for (let index = 0; index < REQUEST_CAPACITY - 2; index += 1) {
      await openNew(
        { sender: {} },
        { route: `/workspace/fill-${index}`, requestId: `fill-${index}` },
      );
    }

    await openNew({ sender: {} }, { route: '/workspace/new', requestId: 'capacity-new' });
    expect(electronMocks.constructed).toHaveLength(REQUEST_CAPACITY + 1);
    await openNew(
      { sender: {} },
      { route: '/workspace/inserted-first', requestId: 'inserted-first' },
    );
    expect(electronMocks.constructed).toHaveLength(REQUEST_CAPACITY + 1);
    await openNew(
      { sender: {} },
      { route: '/workspace/settled-first', requestId: 'settled-first' },
    );
    expect(electronMocks.constructed).toHaveLength(REQUEST_CAPACITY + 2);
  });

  it('shares failed creation results and expires them after settlement', async () => {
    const navigation = deferred<void>();
    electronMocks.loadURL.mockReturnValue(navigation.promise);
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    const request = { route: '/workspace/failure', requestId: 'failed-request' };

    const first = openNew({ sender: { id: 1 } }, request) as Promise<unknown>;
    const duplicate = openNew({ sender: { id: 2 } }, request) as Promise<unknown>;
    await vi.waitFor(() => expect(electronMocks.constructed).toHaveLength(1));
    navigation.reject(new Error('navigation failed'));
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);

    expect(firstResult).toEqual({ success: false, error: 'navigation failed' });
    expect(duplicateResult).toEqual(firstResult);
    expect(electronMocks.constructed).toHaveLength(1);
    const settledAt = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(settledAt);
    vi.advanceTimersByTime(REQUEST_RETENTION_MS + 1);
    electronMocks.loadURL.mockResolvedValue(undefined);
    expect(await openNew({ sender: {} }, request)).toEqual({ success: true, windowId: 2 });
    expect(electronMocks.constructed).toHaveLength(2);
  });

  it.each([WINDOW_CHANNELS.CREATE, WINDOW_CHANNELS.OPEN_NEW])(
    '%s inherits the opener backend for remote and local app windows',
    async (channel) => {
      const openWindow = handlerFor(channel);
      await openWindow({ sender: { backendId: 'remote-a' } }, { route: '/workspace/remote' });
      await openWindow({ sender: { backendId: 'local' } }, { route: '/workspace/local' });

      expect(electronMocks.constructed[0].backendId).toBe('remote-a');
      expect(electronMocks.constructed[1].backendId).toBe('local');
    },
  );

  it('binds the HUD to the opener backend (no longer forced local)', async () => {
    await handlerFor(WINDOW_CHANNELS.OPEN_NEW)(
      { sender: { backendId: 'remote-a' } },
      { route: '/hud' },
    );

    expect(electronMocks.constructed[0].backendId).toBe('remote-a');
  });

  it('keeps the local-only chief route on the local backend', async () => {
    await handlerFor(WINDOW_CHANNELS.OPEN_NEW)(
      { sender: { backendId: 'remote-a' } },
      { route: '/workspace/__chief__' },
    );

    expect(electronMocks.constructed[0].backendId).toBe('local');
  });

  it('openers on different backends each get their own HUD; same backend reuses', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    const localFirst = (await openNew({ sender: { backendId: 'local' } }, { route: '/hud' })) as {
      windowId: number;
    };
    const remoteFirst = (await openNew(
      { sender: { backendId: 'remote-a' } },
      { route: '/hud' },
    )) as { windowId: number };
    expect(electronMocks.constructed).toHaveLength(2);
    expect(remoteFirst.windowId).not.toBe(localFirst.windowId);

    const localAgain = (await openNew({ sender: { backendId: 'local' } }, { route: '/hud' })) as {
      windowId: number;
    };
    const remoteAgain = (await openNew(
      { sender: { backendId: 'remote-a' } },
      { route: '/hud' },
    )) as { windowId: number };
    expect(electronMocks.constructed).toHaveLength(2);
    expect(localAgain.windowId).toBe(localFirst.windowId);
    expect(remoteAgain.windowId).toBe(remoteFirst.windowId);
  });

  it('closing one backend HUD does not disturb the other backend HUD', async () => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    await openNew({ sender: { backendId: 'local' } }, { route: '/hud' });
    const remote = (await openNew({ sender: { backendId: 'remote-a' } }, { route: '/hud' })) as {
      windowId: number;
    };
    electronMocks.constructed[0]._close();

    const localFresh = (await openNew({ sender: { backendId: 'local' } }, { route: '/hud' })) as {
      windowId: number;
    };
    const remoteReused = (await openNew(
      { sender: { backendId: 'remote-a' } },
      { route: '/hud' },
    )) as { windowId: number };
    expect(electronMocks.constructed).toHaveLength(3);
    expect(localFresh.windowId).toBe(electronMocks.constructed[2].id);
    expect(remoteReused.windowId).toBe(remote.windowId);
  });

  it('WINDOW.CREATE funnels through the same singleton as OPEN_NEW', async () => {
    await handlerFor(WINDOW_CHANNELS.OPEN_NEW)({ sender: {} }, { route: '/hud' });
    const viaCreate = (await handlerFor(WINDOW_CHANNELS.CREATE)(
      { sender: {} },
      { route: '/hud' },
    )) as { success: boolean; windowId: number };
    expect(viaCreate).toEqual({ success: true, windowId: electronMocks.constructed[0].id });
    expect(electronMocks.constructed).toHaveLength(1);
  });
});

describe('dock entries open through WINDOW.OPEN_NEW', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.loadURL.mockResolvedValue(undefined);
    electronMocks.constructed.length = 0;
    electronMocks.MockBrowserWindow.getAllWindows.mockReturnValue([]);
    _resetHudWindowRefForTests();
    setupSystemIPC();
  });

  // The dock document is bound to the machine it shows; each entry opens a normal window.
  const dock = (backendId: string) => ({ sender: { backendId } });

  it.each([
    ['Assistant', 'remote-a', '/', 'local'],
    ['local workspace', 'local', '/workspace/ws-local', 'local'],
    ['workspace on another machine', 'remote-a', '/workspace/ws-remote', 'remote-a'],
    // Main does not pre-check existence; the opened window shows its own not-found state.
    ['archived or missing workspace', 'local', '/workspace/missing%20ws', 'local'],
  ])('%s opens a normal window on the right machine', async (_name, from, route, backend) => {
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    const result = await openNew(dock(from), { route, reuseExistingWorkspace: true });
    expect(result).toEqual({ success: true, windowId: 1 });
    expect(electronMocks.constructed).toHaveLength(1);
    expect(electronMocks.constructed[0].backendId).toBe(backend);
  });

  it('reports why a dock open failed, with route, target and machine', async () => {
    const { Logger } = await import('../../../../shared/logger');
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    electronMocks.loadURL.mockRejectedValue(new Error('navigation failed'));
    const openNew = handlerFor(WINDOW_CHANNELS.OPEN_NEW);
    const result = await openNew(dock('remote-a'), {
      route: '/workspace/ws-remote',
      reuseExistingWorkspace: true,
      workspaceTarget: { type: 'note', noteId: 'n-1' },
    });
    expect(result).toEqual({ success: false, error: 'navigation failed' });
    expect(error).toHaveBeenCalledWith('Failed to open new window', expect.any(Error), {
      reason: 'navigation failed',
      route: '/workspace/ws-remote',
      workspaceTarget: 'note',
      reuseExistingWorkspace: true,
      backendId: 'remote-a',
    });
  });
});
