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
  noteFrameFocused,
  rendererFor,
  setNonFrameWindowPredicate,
  shownMachine,
  trackFrameFocus,
} from '../frames';
import { writeWindowRail } from '../machine-rail-state';
import { setMainWindow } from '../state';
import {
  bindMachineViewToBackend,
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

function makeWindow(backendId: string) {
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
  stampWindowWithBackend(window, backendId);
  return { window, own: own as unknown as WebContents };
}

/** A window holding `home` plus rail machines, with views started for `started`. */
function makeRailWindow(home: string, added: string[], started: string[] = []) {
  const frame = makeWindow(home);
  writeWindowRail(frame.window, { machineIds: [home, ...added], selectedId: home });
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
  setNonFrameWindowPredicate(null);
});

describe('frames without a rail', () => {
  it('holds and shows only the machine its own page renders', () => {
    const { window, own } = makeWindow('host-A');
    expect(frameMachines(window)).toEqual(['host-A']);
    expect(shownMachine(window)).toBe('host-A');
    expect(rendererFor(window, 'host-A')).toBe(own);
    expect(rendererFor(window, 'host-B')).toBeNull();
  });
});

describe('frames with a machine rail', () => {
  it('lists its machines in rail order and serves each from its own renderer', () => {
    const { window, own, views } = makeRailWindow('local', ['host-B', 'host-C'], ['host-B']);
    expect(frameMachines(window)).toEqual(['local', 'host-B', 'host-C']);
    expect(rendererFor(window, 'local')).toBe(own);
    expect(rendererFor(window, 'host-B')).toBe(views.get('host-B'));
    // Listed, but its renderer has not started yet.
    expect(rendererFor(window, 'host-C')).toBeNull();
  });

  it('shows the machine whose view is on screen, and its own machine otherwise', () => {
    const { window, views } = makeRailWindow('local', ['host-B'], ['host-B']);
    expect(shownMachine(window)).toBe('local');
    setShownMachineView(window, views.get('host-B')!);
    expect(shownMachine(window)).toBe('host-B');
    setShownMachineView(window, null);
    expect(shownMachine(window)).toBe('local');
  });

  it('shows its own machine again once the shown view is gone', () => {
    const { window, views } = makeRailWindow('local', ['host-B'], ['host-B']);
    const view = views.get('host-B')!;
    setShownMachineView(window, view);
    view.destroy();
    expect(shownMachine(window)).toBe('local');
    expect(rendererFor(window, 'host-B')).toBeNull();
  });
});

describe('framesHolding', () => {
  it('returns every frame that holds the machine, as its own page or in its rail', () => {
    const railed = makeRailWindow('local', ['host-B']);
    const own = makeWindow('host-B');
    makeWindow('host-C');
    expect(framesHolding('host-B')).toEqual([railed.window, own.window]);
    expect(framesHolding('local')).toEqual([railed.window]);
    expect(framesHolding('host-D')).toEqual([]);
  });

  it('skips closed windows and windows that are not frames', () => {
    const closed = makeWindow('host-B');
    const dock = makeWindow('host-B');
    const frame = makeWindow('host-B');
    closed.window.destroy();
    setNonFrameWindowPredicate((window) => window === dock.window);
    expect(framesHolding('host-B')).toEqual([frame.window]);
  });
});

describe('focusedFrame', () => {
  it('is the focused frame', () => {
    const main = makeWindow('local');
    const other = makeWindow('host-B');
    setMainWindow(main.window);
    electron.focused = other.window;
    expect(focusedFrame()).toBe(other.window);
  });

  it('falls back to the main window when the focused window is not a frame or none is focused', () => {
    const main = makeWindow('local');
    const dock = makeWindow('host-B');
    setMainWindow(main.window);
    setNonFrameWindowPredicate((window) => window === dock.window);
    electron.focused = dock.window;
    expect(focusedFrame()).toBe(main.window);
    electron.focused = null;
    expect(focusedFrame()).toBe(main.window);
  });

  it('is null when neither the focused nor the main window is a live frame', () => {
    const main = makeWindow('local');
    setMainWindow(main.window);
    main.window.destroy();
    expect(focusedFrame()).toBeNull();
    const dock = makeWindow('host-B');
    setMainWindow(dock.window);
    electron.focused = dock.window;
    setNonFrameWindowPredicate((window) => window === dock.window);
    expect(focusedFrame()).toBeNull();
  });
});

describe('framesByRecentFocus', () => {
  it('lists the most recently focused frame first, then the others in window order', () => {
    const a = makeWindow('local');
    const b = makeWindow('host-B');
    const c = makeWindow('host-C');
    expect(framesByRecentFocus()).toEqual([a.window, b.window, c.window]);
    noteFrameFocused(c.window);
    noteFrameFocused(b.window);
    expect(framesByRecentFocus()).toEqual([b.window, c.window, a.window]);
  });

  it('skips closed windows and windows that are not frames', () => {
    const closed = makeWindow('local');
    const dock = makeWindow('host-B');
    const frame = makeWindow('host-C');
    noteFrameFocused(dock.window);
    noteFrameFocused(closed.window);
    closed.window.destroy();
    setNonFrameWindowPredicate((window) => window === dock.window);
    expect(framesByRecentFocus()).toEqual([frame.window]);
  });

  it('records app focus once tracking starts, starting with the focused window', () => {
    const a = makeWindow('local');
    const b = makeWindow('host-B');
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
