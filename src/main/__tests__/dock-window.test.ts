import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const appHandlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const screenHandlers = new Map<string, Set<(...args: unknown[]) => void>>();
  let workArea = { x: 100, y: 40, width: 1600, height: 900 };
  let activeBackendId = 'remote-a';

  const add = (
    handlers: Map<string, Set<(...args: unknown[]) => void>>,
    event: string,
    handler: (...args: unknown[]) => void,
  ) => {
    const listeners = handlers.get(event) ?? new Set();
    listeners.add(handler);
    handlers.set(event, listeners);
  };
  const remove = (
    handlers: Map<string, Set<(...args: unknown[]) => void>>,
    event: string,
    handler: (...args: unknown[]) => void,
  ) => handlers.get(event)?.delete(handler);

  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    destroyed = false;
    url = '';
    options: Electron.BrowserWindowConstructorOptions;
    handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    webHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
    setBounds = vi.fn();
    setAlwaysOnTop = vi.fn();
    setFullScreenable = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    showInactive = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    loadURL = vi.fn(async (url: string) => {
      this.url = url;
    });
    webContents = {
      isDestroyed: () => this.destroyed,
      getURL: () => this.url,
      on: (event: string, handler: (...args: unknown[]) => void) => {
        this.webHandlers.set(event, [...(this.webHandlers.get(event) ?? []), handler]);
      },
    };

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      this.options = options;
      FakeBrowserWindow.instances.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    once(event: string, handler: (...args: unknown[]) => void) {
      return this.on(event, handler);
    }
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.forEach((handler) => handler(...args));
    }
    emitWeb(event: string, ...args: unknown[]) {
      this.webHandlers.get(event)?.forEach((handler) => handler(...args));
    }
    close() {
      this.destroyed = true;
      this.emit('closed');
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
  }

  return {
    appHandlers,
    screenHandlers,
    FakeBrowserWindow,
    getWorkArea: () => workArea,
    setWorkArea: (next: typeof workArea) => {
      workArea = next;
    },
    getActiveBackendId: () => activeBackendId,
    setActiveBackendId: (id: string) => {
      activeBackendId = id;
    },
    add,
    remove,
  };
});

vi.mock('electron', () => ({
  app: {
    on: (event: string, handler: (...args: unknown[]) => void) =>
      mocks.add(mocks.appHandlers, event, handler),
    off: (event: string, handler: (...args: unknown[]) => void) =>
      mocks.remove(mocks.appHandlers, event, handler),
  },
  screen: {
    getPrimaryDisplay: () => ({ workArea: mocks.getWorkArea() }),
    on: (event: string, handler: (...args: unknown[]) => void) =>
      mocks.add(mocks.screenHandlers, event, handler),
    off: (event: string, handler: (...args: unknown[]) => void) =>
      mocks.remove(mocks.screenHandlers, event, handler),
  },
  BrowserWindow: mocks.FakeBrowserWindow,
}));

vi.mock('../../shared/logger', () => ({
  Logger: class {
    warn = vi.fn();
  },
}));

vi.mock('../../features/backend/main/connections-store', () => ({
  getActiveId: vi.fn(async () => mocks.getActiveBackendId()),
}));

import {
  _resetDockWindowForTests,
  closeDockWindow,
  createDockWindow,
  DOCK_WINDOW_WIDTH,
  focusDockWindow,
  getDockBounds,
  getDockWindow,
  isDockWindow,
} from '../dock-window';

const emit = (handlers: Map<string, Set<(...args: unknown[]) => void>>, event: string) => {
  handlers.get(event)?.forEach((handler) => handler());
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetDockWindowForTests();
  mocks.appHandlers.clear();
  mocks.screenHandlers.clear();
  mocks.FakeBrowserWindow.instances = [];
  mocks.setWorkArea({ x: 100, y: 40, width: 1600, height: 900 });
  mocks.setActiveBackendId('remote-a');
});

describe('dock window service', () => {
  it('creates one secure, transparent window at the primary work-area edge', async () => {
    const window = createDockWindow() as unknown as InstanceType<typeof mocks.FakeBrowserWindow>;

    expect(mocks.FakeBrowserWindow.instances).toHaveLength(1);
    expect(window.options).toMatchObject({
      x: 1280,
      y: 40,
      width: DOCK_WINDOW_WIDTH,
      height: 900,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, webviewTag: true },
    });
    await vi.waitFor(() => expect(window.loadURL).toHaveBeenCalledWith('app://workspaces/dock'));
    expect(window.backendId).toBe('remote-a');
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
    expect(window.setFullScreenable).toHaveBeenCalledWith(false);
    if (process.platform === 'darwin') {
      expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    }
    window.emit('ready-to-show');
    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(isDockWindow(window as never)).toBe(true);
  });

  it('reuses its live singleton and focuses it on request', () => {
    const first = createDockWindow();
    expect(createDockWindow()).toBe(first);
    expect(mocks.FakeBrowserWindow.instances).toHaveLength(1);

    focusDockWindow();
    const window = first as unknown as InstanceType<typeof mocks.FakeBrowserWindow>;
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('clamps narrow displays and follows primary-display geometry changes', () => {
    expect(getDockBounds({ x: -500, y: 20, width: 300, height: 700 })).toEqual({
      x: -500,
      y: 20,
      width: 300,
      height: 700,
    });
    const window = createDockWindow() as unknown as InstanceType<typeof mocks.FakeBrowserWindow>;
    mocks.setWorkArea({ x: -1920, y: 0, width: 1920, height: 1040 });

    emit(mocks.screenHandlers, 'display-metrics-changed');
    emit(mocks.screenHandlers, 'display-removed');

    const expected = { x: -420, y: 0, width: 420, height: 1040 };
    expect(window.setBounds).toHaveBeenNthCalledWith(1, expected, false);
    expect(window.setBounds).toHaveBeenNthCalledWith(2, expected, false);
  });

  it('reloads the dock route after the active backend changes', async () => {
    const window = createDockWindow() as unknown as InstanceType<typeof mocks.FakeBrowserWindow>;
    await vi.waitFor(() => expect(window.loadURL).toHaveBeenCalledTimes(1));
    mocks.setActiveBackendId('remote-b');
    emit(mocks.appHandlers, 'backend-connection-changed');
    await vi.waitFor(() => expect(window.loadURL).toHaveBeenCalledTimes(2));
    expect(window.loadURL).toHaveBeenLastCalledWith('app://workspaces/dock');
    expect(window.backendId).toBe('remote-b');
  });

  it('cleans up after close and permits a later replacement', () => {
    const first = createDockWindow();
    closeDockWindow();

    expect(getDockWindow()).toBeNull();
    expect(mocks.screenHandlers.get('display-metrics-changed')?.size ?? 0).toBe(0);
    expect(mocks.appHandlers.get('backend-connection-changed')?.size ?? 0).toBe(0);
    expect(createDockWindow()).not.toBe(first);
    expect(mocks.FakeBrowserWindow.instances).toHaveLength(2);
  });

  it('destroys and untracks a dock whose renderer exits', () => {
    const window = createDockWindow() as unknown as InstanceType<typeof mocks.FakeBrowserWindow>;
    window.emitWeb('render-process-gone', {}, { reason: 'crashed' });

    expect(window.destroyed).toBe(true);
    expect(getDockWindow()).toBeNull();
    expect(mocks.screenHandlers.get('display-removed')?.size ?? 0).toBe(0);
  });
});
