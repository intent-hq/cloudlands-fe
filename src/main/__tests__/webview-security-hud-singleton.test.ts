/**
 * Regression: the renderer's window:open-new → window.open bridge fallback
 * (misc-ui-events-seeder) materializes the HUD via a popup that lands in
 * webview-security's setWindowOpenHandler — NOT the createAppWindow IPC
 * funnel — so the handler itself must enforce the per-backend HUD
 * singleton: reuse + focus the live HUD window bound to the opener's
 * backend (deny the popup) instead of allowing a second one, and stamp +
 * register a newly allowed /hud popup as that backend's HUD.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  getAllWindows: vi.fn((): unknown[] => []),
  fromWebContents: vi.fn((): unknown => null),
  sessionHandlers: {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: { on: electronMocks.appOn },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
    fromWebContents: electronMocks.fromWebContents,
  },
  session: {
    defaultSession: electronMocks.sessionHandlers,
    fromPartition: vi.fn(() => electronMocks.sessionHandlers),
  },
  shell: { openExternal: vi.fn(async () => undefined) },
}));

import { _resetHudWindowRefForTests } from '../hud-window';
import { isWebviewPopupWindow, setupWebviewSecurity } from '../webview-security';

type WindowOpenHandler = (details: { url: string }) => { action: 'allow' | 'deny' };
type DidCreateWindowHandler = (win: unknown, details: { url: string }) => void;

function makeHudPopupWindow(opts: { minimized?: boolean; backendId?: string } = {}) {
  let minimized = opts.minimized ?? false;
  return {
    id: 42,
    backendId: opts.backendId,
    isDestroyed: () => false,
    isMinimized: () => minimized,
    restore: vi.fn(() => {
      minimized = false;
    }),
    focus: vi.fn(),
    show: vi.fn(),
    on: vi.fn(),
    webContents: { isDestroyed: () => false, getURL: () => 'app://workspaces/hud' },
  };
}

/**
 * Simulate an app window's webContents passing through web-contents-created.
 * `openerBackendId` stamps the opener's window so the handler resolves the
 * popup's backend from it (unstamped openers bucket to 'local').
 */
function attachAppWindowContents(opts: { openerBackendId?: string } = {}) {
  const contentsOn = vi.fn();
  let windowOpenHandler: WindowOpenHandler | undefined;
  const contents = {
    getType: () => 'window',
    on: contentsOn,
    setWindowOpenHandler: vi.fn((h: WindowOpenHandler) => {
      windowOpenHandler = h;
    }),
  };
  const openerWindow = opts.openerBackendId ? { backendId: opts.openerBackendId } : null;
  electronMocks.fromWebContents.mockImplementation((c: unknown) =>
    c === contents ? openerWindow : null,
  );
  const created = electronMocks.appOn.mock.calls.find(([e]) => e === 'web-contents-created');
  if (!created) throw new Error('web-contents-created listener not registered');
  (created[1] as (e: unknown, c: unknown) => void)(undefined, contents);
  if (!windowOpenHandler) throw new Error('setWindowOpenHandler not called');
  const didCreate = contentsOn.mock.calls.find(([e]) => e === 'did-create-window');
  if (!didCreate) throw new Error('did-create-window listener not registered');
  return {
    openHandler: windowOpenHandler,
    didCreateWindow: didCreate[1] as DidCreateWindowHandler,
  };
}

describe('setWindowOpenHandler HUD singleton (window.open bridge path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.getAllWindows.mockReturnValue([]);
    _resetHudWindowRefForTests();
    setupWebviewSecurity();
  });

  it('allows the first /hud popup, registers it, and denies + focuses on the second', () => {
    const { openHandler, didCreateWindow } = attachAppWindowContents();

    expect(openHandler({ url: 'app://workspaces/hud' })).toMatchObject({ action: 'allow' });

    const hudWindow = makeHudPopupWindow();
    didCreateWindow(hudWindow, { url: 'app://workspaces/hud' });

    expect(openHandler({ url: 'app://workspaces/hud' })).toEqual({ action: 'deny' });
    expect(hudWindow.focus).toHaveBeenCalled();
    expect(hudWindow.show).toHaveBeenCalled();
  });

  it('restores a minimized HUD window before focusing', () => {
    const { openHandler, didCreateWindow } = attachAppWindowContents();
    openHandler({ url: 'app://workspaces/hud' });
    const hudWindow = makeHudPopupWindow({ minimized: true });
    didCreateWindow(hudWindow, { url: 'app://workspaces/hud' });

    expect(openHandler({ url: 'app://workspaces/hud' })).toEqual({ action: 'deny' });
    expect(hudWindow.restore).toHaveBeenCalledTimes(1);
    expect(hudWindow.focus).toHaveBeenCalled();
  });

  it('reuses a HUD window found via the all-windows URL scan (created outside this path)', () => {
    const { openHandler } = attachAppWindowContents();
    const hudWindow = makeHudPopupWindow();
    electronMocks.getAllWindows.mockReturnValue([hudWindow]);

    expect(openHandler({ url: 'app://workspaces/hud' })).toEqual({ action: 'deny' });
    expect(hudWindow.focus).toHaveBeenCalled();
  });

  it('non-HUD internal popups are always allowed and never registered', () => {
    const { openHandler, didCreateWindow } = attachAppWindowContents();

    expect(openHandler({ url: 'app://workspaces/workspace/ws-1' })).toMatchObject({
      action: 'allow',
    });
    const plainWindow = makeHudPopupWindow();
    didCreateWindow(plainWindow, { url: 'app://workspaces/workspace/ws-1' });

    expect(openHandler({ url: 'app://workspaces/workspace/ws-2' })).toMatchObject({
      action: 'allow',
    });
    expect(plainWindow.focus).not.toHaveBeenCalled();
  });

  it('stamps an allowed /hud popup with the opener backend before registering it', () => {
    const { openHandler, didCreateWindow } = attachAppWindowContents({
      openerBackendId: 'remote-a',
    });

    expect(openHandler({ url: 'app://workspaces/hud' })).toMatchObject({ action: 'allow' });
    const hudWindow = makeHudPopupWindow();
    didCreateWindow(hudWindow, { url: 'app://workspaces/hud' });

    expect(hudWindow.backendId).toBe('remote-a');
    expect(openHandler({ url: 'app://workspaces/hud' })).toEqual({ action: 'deny' });
    expect(hudWindow.focus).toHaveBeenCalled();
  });

  it('uses the backend captured at allow time when the opener is destroyed before did-create-window', () => {
    const { openHandler, didCreateWindow } = attachAppWindowContents({
      openerBackendId: 'remote-a',
    });

    expect(openHandler({ url: 'app://workspaces/hud' })).toMatchObject({ action: 'allow' });
    // The opener window goes away between allowing the popup and the
    // did-create-window event: a fresh resolution would fall back to local.
    electronMocks.fromWebContents.mockReturnValue(null);
    const hudWindow = makeHudPopupWindow();
    didCreateWindow(hudWindow, { url: 'app://workspaces/hud' });

    expect(hudWindow.backendId).toBe('remote-a');
  });

  it('an opener on another backend gets its own HUD popup (no cross-backend reuse)', () => {
    const local = attachAppWindowContents();
    expect(local.openHandler({ url: 'app://workspaces/hud' })).toMatchObject({ action: 'allow' });
    const localHud = makeHudPopupWindow();
    local.didCreateWindow(localHud, { url: 'app://workspaces/hud' });

    const remote = attachAppWindowContents({ openerBackendId: 'remote-a' });
    expect(remote.openHandler({ url: 'app://workspaces/hud' })).toMatchObject({
      action: 'allow',
    });
    const remoteHud = makeHudPopupWindow();
    remote.didCreateWindow(remoteHud, { url: 'app://workspaces/hud' });
    expect(remoteHud.backendId).toBe('remote-a');

    expect(remote.openHandler({ url: 'app://workspaces/hud' })).toEqual({ action: 'deny' });
    expect(remoteHud.focus).toHaveBeenCalled();
  });
});

describe('isWebviewPopupWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.getAllWindows.mockReturnValue([]);
    _resetHudWindowRefForTests();
    setupWebviewSecurity();
  });

  /** Simulate a webview's contents passing through web-contents-created. */
  function attachWebviewContents() {
    const contentsOn = vi.fn();
    const contents = {
      getType: () => 'webview',
      on: contentsOn,
      setWindowOpenHandler: vi.fn(),
    };
    const created = electronMocks.appOn.mock.calls.find(([e]) => e === 'web-contents-created');
    if (!created) throw new Error('web-contents-created listener not registered');
    (created[1] as (e: unknown, c: unknown) => void)(undefined, contents);
    const didCreate = contentsOn.mock.calls.find(([e]) => e === 'did-create-window');
    if (!didCreate) throw new Error('did-create-window listener not registered');
    return { didCreateWindow: didCreate[1] as (win: unknown) => void };
  }

  function makePopupWindow(contentsId: number) {
    const closedListeners: Array<() => void> = [];
    return {
      webContents: { id: contentsId, isDestroyed: () => false, on: vi.fn() },
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'closed') closedListeners.push(handler);
      }),
      close: () => closedListeners.forEach((h) => h()),
    };
  }

  it('identifies a tracked webview popup and forgets it once closed', () => {
    const { didCreateWindow } = attachWebviewContents();
    const popup = makePopupWindow(101);

    didCreateWindow(popup);
    expect(isWebviewPopupWindow(popup as never)).toBe(true);

    popup.close();
    expect(isWebviewPopupWindow(popup as never)).toBe(false);
  });

  it('does not identify app windows (never tracked) as webview popups', () => {
    attachWebviewContents();
    const appWindow = makePopupWindow(202);

    expect(isWebviewPopupWindow(appWindow as never)).toBe(false);
  });
});
