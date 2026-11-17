import { EventEmitter } from 'node:events';
import type { BrowserWindow as WindowType, WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  windows: [] as object[],
  owners: new Map<object, object>(),
  focused: null as object | null,
  appOn: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { on: electron.appOn },
  BrowserWindow: {
    fromWebContents: (sender: object) => electron.owners.get(sender) ?? null,
    getAllWindows: () => electron.windows,
    getFocusedWindow: () => electron.focused,
  },
}));

import {
  focusedFrame,
  frameMachines,
  framesByRecentFocus,
  framesHolding,
  frameToShow,
  mostRecentFrame,
  isMachineInUse,
  isMachineRendered,
  noteFrameFocused,
  rendererFor,
  shownMachine,
  trackFrameFocus,
} from '../frames';
import { writeWindowRail } from '../machine-rail-state';
import { setMainWindow } from '../state';
import {
  bindMachineViewToBackend,
  markFrameWindow,
  setShownMachineView,
  stampWindowWithBackend,
} from '../window-backend';

function makeContents() {
  let destroyed = false;
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: {},
    isDestroyed: () => destroyed,
    isOffscreen: () => false,
    destroy: () => {
      destroyed = true;
    },
  });
  return contents;
}

function makeWindowShape() {
  let destroyed = false;
  const own = makeContents();
  const window = Object.assign(new EventEmitter(), {
    webContents: own,
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true;
    },
  }) as unknown as WindowType & { destroy(): void };
  electron.owners.set(own, window);
  electron.windows.push(window);
  return { window, own: own as unknown as WebContents };
}

/** A window that is not a frame (dock, HUD): its own page renders `backendId`. */
function makePlainWindow(backendId: string) {
  const plain = makeWindowShape();
  stampWindowWithBackend(plain.window, backendId);
  return plain;
}

/**
 * A frame holding `machines` (the first selected), with views started for
 * `started`. Its own page renders no machine.
 */
function makeFrame(machines: string[], started: string[] = []) {
  const frame = makeWindowShape();
  markFrameWindow(frame.window);
  writeWindowRail(frame.window, { machineIds: machines, selectedId: machines[0] });
  const views = new Map<string, WebContents & { destroy(): void }>();
  for (const id of started) {
    const view = makeContents() as unknown as WebContents & { destroy(): void };
    bindMachineViewToBackend(frame.window, view, id);
    views.set(id, view);
  }
  return { ...frame, views };
}

afterEach(() => {
  electron.windows.length = 0;
  electron.owners.clear();
  electron.focused = null;
  setMainWindow(null);
});

describe('a frame', () => {
  it('lists its machines in rail order and serves each from its own view, never its page', () => {
    const { window, own, views } = makeFrame(['local', 'host-B', 'host-C'], ['local', 'host-B']);
    expect(frameMachines(window)).toEqual(['local', 'host-B', 'host-C']);
    expect(rendererFor(window, 'local')).toBe(views.get('local'));
    expect(rendererFor(window, 'host-B')).toBe(views.get('host-B'));
    expect(rendererFor(window, 'local')).not.toBe(own);
    // Listed, but its view has not started yet.
    expect(rendererFor(window, 'host-C')).toBeNull();
  });

  it('shows the machine whose view is on screen, else its selection', () => {
    const { window, views } = makeFrame(['local', 'host-B'], ['local', 'host-B']);
    setShownMachineView(window, views.get('host-B')!);
    expect(shownMachine(window)).toBe('host-B');
    setShownMachineView(window, views.get('local')!);
    expect(shownMachine(window)).toBe('local');
    const unstarted = makeFrame(['host-C']);
    expect(shownMachine(unstarted.window)).toBe('host-C');
  });

  it('forgets a machine whose view is gone', () => {
    const { window, views } = makeFrame(['local', 'host-B'], ['local', 'host-B']);
    const view = views.get('host-B')!;
    setShownMachineView(window, view);
    view.destroy();
    expect(rendererFor(window, 'host-B')).toBeNull();
    expect(shownMachine(window)).toBe('local');
  });
});

describe('a window that is not a frame', () => {
  it('holds no machine, shows the machine it is stamped with, and serves none', () => {
    const { window } = makePlainWindow('host-A');
    expect(frameMachines(window)).toEqual([]);
    expect(shownMachine(window)).toBe('host-A');
    expect(rendererFor(window, 'host-A')).toBeNull();
  });
});

describe('framesHolding', () => {
  it('returns every frame that holds the machine, wherever it sits in the rail', () => {
    const a = makeFrame(['local', 'host-B']);
    const b = makeFrame(['host-B']);
    makeFrame(['host-C']);
    expect(framesHolding('host-B')).toEqual([a.window, b.window]);
    expect(framesHolding('local')).toEqual([a.window]);
    expect(framesHolding('host-D')).toEqual([]);
  });

  it('skips closed frames and windows that are not frames', () => {
    const closed = makeFrame(['host-B']);
    makePlainWindow('host-B');
    const frame = makeFrame(['host-B']);
    closed.window.destroy();
    expect(framesHolding('host-B')).toEqual([frame.window]);
  });
});

describe('machine use', () => {
  it('is in use while a frame holds it or a dock or HUD window is bound to it', () => {
    makeFrame(['local', 'host-B']);
    const hud = makePlainWindow('host-C');
    expect(isMachineInUse('host-B')).toBe(true);
    expect(isMachineInUse('host-C')).toBe(true);
    expect(isMachineInUse('host-D')).toBe(false);
    hud.window.destroy();
    expect(isMachineInUse('host-C')).toBe(false);
  });

  it('is rendered only by a started view or a window bound to it', () => {
    const frame = makeFrame(['local', 'host-B'], ['local']);
    makePlainWindow('host-C');
    expect(isMachineRendered('local')).toBe(true);
    expect(isMachineRendered('host-B')).toBe(false);
    expect(isMachineRendered('host-C')).toBe(true);
    frame.views.get('local')!.destroy();
    expect(isMachineRendered('local')).toBe(false);
  });
});

describe('focusedFrame', () => {
  it('is the focused frame', () => {
    const main = makeFrame(['local']);
    const other = makeFrame(['host-B']);
    setMainWindow(main.window);
    electron.focused = other.window;
    expect(focusedFrame()).toBe(other.window);
  });

  it('falls back to the main window when the focused window is not a frame or none is focused', () => {
    const main = makeFrame(['local']);
    const dock = makePlainWindow('host-B');
    setMainWindow(main.window);
    electron.focused = dock.window;
    expect(focusedFrame()).toBe(main.window);
    electron.focused = null;
    expect(focusedFrame()).toBe(main.window);
  });

  it('is null when neither the focused nor the main window is a live frame', () => {
    const main = makeFrame(['local']);
    setMainWindow(main.window);
    main.window.destroy();
    expect(focusedFrame()).toBeNull();
    const dock = makePlainWindow('host-B');
    setMainWindow(dock.window);
    electron.focused = dock.window;
    expect(focusedFrame()).toBeNull();
  });
});

describe('framesByRecentFocus', () => {
  it('lists the most recently focused frame first, then the others in window order', () => {
    const a = makeFrame(['local']);
    const b = makeFrame(['host-B']);
    const c = makeFrame(['host-C']);
    expect(framesByRecentFocus()).toEqual([a.window, b.window, c.window]);
    noteFrameFocused(c.window);
    noteFrameFocused(b.window);
    expect(framesByRecentFocus()).toEqual([b.window, c.window, a.window]);
  });

  it('skips closed frames and windows that are not frames', () => {
    const closed = makeFrame(['local']);
    const dock = makePlainWindow('host-B');
    const frame = makeFrame(['host-C']);
    noteFrameFocused(dock.window);
    noteFrameFocused(closed.window);
    closed.window.destroy();
    expect(framesByRecentFocus()).toEqual([frame.window]);
  });

  it('records app focus once tracking starts, starting with the focused window', () => {
    const a = makeFrame(['local']);
    const b = makeFrame(['host-B']);
    electron.focused = b.window;
    trackFrameFocus();
    trackFrameFocus();
    const focusListeners = electron.appOn.mock.calls.filter(
      ([event]) => event === 'browser-window-focus',
    );
    expect(focusListeners).toHaveLength(1);
    expect(framesByRecentFocus()[0]).toBe(b.window);
    (focusListeners[0][1] as (event: unknown, window: unknown) => void)({}, a.window);
    expect(framesByRecentFocus()).toEqual([a.window, b.window]);
  });
});

describe('frameToShow', () => {
  it('is null when no frame holds the machine', () => {
    makeFrame(['local']);
    makePlainWindow('host-B');
    expect(frameToShow('host-B')).toBeNull();
  });

  it('prefers the given frame when it holds the machine, even unfocused', () => {
    const a = makeFrame(['local', 'host-B']);
    const b = makeFrame(['host-B']);
    electron.focused = a.window;
    expect(frameToShow('host-B', b.window)).toBe(b.window);
    const c = makeFrame(['host-C']);
    expect(frameToShow('host-B', c.window)).toBe(a.window);
  });

  it('prefers the focused frame, then the most recently focused, then window order', () => {
    const a = makeFrame(['host-B']);
    const b = makeFrame(['local', 'host-B']);
    const other = makeFrame(['host-C']);
    expect(frameToShow('host-B')).toBe(a.window);
    noteFrameFocused(b.window);
    noteFrameFocused(other.window);
    expect(frameToShow('host-B')).toBe(b.window);
    electron.focused = a.window;
    expect(frameToShow('host-B')).toBe(a.window);
  });

  it('picks a frame that holds the machine without showing it', () => {
    const { window } = makeFrame(['local', 'host-B'], ['local']);
    expect(shownMachine(window)).toBe('local');
    expect(frameToShow('host-B')).toBe(window);
  });
});

describe('mostRecentFrame', () => {
  it('is the focused frame, else the most recently focused one, else null', () => {
    expect(mostRecentFrame()).toBeNull();
    const a = makeFrame(['local']);
    const b = makeFrame(['host-B']);
    const dock = makePlainWindow('host-C');
    expect(mostRecentFrame()).toBe(a.window);
    noteFrameFocused(b.window);
    electron.focused = dock.window;
    expect(mostRecentFrame()).toBe(b.window);
    electron.focused = a.window;
    expect(mostRecentFrame()).toBe(a.window);
  });
});
