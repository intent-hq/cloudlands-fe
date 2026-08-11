import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  getAllWindows: vi.fn((): unknown[] => []),
  appOn: vi.fn(),
  ipcHandle: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
  app: { on: electronMocks.appOn },
  ipcMain: { handle: electronMocks.ipcHandle },
}));

import {
  ConsoleOwnerTracker,
  GET_OWNER_STATUS_CHANNEL,
  OWNER_CHANGED_CHANNEL,
  setupConsoleOwnerTracking,
  type ConsoleOwnerWindow,
} from '../console-owner';

interface MockWindow extends ConsoleOwnerWindow {
  hud: boolean;
  send: ReturnType<typeof vi.fn>;
  _close: () => void;
}

let nextId = 1;

function makeWindow(opts: { hud?: boolean; focused?: boolean } = {}): MockWindow {
  const id = nextId++;
  let destroyed = false;
  let focused = opts.focused ?? false;
  const closedHandlers: Array<() => void> = [];
  const send = vi.fn();
  const win: MockWindow = {
    hud: opts.hud ?? false,
    send,
    isDestroyed: () => destroyed,
    isFocused: () => focused,
    webContents: {
      id,
      isDestroyed: () => destroyed,
      send,
    },
    on: (_event: 'closed', listener: () => void) => {
      closedHandlers.push(listener);
    },
    _close: () => {
      destroyed = true;
      focused = false;
      closedHandlers.forEach((cb) => cb());
    },
  };
  return win;
}

/** The last owner-changed payload sent to a window, or undefined if none. */
function lastPayload(win: MockWindow): { isOwner: boolean } | undefined {
  const calls = win.send.mock.calls.filter(([channel]) => channel === OWNER_CHANGED_CHANNEL);
  return calls.at(-1)?.[1];
}

function makeTracker() {
  return new ConsoleOwnerTracker<MockWindow>((w) => w.hud);
}

describe('ConsoleOwnerTracker', () => {
  beforeEach(() => {
    nextId = 1;
    vi.clearAllMocks();
  });

  describe('initial owner', () => {
    it('makes the first registered non-HUD window the owner', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      tracker.registerWindow(a);
      expect(tracker.isOwnerWebContentsId(a.webContents.id)).toBe(true);
    });

    it('does not make a HUD window the initial owner', () => {
      const tracker = makeTracker();
      const hud = makeWindow({ hud: true });
      tracker.registerWindow(hud);
      expect(tracker.isOwnerWebContentsId(hud.webContents.id)).toBe(false);

      const normal = makeWindow();
      tracker.registerWindow(normal);
      expect(tracker.isOwnerWebContentsId(normal.webContents.id)).toBe(true);
    });

    it('keeps the first window as owner when later windows register without focus', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const b = makeWindow();
      tracker.registerWindow(a);
      tracker.registerWindow(b);
      expect(tracker.isOwnerWebContentsId(a.webContents.id)).toBe(true);
      expect(tracker.isOwnerWebContentsId(b.webContents.id)).toBe(false);
    });
  });

  describe('focus hand-off', () => {
    it('moves ownership to the last-focused non-HUD window', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const b = makeWindow();
      tracker.registerWindow(a);
      tracker.registerWindow(b);

      tracker.handleFocus(b);
      expect(tracker.isOwnerWebContentsId(b.webContents.id)).toBe(true);
      expect(tracker.isOwnerWebContentsId(a.webContents.id)).toBe(false);

      tracker.handleFocus(a);
      expect(tracker.isOwnerWebContentsId(a.webContents.id)).toBe(true);
    });

    it('pushes per-window { isOwner } payloads on every ownership change', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const b = makeWindow();
      tracker.registerWindow(a);
      tracker.registerWindow(b);

      tracker.handleFocus(b);
      expect(lastPayload(a)).toEqual({ isOwner: false });
      expect(lastPayload(b)).toEqual({ isOwner: true });
    });

    it('does not re-broadcast when the current owner regains focus', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      tracker.registerWindow(a);
      a.send.mockClear();
      tracker.handleFocus(a);
      expect(a.send).not.toHaveBeenCalled();
    });

    it('registers an unknown window defensively on focus', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      tracker.handleFocus(a);
      expect(tracker.isOwnerWebContentsId(a.webContents.id)).toBe(true);
    });
  });

  describe('HUD exclusion', () => {
    it('never hands ownership to a HUD window on focus', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const hud = makeWindow({ hud: true });
      tracker.registerWindow(a);
      tracker.registerWindow(hud);

      tracker.handleFocus(hud);
      expect(tracker.isOwnerWebContentsId(a.webContents.id)).toBe(true);
      expect(tracker.isOwnerWebContentsId(hud.webContents.id)).toBe(false);
    });

    it('always sends { isOwner: false } to HUD windows on broadcasts', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const b = makeWindow();
      const hud = makeWindow({ hud: true });
      tracker.registerWindow(a);
      tracker.registerWindow(b);
      tracker.registerWindow(hud);

      tracker.handleFocus(b);
      expect(lastPayload(hud)).toEqual({ isOwner: false });
      tracker.handleFocus(a);
      expect(lastPayload(hud)).toEqual({ isOwner: false });
    });

    it('demotes a window that becomes recognizably HUD by its first focus', () => {
      // The HUD route may not be loaded yet when the window registers (its URL
      // is still about:blank), so a HUD created while no owner exists could be
      // mis-assigned; the first focus event corrects it.
      const tracker = makeTracker();
      const hud = makeWindow();
      tracker.registerWindow(hud);
      expect(tracker.isOwnerWebContentsId(hud.webContents.id)).toBe(true);

      hud.hud = true;
      tracker.handleFocus(hud);
      expect(tracker.isOwnerWebContentsId(hud.webContents.id)).toBe(false);
      expect(lastPayload(hud)).toEqual({ isOwner: false });
    });
  });

  describe('owner-close fallback', () => {
    it('falls back to the focused non-HUD window when the owner closes', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const b = makeWindow();
      const c = makeWindow();
      tracker.registerWindow(a);
      tracker.registerWindow(b);
      tracker.registerWindow(c);
      tracker.handleFocus(b);
      tracker.handleFocus(a);

      (c as unknown as { isFocused: () => boolean }).isFocused = () => true;
      a._close();
      expect(tracker.isOwnerWebContentsId(c.webContents.id)).toBe(true);
      expect(lastPayload(c)).toEqual({ isOwner: true });
      expect(lastPayload(b)).toEqual({ isOwner: false });
    });

    it('falls back to the most recently focused remaining non-HUD window when none is focused', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const b = makeWindow();
      const c = makeWindow();
      tracker.registerWindow(a);
      tracker.registerWindow(b);
      tracker.registerWindow(c);
      tracker.handleFocus(c);
      tracker.handleFocus(b);
      tracker.handleFocus(a);

      a._close();
      expect(tracker.isOwnerWebContentsId(b.webContents.id)).toBe(true);

      b._close();
      expect(tracker.isOwnerWebContentsId(c.webContents.id)).toBe(true);
    });

    it('never falls back to a HUD window', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const hud = makeWindow({ hud: true, focused: true });
      tracker.registerWindow(a);
      tracker.registerWindow(hud);
      tracker.handleFocus(a);

      a._close();
      expect(tracker.isOwnerWebContentsId(hud.webContents.id)).toBe(false);
      expect(lastPayload(hud)).toEqual({ isOwner: false });
    });

    it('falls back to a never-focused remaining non-HUD window', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const b = makeWindow();
      tracker.registerWindow(a);
      tracker.registerWindow(b);

      a._close();
      expect(tracker.isOwnerWebContentsId(b.webContents.id)).toBe(true);
    });

    it('clears ownership when the last non-HUD window closes', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const hud = makeWindow({ hud: true });
      tracker.registerWindow(a);
      tracker.registerWindow(hud);

      a._close();
      expect(tracker.isOwnerWebContentsId(a.webContents.id)).toBe(false);
      expect(lastPayload(hud)).toEqual({ isOwner: false });
    });

    it('keeps ownership when a non-owner window closes, without re-broadcasting', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const b = makeWindow();
      tracker.registerWindow(a);
      tracker.registerWindow(b);
      a.send.mockClear();

      b._close();
      expect(tracker.isOwnerWebContentsId(a.webContents.id)).toBe(true);
      expect(a.send).not.toHaveBeenCalled();
    });

    it('does not send to destroyed windows on broadcast', () => {
      const tracker = makeTracker();
      const a = makeWindow();
      const b = makeWindow();
      const c = makeWindow();
      tracker.registerWindow(a);
      tracker.registerWindow(b);
      tracker.registerWindow(c);

      c._close();
      c.send.mockClear();
      tracker.handleFocus(b);
      expect(c.send).not.toHaveBeenCalled();
    });
  });
});

describe('setupConsoleOwnerTracking', () => {
  beforeEach(() => {
    nextId = 1;
    vi.clearAllMocks();
    electronMocks.getAllWindows.mockReturnValue([]);
  });

  function setup() {
    const tracker = setupConsoleOwnerTracking();
    const appHandlers = new Map<string, (event: unknown, win: MockWindow) => void>(
      electronMocks.appOn.mock.calls.map(([event, cb]) => [event, cb]),
    );
    const invokeCall = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === GET_OWNER_STATUS_CHANNEL,
    );
    return {
      tracker,
      created: appHandlers.get('browser-window-created')!,
      focused: appHandlers.get('browser-window-focus')!,
      getOwnerStatus: invokeCall?.[1] as (event: { sender: { id: number } }) => {
        isOwner: boolean;
      },
    };
  }

  it('wires window-created, window-focus, and the owner-status invoke handler', () => {
    const { created, focused, getOwnerStatus } = setup();
    expect(created).toBeDefined();
    expect(focused).toBeDefined();
    expect(getOwnerStatus).toBeDefined();
  });

  it('answers per-sender owner status over the invoke channel', () => {
    const { created, focused, getOwnerStatus } = setup();
    const a = makeWindow();
    const b = makeWindow();
    created({}, a);
    created({}, b);

    expect(getOwnerStatus({ sender: { id: a.webContents.id } })).toEqual({ isOwner: true });
    expect(getOwnerStatus({ sender: { id: b.webContents.id } })).toEqual({ isOwner: false });

    focused({}, b);
    expect(getOwnerStatus({ sender: { id: a.webContents.id } })).toEqual({ isOwner: false });
    expect(getOwnerStatus({ sender: { id: b.webContents.id } })).toEqual({ isOwner: true });
  });
});
