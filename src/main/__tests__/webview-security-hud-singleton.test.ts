/**
 * Regression: the renderer's window:open-new → window.open bridge fallback
 * (misc-ui-events-seeder) materializes the HUD via a popup that lands in
 * webview-security's setWindowOpenHandler — NOT the createAppWindow IPC
 * funnel — so the handler itself must enforce the HUD singleton: reuse +
 * focus the live HUD window (deny the popup) instead of allowing a second
 * one, and register a newly allowed /hud popup as the singleton.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  getAllWindows: vi.fn((): unknown[] => []),
  sessionHandlers: {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  app: { on: electronMocks.appOn },
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
  session: {
    defaultSession: electronMocks.sessionHandlers,
    fromPartition: vi.fn(() => electronMocks.sessionHandlers),
  },
  shell: { openExternal: vi.fn(async () => undefined) },
}));

import { _resetHudWindowRefForTests } from '../hud-window';
import { setupWebviewSecurity } from '../webview-security';

type WindowOpenHandler = (details: { url: string }) => { action: 'allow' | 'deny' };
type DidCreateWindowHandler = (win: unknown, details: { url: string }) => void;

function makeHudPopupWindow(opts: { minimized?: boolean } = {}) {
  let minimized = opts.minimized ?? false;
  return {
    id: 42,
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

/** Simulate an app window's webContents passing through web-contents-created. */
function attachAppWindowContents() {
  const contentsOn = vi.fn();
  let windowOpenHandler: WindowOpenHandler | undefined;
  const contents = {
    getType: () => 'window',
    on: contentsOn,
    setWindowOpenHandler: vi.fn((h: WindowOpenHandler) => {
      windowOpenHandler = h;
    }),
  };
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
});
