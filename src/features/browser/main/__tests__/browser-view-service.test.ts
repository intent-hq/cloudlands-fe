import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
  BrowserViewService,
  toWindowRect,
  type BrowserViewServiceDeps,
} from '../browser-view-service';

/** The service's parked size before any box was reported, and its zoom ceiling. */
const DEFAULT_PARKED_SIZE = { width: 1280, height: 800 };
const MAX_PAGE_ZOOM = 5;
import type { BrowserViewEventMessage } from '../../../../shared/types/browser-view';

vi.mock('../../../../shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

let nextId = 100;

/** A fake page: an event emitter with the webContents calls the service uses. */
class FakeContents extends EventEmitter {
  readonly id = nextId++;
  destroyed = false;
  backgroundThrottling = true;
  zoomFactor = 1;
  loaded: string[] = [];
  history = { back: false, forward: false };
  readonly navigationHistory = {
    canGoBack: () => this.history.back,
    canGoForward: () => this.history.forward,
    goBack: vi.fn(),
    goForward: vi.fn(),
  };
  readonly close = vi.fn(() => this.destroy());
  readonly reload = vi.fn();
  readonly reloadIgnoringCache = vi.fn();
  readonly stop = vi.fn();
  readonly focus = vi.fn();
  readonly openDevTools = vi.fn();
  readonly findInPage = vi.fn(() => 7);
  readonly stopFindInPage = vi.fn();
  readonly setZoomFactor = vi.fn((factor: number) => {
    this.zoomFactor = factor;
  });
  readonly send = vi.fn();
  isDestroyed = () => this.destroyed;
  getZoomFactor = () => this.zoomFactor;
  loadURL = vi.fn(async (url: string) => {
    this.loaded.push(url);
  });
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('destroyed');
  }
}

class FakeView {
  readonly webContents = new FakeContents();
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  visible = true;
  setBounds = vi.fn((bounds: typeof this.bounds) => {
    this.bounds = bounds;
  });
  setVisible = vi.fn((visible: boolean) => {
    this.visible = visible;
  });
}

/** A fake window: its contentView keeps child order, index 0 at the bottom. */
class FakeWindow extends EventEmitter {
  destroyed = false;
  readonly machine = new FakeContents();
  readonly machineView = { machine: true };
  shown = 'local';
  readonly children: unknown[] = [this.machineView];
  readonly contentView = {
    addChildView: vi.fn((view: unknown, index?: number) => {
      const at = this.children.indexOf(view);
      if (at >= 0) this.children.splice(at, 1);
      if (index === undefined) this.children.push(view);
      else this.children.splice(index, 0, view);
    }),
    removeChildView: vi.fn((view: unknown) => {
      const at = this.children.indexOf(view);
      if (at >= 0) this.children.splice(at, 1);
    }),
  };
  isDestroyed = () => this.destroyed;
  close(): void {
    this.emit('close');
    this.destroyed = true;
    this.emit('closed');
  }
}

function setup(overrides: Partial<BrowserViewServiceDeps> = {}) {
  const views: FakeView[] = [];
  const sent: Array<{ target: unknown; message: BrowserViewEventMessage }> = [];
  const secured: unknown[] = [];
  const preferences = { partition: 'persist:browser-panel', sandbox: true };
  const deps = {
    createView: vi.fn(() => {
      const view = new FakeView();
      views.push(view);
      return view;
    }),
    webPreferences: vi.fn(() => ({ ...preferences })),
    secureContents: vi.fn((contents: unknown) => secured.push(contents)),
    isNavigationAllowed: (url: string) => /^(https?:|about:)/.test(url),
    machineViewFor: (window: FakeWindow, backendId: string) =>
      backendId === 'local' && !window.destroyed ? window.machine : null,
    shownMachine: (window: FakeWindow) => window.shown,
    cdp: { registerTab: vi.fn(), unregisterTab: vi.fn() },
    send: vi.fn((target: unknown, message: BrowserViewEventMessage) =>
      sent.push({ target, message }),
    ),
    ...overrides,
  };
  const service = new BrowserViewService(deps as unknown as BrowserViewServiceDeps);
  return { service, deps, views, sent, secured, preferences };
}

const KEY = { backendId: 'local', workspaceId: 'ws-1', tabId: 'tab-1' };
const RECT = { x: 10, y: 20, width: 300, height: 200 };

function windowLike(window: FakeWindow) {
  return window as unknown as Electron.BrowserWindow;
}

describe('BrowserViewService life cycle', () => {
  it('creates a secured page, registers it for CDP at once, and loads the URL', () => {
    const { service, deps, views, secured } = setup();
    const window = new FakeWindow();

    const { webContentsId } = service.create(KEY, windowLike(window), 'https://example.com/');

    expect(deps.createView).toHaveBeenCalledWith({
      partition: 'persist:browser-panel',
      sandbox: true,
    });
    const contents = views[0].webContents;
    expect(webContentsId).toBe(contents.id);
    expect(secured).toEqual([contents]);
    expect(deps.cdp.registerTab).toHaveBeenCalledWith('tab-1', contents.id, 'ws-1');
    expect(contents.loaded).toEqual(['https://example.com/']);
    expect(service.placementOf('tab-1')).toBe('detached');
    expect(window.children).toEqual([window.machineView]);
    expect(service.owns(contents.id)).toBe(true);
    expect(service.hostFor(contents.id)).toBe(window.machine);
  });

  it('refuses an address the guest rules block, and creates nothing', () => {
    const { service, deps } = setup();
    expect(() =>
      service.create(KEY, windowLike(new FakeWindow()), 'javascript:alert(1)'),
    ).toThrow();
    expect(deps.createView).not.toHaveBeenCalled();
  });

  it('returns the same page when the tab is created again', () => {
    const { service, deps } = setup();
    const window = new FakeWindow();
    const first = service.create(KEY, windowLike(window), 'https://a.test/');
    const second = service.create(KEY, windowLike(window), 'https://b.test/');
    expect(second).toEqual(first);
    expect(deps.createView).toHaveBeenCalledTimes(1);
  });

  it('refuses a tab id that another workspace already owns', () => {
    const { service } = setup();
    service.create(KEY, windowLike(new FakeWindow()), 'https://a.test/');
    expect(() =>
      service.create({ ...KEY, workspaceId: 'ws-2' }, windowLike(new FakeWindow()), 'https://a/'),
    ).toThrow('another workspace');
  });

  it('closes the page and unregisters it when the tab closes', () => {
    const { service, deps, views } = setup();
    const window = new FakeWindow();
    service.create(KEY, windowLike(window), 'https://a.test/');
    service.setPlacement('tab-1', RECT, true);

    service.destroy('tab-1');

    expect(views[0].webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
    expect(deps.cdp.unregisterTab).toHaveBeenCalledExactlyOnceWith('tab-1');
    expect(window.children).toEqual([window.machineView]);
    expect(service.keyOf('tab-1')).toBeUndefined();
    expect(service.owns(views[0].webContents.id)).toBe(false);
  });

  it('forgets a page that ends by itself (window.close() or crash teardown)', () => {
    const { service, deps, views } = setup();
    const window = new FakeWindow();
    service.create(KEY, windowLike(window), 'https://a.test/');
    service.setPlacement('tab-1', RECT, true);

    views[0].webContents.destroy();

    expect(service.keyOf('tab-1')).toBeUndefined();
    expect(deps.cdp.unregisterTab).toHaveBeenCalledWith('tab-1');
    expect(window.children).toEqual([window.machineView]);
  });

  it('closes only the pages of a workspace that went away', () => {
    const { service, views } = setup();
    const window = windowLike(new FakeWindow());
    service.create(KEY, window, 'https://a.test/');
    service.create({ ...KEY, tabId: 'tab-2' }, window, 'https://b.test/');
    service.create({ ...KEY, workspaceId: 'ws-2', tabId: 'tab-3' }, window, 'https://c.test/');

    service.destroyWorkspace('local', 'ws-1');

    expect(views.map((view) => view.webContents.destroyed)).toEqual([true, true, false]);
    expect(service.keyOf('tab-3')).toBeDefined();
  });
});

describe('BrowserViewService placement', () => {
  it('shows the page above the machine view at the box in window pixels', () => {
    const { service, views } = setup();
    const window = new FakeWindow();
    window.machine.zoomFactor = 1.25;
    service.create(KEY, windowLike(window), 'https://a.test/');

    service.setPlacement('tab-1', RECT, true);

    expect(views[0].bounds).toEqual(toWindowRect(RECT, 1.25));
    expect(window.children).toEqual([window.machineView, views[0]]);
    expect(views[0].visible).toBe(true);
    expect(service.placementOf('tab-1')).toBe('shown');
  });

  it('takes the page off screen on detach and keeps it alive', () => {
    const { service, views } = setup();
    const window = new FakeWindow();
    service.create(KEY, windowLike(window), 'https://a.test/');
    service.setPlacement('tab-1', RECT, true);

    service.detach('tab-1');

    expect(window.children).toEqual([window.machineView]);
    expect(views[0].webContents.destroyed).toBe(false);
    expect(service.placementOf('tab-1')).toBe('detached');
  });

  it('hides the page while its window shows another machine, and raises it again after', async () => {
    const { service, views } = setup();
    const window = new FakeWindow();
    service.create(KEY, windowLike(window), 'https://a.test/');
    service.setPlacement('tab-1', RECT, true);

    window.shown = 'remote';
    service.handleShownMachineChanged(windowLike(window));
    await Promise.resolve();
    expect(service.placementOf('tab-1')).toBe('detached');

    // Like the rail's applySelection: announce the switch, then raise the
    // selected machine view in the same task.
    window.shown = 'local';
    service.handleShownMachineChanged(windowLike(window));
    window.contentView.addChildView(window.machineView);
    await Promise.resolve();
    expect(window.children).toEqual([window.machineView, views[0]]);
    expect(service.placementOf('tab-1')).toBe('shown');
  });
});

describe('BrowserViewService drawing holds (parking)', () => {
  it('parks a detached page under the machine view at its last size, unthrottled', () => {
    const { service, views } = setup();
    const window = new FakeWindow();
    service.create(KEY, windowLike(window), 'https://a.test/');
    service.setPlacement('tab-1', RECT, true);
    service.detach('tab-1');
    const view = views[0];

    const release = service.holdDrawing(view.webContents.id);

    expect(release).toBeTypeOf('function');
    expect(service.placementOf('tab-1')).toBe('parked');
    expect(window.children).toEqual([view, window.machineView]);
    expect(view.bounds).toEqual({ x: 0, y: 0, width: RECT.width, height: RECT.height });
    expect(view.visible).toBe(true);
    expect(view.webContents.backgroundThrottling).toBe(false);

    release?.();

    expect(service.placementOf('tab-1')).toBe('detached');
    expect(window.children).toEqual([window.machineView]);
    expect(view.webContents.backgroundThrottling).toBe(true);
  });

  it('parks at the default size before any box was reported', () => {
    const { service, views } = setup();
    service.create(KEY, windowLike(new FakeWindow()), 'https://a.test/');
    service.holdDrawing(views[0].webContents.id);
    expect(views[0].bounds).toEqual({ x: 0, y: 0, ...DEFAULT_PARKED_SIZE });
  });

  it('stays parked until the last overlapping hold ends', () => {
    const { service, views } = setup();
    service.create(KEY, windowLike(new FakeWindow()), 'https://a.test/');
    const id = views[0].webContents.id;
    const first = service.holdDrawing(id);
    const second = service.holdDrawing(id);

    first?.();
    first?.();
    expect(service.placementOf('tab-1')).toBe('parked');
    second?.();
    expect(service.placementOf('tab-1')).toBe('detached');
  });

  it('leaves a page on screen where it is during a hold', () => {
    const { service, views } = setup();
    const window = new FakeWindow();
    service.create(KEY, windowLike(window), 'https://a.test/');
    service.setPlacement('tab-1', RECT, true);

    const release = service.holdDrawing(views[0].webContents.id);
    expect(service.placementOf('tab-1')).toBe('shown');
    expect(window.children).toEqual([window.machineView, views[0]]);

    // Hidden mid-hold: it parks, so the capture still gets frames.
    service.detach('tab-1');
    expect(service.placementOf('tab-1')).toBe('parked');
    release?.();
    expect(service.placementOf('tab-1')).toBe('detached');
  });

  it('keeps throttling off when a held page goes back on screen before the hold ends', () => {
    const { service, views } = setup();
    service.create(KEY, windowLike(new FakeWindow()), 'https://a.test/');
    const contents = views[0].webContents;
    const release = service.holdDrawing(contents.id);
    expect(contents.backgroundThrottling).toBe(false);

    service.setPlacement('tab-1', RECT, true);
    expect(service.placementOf('tab-1')).toBe('shown');
    // The hold's owner restores throttling when it ends.
    expect(contents.backgroundThrottling).toBe(false);
    release?.();
  });

  it('does not hold pages it does not own', () => {
    const { service } = setup();
    expect(service.holdDrawing(9999)).toBeUndefined();
  });
});

describe('BrowserViewService window moves and window close', () => {
  it('moves the same page to another window with no reload and re-registers its host', () => {
    const { service, deps, views } = setup();
    const source = new FakeWindow();
    const target = new FakeWindow();
    service.create(KEY, windowLike(source), 'https://a.test/');
    service.setPlacement('tab-1', RECT, true);
    const contents = views[0].webContents;

    service.moveToWindow('tab-1', windowLike(target));

    expect(source.children).toEqual([source.machineView]);
    expect(service.windowOf('tab-1')).toBe(target);
    expect(service.hostFor(contents.id)).toBe(target.machine);
    expect(deps.createView).toHaveBeenCalledTimes(1);
    expect(contents.loaded).toEqual(['https://a.test/']);
    expect(deps.cdp.registerTab).toHaveBeenLastCalledWith('tab-1', contents.id, 'ws-1');
    expect(service.placementOf('tab-1')).toBe('detached');

    service.setPlacement('tab-1', RECT, true);
    expect(target.children).toEqual([target.machineView, views[0]]);
  });

  it('closes the pages a window still holds when it closes', () => {
    const { service, deps, views } = setup();
    const window = new FakeWindow();
    service.create(KEY, windowLike(window), 'https://a.test/');
    service.create({ ...KEY, tabId: 'tab-2' }, windowLike(window), 'https://b.test/');
    service.setPlacement('tab-1', RECT, true);

    window.close();

    expect(views.every((view) => view.webContents.close.mock.calls.length === 1)).toBe(true);
    expect(deps.cdp.unregisterTab).toHaveBeenCalledWith('tab-1');
    expect(deps.cdp.unregisterTab).toHaveBeenCalledWith('tab-2');
    expect(service.keyOf('tab-1')).toBeUndefined();
  });

  it('keeps a page that the closing hook moves to another window', () => {
    const main = new FakeWindow();
    const { service, views } = setup({
      onWindowClosing: (_window, tabIds) => {
        for (const tabId of tabIds) service.moveToWindow(tabId, windowLike(main));
      },
    });
    const tabWindow = new FakeWindow();
    service.create(KEY, windowLike(tabWindow), 'https://a.test/');

    tabWindow.close();

    expect(views[0].webContents.destroyed).toBe(false);
    expect(service.windowOf('tab-1')).toBe(main);
  });
});

describe('BrowserViewService page events and commands', () => {
  it('sends page events to the machine view of the window, keyed by tab', () => {
    const { service, views, sent } = setup();
    const window = new FakeWindow();
    service.create(KEY, windowLike(window), 'https://a.test/');
    const contents = views[0].webContents;
    contents.history.back = true;

    contents.emit('did-navigate', {}, 'https://a.test/next');
    contents.emit('page-title-updated', {}, 'Next');
    contents.emit('did-navigate-in-page', {}, 'https://a.test/frame', false);
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://a.test/x', true);
    contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 11 });

    expect(sent.every(({ target }) => target === window.machine)).toBe(true);
    expect(sent.map(({ message }) => message)).toEqual([
      {
        tabId: 'tab-1',
        workspaceId: 'ws-1',
        event: {
          type: 'navigated',
          url: 'https://a.test/next',
          canGoBack: true,
          canGoForward: false,
        },
      },
      { tabId: 'tab-1', workspaceId: 'ws-1', event: { type: 'title', title: 'Next' } },
      {
        tabId: 'tab-1',
        workspaceId: 'ws-1',
        event: { type: 'crashed', reason: 'crashed', exitCode: 11 },
      },
    ]);
  });

  it('stops sending events after the page is closed', () => {
    const { service, views, sent } = setup();
    service.create(KEY, windowLike(new FakeWindow()), 'https://a.test/');
    const contents = views[0].webContents;
    service.destroy('tab-1');
    contents.emit('page-title-updated', {}, 'Late');
    expect(sent).toEqual([]);
  });

  it('runs the controls on the page and checks navigation addresses', () => {
    const { service, views } = setup();
    service.create(KEY, windowLike(new FakeWindow()), 'https://a.test/');
    const contents = views[0].webContents;

    service.command('tab-1', { type: 'navigate', url: 'https://b.test/' });
    expect(contents.loaded).toEqual(['https://a.test/', 'https://b.test/']);
    expect(() => service.command('tab-1', { type: 'navigate', url: 'javascript:1' })).toThrow();

    service.command('tab-1', { type: 'back' });
    expect(contents.navigationHistory.goBack).not.toHaveBeenCalled();
    contents.history.back = true;
    service.command('tab-1', { type: 'back' });
    expect(contents.navigationHistory.goBack).toHaveBeenCalledTimes(1);

    service.command('tab-1', { type: 'reload', ignoreCache: true });
    expect(contents.reloadIgnoringCache).toHaveBeenCalledTimes(1);
    service.command('tab-1', { type: 'set-zoom', factor: 40 });
    expect(contents.zoomFactor).toBe(MAX_PAGE_ZOOM);
    expect(service.command('tab-1', { type: 'find', text: 'needle' })).toEqual({ requestId: 7 });
    expect(contents.findInPage).toHaveBeenCalledWith('needle', {
      forward: true,
      findNext: false,
      matchCase: false,
    });
    service.command('tab-1', { type: 'stop-find', action: 'clearSelection' });
    expect(contents.stopFindInPage).toHaveBeenCalledWith('clearSelection');
  });

  it('refuses commands for a closed tab', () => {
    const { service } = setup();
    expect(() => service.command('missing', { type: 'stop' })).toThrow('closed');
  });
});

describe('toWindowRect', () => {
  it('scales CSS pixels by the machine zoom and keeps edges on whole pixels', () => {
    expect(toWindowRect({ x: 10.4, y: 0, width: 100.2, height: 50 }, 1.5)).toEqual({
      x: 16,
      y: 0,
      width: 150,
      height: 75,
    });
  });

  it('treats a bad zoom factor as 1 and never returns a negative size', () => {
    expect(toWindowRect({ x: 5, y: 5, width: -3, height: 10 }, Number.NaN)).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 10,
    });
  });
});
