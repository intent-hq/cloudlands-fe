import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  windows: [] as any[],
  list: vi.fn(),
  getActiveId: vi.fn(),
  setActiveId: vi.fn(),
  connect: vi.fn(),
  request: vi.fn(),
  openBackendWindow: vi.fn(),
  clients: new Map<string, object>(),
  handlers: new Map<string, (event: any, data: unknown) => Promise<unknown>>(),
  preferences: new Map<string, unknown>(),
  setLocalPref: vi.fn(),
  failDockLoad: false,
  placementRevision: 1,
  dragging: false,
  captureHidden: vi.fn(),
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    static fromWebContents(sender: unknown) {
      return fixture.windows.find((window) => window.webContents === sender) ?? null;
    }
    destroyed = false;
    url = '';
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {} as object,
      isDestroyed: () => this.destroyed,
      getURL: () => this.url,
      send: vi.fn(),
      sendInputEvent: vi.fn(),
      setZoomMode: vi.fn(),
      setZoomLevel: vi.fn(),
    });
    visible = false;
    show = vi.fn(() => {
      this.visible = true;
    });
    focus = vi.fn();
    showInactive = vi.fn(() => {
      this.visible = true;
    });
    hide = vi.fn(() => {
      this.visible = false;
      this.emit('hide');
    });
    setIgnoreMouseEvents = vi.fn();
    setAlwaysOnTop = vi.fn();
    setFullScreenable = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    getBounds = () => ({ x: 0, y: 0, width: 224, height: 40 });
    isVisible = () => this.visible;
    isDestroyed = () => this.destroyed;
    loadURL = vi.fn(async (url: string) => {
      this.webContents.emit('did-start-navigation', {}, url, false, true);
      this.webContents.emit('did-start-loading');
      if (fixture.failDockLoad && url.includes('/dock')) {
        fixture.failDockLoad = false;
        throw new Error('dock load failed');
      }
      this.url = url;
      this.webContents.mainFrame = {};
      this.webContents.emit('dom-ready');
    });
    constructor() {
      super();
      fixture.windows.push(this);
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
    close() {
      this.emit('close');
      this.destroy();
    }
  }
  return {
    BrowserWindow: Window,
    ipcMain: {
      handle: (channel: string, handler: (event: any, data: unknown) => Promise<unknown>) =>
        fixture.handlers.set(channel, handler),
    },
    app: new EventEmitter(),
    powerMonitor: new EventEmitter(),
    screen: Object.assign(new EventEmitter(), {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 900 } }),
      getCursorScreenPoint: () => ({ x: 20, y: 20 }),
    }),
  };
});
vi.mock('../features/backend/main/connections-store', () => ({
  list: fixture.list,
  getActiveId: fixture.getActiveId,
  setActiveId: fixture.setActiveId,
}));
vi.mock('../features/backend/main/backend.ipc', () => ({
  connectBackendClient: fixture.connect,
  getBackendClientForConnection: (id: string) => fixture.clients.get(id),
  openBackendWindow: fixture.openBackendWindow,
}));
vi.mock('./dock-cursor', () => ({ attachDockCursor: () => undefined }));
vi.mock('./local-prefs', () => ({
  getLocalPref: async (key: string) => fixture.preferences.get(key),
  setLocalPref: fixture.setLocalPref,
  deleteLocalPref: async (key: string) => {
    fixture.preferences.delete(key);
  },
}));
vi.mock('./dock-placement-controller', () => ({
  DockPlacementController: class {
    initialize = async () => {};
    dispose = vi.fn();
    cancelInteraction = vi.fn();
    refreshDisplays = async () => {};
    setCaptureHidden = fixture.captureHidden;
    get isDragging() {
      return fixture.dragging;
    }
    getSnapshot = () => ({
      revision: fixture.placementRevision,
      placement: { kind: 'floating', x: 0.5, y: 0.5 },
    });
  },
}));
vi.mock('../shared/logger', () => ({
  Logger: class {
    warn() {}
  },
}));
vi.mock('./ipc-validation-middleware', () => {
  const validated =
    (
      schema: { parse: (value: unknown) => unknown },
      handler: (event: any, data: unknown) => Promise<unknown>,
    ) =>
    async (event: any, data: unknown) =>
      handler(event, schema.parse(data));
  return { createValidatedHandler: validated, createSafeValidatedHandler: validated };
});

const flush = async () => {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let dock: typeof import('./dock-window');
let bindings: typeof import('./window-backend');
let window: ReturnType<(typeof import('./dock-window'))['createDockWindow']>;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.clearAllMocks();
  fixture.windows.length = 0;
  fixture.clients.clear();
  fixture.handlers.clear();
  fixture.preferences.clear();
  fixture.setLocalPref.mockImplementation(async (key: string, value: unknown) => {
    fixture.preferences.set(key, value);
  });
  fixture.failDockLoad = false;
  fixture.placementRevision = 1;
  fixture.dragging = false;
  fixture.getActiveId.mockResolvedValue('local');
  fixture.list.mockResolvedValue([{ id: 'local' }, { id: 'remote' }]);
  fixture.request.mockResolvedValue({});
  fixture.connect.mockImplementation(async (id: string) => {
    const client = { request: fixture.request, getStatus: () => 'connected' };
    fixture.clients.set(id, client);
    return client;
  });
  dock = await import('./dock-window');
  bindings = await import('./window-backend');
  window = dock.createDockWindow();
  await flush();
  // The dock document reports it can respond; tests start from a visible dock.
  dock.markDockRendererReady(window);
  vi.mocked(window.showInactive).mockClear();
});
afterEach(() => {
  dock.closeDockWindow();
  vi.useRealTimers();
});
const switchTo = (backendId = 'remote') =>
  dock.switchDockBackend(window, { backendId }, window.webContents.mainFrame);
const finishHandoff = async () => {
  await vi.advanceTimersByTimeAsync(1);
  await flush();
};

describe('owned dock capture visibility release', () => {
  it('releases a stale document barrier without showing it and keeps legacy restoration', () => {
    dock.setDockHiddenForCapture(true, { window });
    vi.mocked(window.showInactive).mockClear();
    dock.setDockHiddenForCapture(false, { window, restore: false });
    expect(fixture.captureHidden).toHaveBeenLastCalledWith(false);
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
    dock.setDockHiddenForCapture(true);
    dock.setDockHiddenForCapture(false);
    expect(window.showInactive).toHaveBeenCalledTimes(1);
  });

  it('does not clear or reveal a replacement window from an old lease', async () => {
    const old = window;
    dock.setDockHiddenForCapture(true, { window: old });
    dock.closeDockWindow();
    window = dock.createDockWindow();
    await flush();
    dock.setDockHiddenForCapture(true, { window });
    fixture.captureHidden.mockClear();
    vi.mocked(window.showInactive).mockClear();
    dock.setDockHiddenForCapture(false, { window: old, restore: false });
    dock.setDockHiddenForCapture(false, { window: old });
    expect(fixture.captureHidden).not.toHaveBeenCalled();
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
  });

  it('does not revive a dock while the desktop session is paused', async () => {
    const { powerMonitor } = await import('electron');
    dock.setDockHiddenForCapture(true, { window });
    powerMonitor.emit('lock-screen');
    vi.mocked(window.showInactive).mockClear();
    dock.setDockHiddenForCapture(false, { window });
    expect(window.showInactive).not.toHaveBeenCalled();
    powerMonitor.emit('unlock-screen');
  });
});

describe('dock measured surface handoff', () => {
  it('copies only the current first painted region and rejects stale or inactive measurements', () => {
    expect(dock.getDockVisibleSurfaceBounds(window)).toBeNull();
    const shell = { x: -20, y: 12, width: 420, height: 240 };
    dock.setDockPointerRegions(
      window,
      { active: true, revision: 1, regions: [shell, { x: 500, y: 0, width: 100, height: 100 }] },
      'darwin',
    );
    const measured = dock.getDockVisibleSurfaceBounds(window);
    expect(measured).toEqual(shell);
    // Gesture refusal covers the shell and every open popup region.
    expect(dock.getDockVisibleSurfaceRegions(window)).toEqual([
      shell,
      { x: 500, y: 0, width: 100, height: 100 },
    ]);
    expect(measured).not.toBe(shell);
    measured!.width = 1;
    expect(dock.getDockVisibleSurfaceBounds(window)!.width).toBe(420);
    expect(
      dock.getDockVisibleSurfaceBounds({ isDestroyed: () => false } as typeof window),
    ).toBeNull();
    fixture.placementRevision = 2;
    expect(dock.getDockVisibleSurfaceBounds(window)).toBeNull();
    dock.setDockPointerRegions(window, { active: true, revision: 1, regions: [shell] }, 'darwin');
    expect(dock.getDockVisibleSurfaceBounds(window)).toBeNull();
    dock.setDockPointerRegions(window, { active: true, revision: 2, regions: [shell] }, 'darwin');
    expect(dock.getDockVisibleSurfaceBounds(window)).toEqual(shell);
    dock.setDockPointerRegions(window, { active: false, revision: 2, regions: [shell] }, 'darwin');
    expect(dock.getDockVisibleSurfaceBounds(window)).toBeNull();
    dock.setDockPointerRegions(window, { active: true, revision: 2, regions: [] }, 'darwin');
    expect(dock.getDockVisibleSurfaceBounds(window)).toBeNull();
    dock.setDockPointerRegions(
      window,
      { active: true, revision: 2, regions: [{ ...shell, width: NaN }] },
      'darwin',
    );
    expect(dock.getDockVisibleSurfaceBounds(window)).toBeNull();
    expect(dock.getDockVisibleSurfaceRegions(window)).toEqual([]);
    dock.closeDockWindow();
    expect(dock.getDockVisibleSurfaceBounds(window)).toBeNull();
  });
});

describe('dock-only backend switch', () => {
  it('validates the registered channel and rejects non-dock and stale frame senders', async () => {
    const { registerDockPlacementHandlers } = await import('./dock-placement-ipc');
    const { WINDOW_CHANNELS } = await import('../shared/ipc/channels');
    registerDockPlacementHandlers();
    const handler = fixture.handlers.get(WINDOW_CHANNELS.SWITCH_DOCK_BACKEND)!;
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    for (const payload of [
      { backendId: '' },
      { backendId: 'x'.repeat(257) },
      { backendId: 'remote', extra: true },
    ])
      await expect(handler(event, payload)).rejects.toThrow();
    await expect(
      handler({ sender: {}, senderFrame: {} }, { backendId: 'remote' }),
    ).rejects.toThrow();
    await expect(handler({ ...event, senderFrame: {} }, { backendId: 'remote' })).rejects.toThrow();
    await window.loadURL('app://workspaces/dock');
    await expect(handler(event, { backendId: 'remote' })).rejects.toThrow();
    expect(fixture.connect).not.toHaveBeenCalled();
    await expect(
      handler(
        { sender: window.webContents, senderFrame: window.webContents.mainFrame },
        { backendId: 'remote' },
      ),
    ).resolves.toEqual({ success: true });
    await finishHandoff();
    expect(bindings.getBackendIdForWindow(window)).toBe('remote');
    expect(fixture.preferences.get('dockBackendId')).toBe('remote');
  });

  it('probes before replying, retires the old document before restamping, and keeps a session override', async () => {
    const probe = deferred();
    fixture.request.mockReturnValueOnce(probe.promise);
    const original = bindings.getStrictBackendBindingForWebContents(window.webContents);
    const placement = dock.getDockPlacementSnapshot(window);
    const operation = switchTo();
    await flush();
    expect(fixture.request).toHaveBeenCalledWith(
      'host.status',
      undefined,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(bindings.getStrictBackendBindingForWebContents(window.webContents)).toBe(original);
    expect(window.loadURL).toHaveBeenCalledTimes(1);
    probe.resolve();
    await expect(operation).resolves.toEqual({ success: true });
    expect(bindings.getBackendIdForWindow(window)).toBe('local');
    const stamps: string[] = [];
    window.webContents.on('did-start-navigation', (_event, url) =>
      stamps.push(`${url}:${bindings.getBackendIdForWindow(window)}`),
    );
    await finishHandoff();
    expect(stamps).toEqual(['about:blank:local', 'app://workspaces/dock:remote']);
    expect(bindings.getStrictBackendBindingForWebContents(window.webContents)?.backendId).toBe(
      'remote',
    );
    const { app } = await import('electron');
    app.emit('backend-connection-changed');
    await flush();
    expect(bindings.getBackendIdForWindow(window)).toBe('remote');
    expect(fixture.setActiveId).not.toHaveBeenCalled();
    expect(fixture.openBackendWindow).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(fixture.windows).toHaveLength(1);
    expect(dock.getDockPlacementSnapshot(window)).toEqual(placement);
    await expect(
      dock.switchDockBackend(window, { backendId: 'local' }, original!.frame),
    ).rejects.toThrow();
    dock.closeDockWindow();
    window = dock.createDockWindow();
    await flush();
    expect(bindings.getBackendIdForWindow(window)).toBe('remote');
  });

  it('leaves the current document and binding untouched on failed readiness', async () => {
    const original = bindings.getStrictBackendBindingForWebContents(window.webContents);
    fixture.request.mockRejectedValueOnce(new Error('unreachable'));
    await expect(switchTo()).rejects.toThrow('unreachable');
    await finishHandoff();
    expect(bindings.getStrictBackendBindingForWebContents(window.webContents)).toBe(original);
    expect(window.loadURL).toHaveBeenCalledTimes(1);
    expect(fixture.setLocalPref).not.toHaveBeenCalled();
  });

  it('bounds readiness without letting a late result switch the dock', async () => {
    const probe = deferred();
    fixture.request.mockReturnValueOnce(probe.promise);
    const operation = switchTo();
    const rejected = expect(operation).rejects.toThrow('timed out');
    await flush();
    await vi.advanceTimersByTimeAsync(15_001);
    await rejected;
    probe.resolve();
    await finishHandoff();
    expect(bindings.getBackendIdForWindow(window)).toBe('local');
    expect(window.loadURL).toHaveBeenCalledTimes(1);
  });

  it('cancels a prepared response before navigation if capture takes ownership', async () => {
    await switchTo();
    dock.setDockHiddenForCapture(true);
    dock.setDockHiddenForCapture(false);
    await finishHandoff();
    expect(bindings.getBackendIdForWindow(window)).toBe('local');
    expect(window.loadURL).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith('window:dock-backend-switch-failed', {
      backendId: 'remote',
    });
    expect(
      vi
        .mocked(window.webContents.send)
        .mock.calls.filter(([channel]) => channel === 'window:dock-backend-switch-failed'),
    ).toHaveLength(1);
  });

  it('rejects a closing dock and preserves a replaced client after a prepared response', async () => {
    await switchTo();
    fixture.clients.set('remote', {});
    await finishHandoff();
    expect(bindings.getBackendIdForWindow(window)).toBe('local');
    expect(window.webContents.send).toHaveBeenCalledWith('window:dock-backend-switch-failed', {
      backendId: 'remote',
    });
    window.emit('close');
    await expect(switchTo()).rejects.toThrow();
  });

  it.each(['navigation', 'restamp', 'close', 'replacement'] as const)(
    'does not notify a retired accepted request after %s',
    async (reason) => {
      await switchTo();
      const originalSender = window.webContents;
      if (reason === 'navigation') await window.loadURL('app://workspaces/dock');
      if (reason === 'restamp') bindings.stampWindowWithBackend(window, 'local');
      if (reason === 'close' || reason === 'replacement') dock.closeDockWindow();
      if (reason === 'replacement') {
        window = dock.createDockWindow();
        await flush();
      }
      await finishHandoff();
      expect(originalSender.send).not.toHaveBeenCalledWith(
        'window:dock-backend-switch-failed',
        expect.anything(),
      );
      expect(window.webContents.send).not.toHaveBeenCalledWith(
        'window:dock-backend-switch-failed',
        expect.anything(),
      );
    },
  );

  it('rejects unknown IDs, another window, subframes, capture, and competing requests', async () => {
    await expect(switchTo('missing')).rejects.toThrow();
    expect(fixture.connect).not.toHaveBeenCalled();
    await expect(
      dock.switchDockBackend(
        {} as typeof window,
        { backendId: 'remote' },
        window.webContents.mainFrame,
      ),
    ).rejects.toThrow();
    await expect(
      dock.switchDockBackend(window, { backendId: 'remote' }, {} as Electron.WebFrameMain),
    ).rejects.toThrow();
    dock.setDockHiddenForCapture(true);
    await expect(switchTo()).rejects.toThrow();
    dock.setDockHiddenForCapture(false);
    const probe = deferred();
    fixture.request.mockReturnValueOnce(probe.promise);
    const first = switchTo();
    await flush();
    await expect(switchTo()).rejects.toThrow();
    probe.resolve();
    await first;
    await finishHandoff();
  });

  it.each(['navigation', 'capture', 'close', 'restamp', 'client replacement'] as const)(
    'discards a probe after %s',
    async (reason) => {
      const probe = deferred();
      fixture.request.mockReturnValueOnce(probe.promise);
      const operation = switchTo();
      const rejected = expect(operation).rejects.toThrow();
      await flush();
      if (reason === 'navigation') await window.loadURL('app://workspaces/dock');
      if (reason === 'capture') {
        dock.setDockHiddenForCapture(true);
        dock.setDockHiddenForCapture(false);
      }
      if (reason === 'close') {
        dock.closeDockWindow();
        dock.createDockWindow();
        await flush();
      }
      if (reason === 'restamp') bindings.stampWindowWithBackend(window, 'local');
      if (reason === 'client replacement') fixture.clients.set('remote', {});
      probe.resolve();
      await rejected;
      await finishHandoff();
      expect(bindings.getBackendIdForWindow(dock.getDockWindow()!)).toBe('local');
    },
  );

  it('restores the previous backend through a retired document when dock loading fails', async () => {
    await switchTo();
    fixture.failDockLoad = true;
    await finishHandoff();
    expect(bindings.getBackendIdForWindow(window)).toBe('local');
    expect(fixture.setLocalPref).not.toHaveBeenCalled();
    expect(bindings.getStrictBackendBindingForWebContents(window.webContents)?.backendId).toBe(
      'local',
    );
    expect(vi.mocked(window.loadURL).mock.calls.map(([url]) => url)).toEqual([
      'app://workspaces/dock',
      'about:blank',
      'app://workspaces/dock',
      'about:blank',
      'app://workspaces/dock?dockBackendSwitchFailed=1',
    ]);
  });

  it.each(['remote', 'forgotten', 42] as const)(
    'loads a persisted choice %s with saved-machine validation',
    async (preference) => {
      dock.closeDockWindow();
      vi.resetModules();
      fixture.preferences.set('dockBackendId', preference);
      dock = await import('./dock-window');
      bindings = await import('./window-backend');
      window = dock.createDockWindow();
      await flush();
      expect(bindings.getBackendIdForWindow(window)).toBe(
        preference === 'remote' ? 'remote' : 'local',
      );
      expect(fixture.preferences.get('dockBackendId')).toBe(
        preference === 'remote' ? 'remote' : undefined,
      );
      expect(fixture.setActiveId).not.toHaveBeenCalled();
    },
  );

  it('falls back cleanly when the selected saved machine is forgotten', async () => {
    await switchTo();
    await finishHandoff();
    fixture.list.mockResolvedValue([{ id: 'local' }]);
    const { app } = await import('electron');
    app.emit('backend-connection-changed');
    await flush();
    expect(bindings.getBackendIdForWindow(window)).toBe('local');
    expect(fixture.preferences.has('dockBackendId')).toBe(false);
    expect(fixture.setActiveId).not.toHaveBeenCalled();
  });

  it('keeps the old document local until blank navigation completes', async () => {
    const originalLoad = vi.mocked(window.loadURL).getMockImplementation()!;
    const blank = deferred();
    vi.mocked(window.loadURL).mockImplementationOnce(async (url) => {
      expect(url).toBe('about:blank');
      await blank.promise;
      return originalLoad(url);
    });
    await switchTo();
    await finishHandoff();
    expect(bindings.getBackendIdForWindow(window)).toBe('local');
    dock.setDockHiddenForCapture(true);
    blank.resolve();
    await flush();
    expect(bindings.getBackendIdForWindow(window)).toBe('local');
    expect(window.focus).not.toHaveBeenCalled();
  });
});

describe('dock pointer presence', () => {
  const shell = { x: 0, y: 0, width: 224, height: 40 };
  const presence = () =>
    (window.webContents.send as ReturnType<typeof vi.fn>).mock.calls
      .filter(([channel]) => channel === 'window:dock-pointer-presence-changed')
      .map(([, payload]) => payload);
  const poll = (point: { x: number; y: number }, revision = 1) =>
    dock.setDockPointerRegions(
      window,
      { active: true, revision, regions: [shell] },
      'darwin',
      point,
    );

  it('reports each enter and leave once, and wakes hover tracking once per entry without focusing', () => {
    poll({ x: 10, y: 10 });
    poll({ x: 12, y: 10 });
    poll({ x: 500, y: 500 });
    poll({ x: 500, y: 501 });
    expect(presence()).toEqual([
      { inside: true, x: 10, y: 10, revision: 1 },
      { inside: false, x: 500, y: 500, revision: 1 },
    ]);
    expect(window.webContents.sendInputEvent).toHaveBeenCalledExactlyOnceWith({
      type: 'mouseMove',
      x: 10,
      y: 10,
    });
    expect(window.focus).not.toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
  });

  it('ignores stale revisions and is silent while dragging or hidden, then re-reports entry', () => {
    poll({ x: 10, y: 10 }, 7);
    expect(presence()).toEqual([]);
    poll({ x: 10, y: 10 });
    fixture.dragging = true;
    poll({ x: 10, y: 10 });
    fixture.dragging = false;
    poll({ x: 10, y: 10 });
    window.isVisible = () => false;
    poll({ x: 500, y: 500 });
    window.isVisible = () => true;
    poll({ x: 10, y: 10 });
    expect(presence().map((entry: any) => entry.inside)).toEqual([true, true, true]);
  });
});

describe('dock reveal waits for a responsive renderer', () => {
  const fresh = async () => {
    dock.closeDockWindow();
    window = dock.createDockWindow();
    await flush();
    return window;
  };

  it('keeps a new dock hidden until its renderer reports ready, then shows it inactive', async () => {
    const created = await fresh();
    created.emit('ready-to-show');
    expect(created.showInactive).not.toHaveBeenCalled();
    expect(dock.markDockRendererReady(created)).toBe(true);
    expect(created.showInactive).toHaveBeenCalledTimes(1);
    expect(created.show).not.toHaveBeenCalled();
    expect(created.focus).not.toHaveBeenCalled();
  });

  it('shows the dock after the fallback when the renderer never reports ready', async () => {
    const created = await fresh();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(created.showInactive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(created.showInactive).toHaveBeenCalledTimes(1);
    expect(created.focus).not.toHaveBeenCalled();
  });

  it('hides on a new document (reload, crash recovery, backend switch) until ready again', () => {
    expect(window.isVisible()).toBe(true);
    window.webContents.emit('did-start-navigation', {}, 'app://workspaces/dock', false, true);
    expect(window.hide).toHaveBeenCalled();
    expect(window.isVisible()).toBe(false);
    // An in-page or subframe navigation is not a new document.
    vi.mocked(window.hide).mockClear();
    dock.markDockRendererReady(window);
    window.webContents.emit('did-start-navigation', {}, 'app://workspaces/dock#x', true, true);
    window.webContents.emit('did-start-navigation', {}, 'https://frame.test/', false, false);
    expect(window.hide).not.toHaveBeenCalled();
    expect(window.showInactive).toHaveBeenCalledTimes(1);
  });

  it('never reveals a stale or replaced window', async () => {
    const old = window;
    await fresh();
    expect(dock.markDockRendererReady(old)).toBe(false);
    expect(old.showInactive).not.toHaveBeenCalled();
  });
});
