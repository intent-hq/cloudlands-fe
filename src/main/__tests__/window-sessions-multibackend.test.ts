/**
 * Saved frames across machines.
 *
 * Every app window is a frame whose machines are views; window-frames.json
 * saves each frame's machines with their pages (window-sessions.json, the
 * older per-backend file, is migrated once). The rail owner is stood in for
 * by a test frame opener that starts a view for the shown machine. This
 * suite covers:
 *   - per-backend save/restore (one backend's save never clobbers another's),
 *   - lazy migration of a legacy top-level array into the `local` bucket,
 *   - `restoreWindowsForBackend` (restore a backend's saved layout, or open a
 *     fresh window) and the open/close-per-backend hooks,
 *   - the renderer-window gate (`../renderer-window-gate.ts`): no creation
 *     path constructs a `BrowserWindow` before the boot flow releases it.
 */

import * as fs from 'fs';
import fsAsync from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPath = vi.fn();
const mockGetDisplayMatching = vi.fn();

/** A live BrowserWindow test double: constructable + destroyable + URL-bearing. */
const { FakeBrowserWindow, mockRegisterWindowTitleListener } = vi.hoisted(() => {
  let nextWebContentsId = 1;
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    static focused: FakeBrowserWindow | null = null;
    backendId = 'local';
    destroyed = false;
    minimized = false;
    fullScreen = false;
    bounds: { x: number; y: number; width: number; height: number };
    handlers = new Map<string, (...args: unknown[]) => void>();
    private url = 'about:blank';
    webContents = {
      id: nextWebContentsId++,
      on: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => this.destroyed,
      getURL: () => this.url,
      session: { clearCache: () => Promise.resolve() },
    };

    constructor(opts?: { x: number; y: number; width: number; height: number }) {
      this.bounds = opts
        ? { x: opts.x, y: opts.y, width: opts.width, height: opts.height }
        : { x: 0, y: 0, width: 1200, height: 800 };
      FakeBrowserWindow.instances.push(this);
    }

    static getAllWindows(): FakeBrowserWindow[] {
      return FakeBrowserWindow.instances.filter((w) => !w.destroyed);
    }

    static getFocusedWindow(): FakeBrowserWindow | null {
      return FakeBrowserWindow.focused;
    }

    static fromWebContents(
      webContents: FakeBrowserWindow['webContents'],
    ): FakeBrowserWindow | null {
      return FakeBrowserWindow.instances.find((w) => w.webContents === webContents) ?? null;
    }

    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
    getBounds() {
      return this.bounds;
    }
    loadURL(url: string) {
      this.url = url;
      return Promise.resolve();
    }
    setURLForTest(url: string) {
      this.url = url;
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }
    once() {
      return this;
    }
    isMinimized() {
      return this.minimized;
    }
    isFullScreen() {
      return this.fullScreen;
    }
    setFullScreen = vi.fn((flag: boolean) => {
      this.fullScreen = flag;
    });
    restore = vi.fn(() => {
      this.minimized = false;
    });
    show = vi.fn();
    focus = vi.fn(() => {
      FakeBrowserWindow.focused = this;
    });
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.(...args);
    }
  }
  return { FakeBrowserWindow, mockRegisterWindowTitleListener: vi.fn() };
});

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => mockGetPath(name),
    dock: undefined,
  },
  BrowserWindow: FakeBrowserWindow,
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: (bounds: unknown) => mockGetDisplayMatching(bounds),
  },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: { createFromPath: vi.fn() },
}));

vi.mock('../state', () => ({
  getMainWindow: vi.fn(),
  setMainWindow: vi.fn(),
}));

vi.mock('../../features/deeplink/deep-link-handler', () => ({
  DeepLinkHandler: class {},
}));

vi.mock('../utils/resolve-app-title', () => ({
  resolveAppTitle: () => 'Intent',
  registerWindowTitleListener: mockRegisterWindowTitleListener,
}));

import type { DeepLinkHandler } from '../../features/deeplink/deep-link-handler';
import { consumePendingDeepLinks } from '../../features/deeplink/main/pending-deep-links';
import { _resetHudWindowRefForTests, isTrackedHudWindow, registerHudWindow } from '../hud-window';
import {
  _resetRendererWindowGateForTests,
  markRendererWindowsAllowed,
} from '../renderer-window-gate';
import { getMainWindow, setMainWindow } from '../state';
import { isDockAnnotationWindow, registerDockAnnotationWindow } from '../dock-annotation-identity';
import {
  _resetWindowSessionsCacheForTests,
  captureWindowSessionsSnapshot,
  closeWindowsForBackend,
  clearWindowSessionsSnapshot,
  createWindow,
  createWindowForDeepLink,
  createWindowForSession,
  discardSavedWindowFrames,
  ensureLocalWindowBeforeClosingBackend,
  getWindowFramesPath,
  getBackendIdForWebContents,
  getFocusedWindowBackendId,
  markWindowSessionTeardown,
  openOrFocusWindowsForBackend,
  unmarkWindowSessionTeardown,
  restoreAllBackendWindowSessions,
  restoreWindowsForBackend,
  saveAllWindowSessions,
  setOnLastWindowClosedForBackend,
  showWorkspaceInBackendWindow,
} from '../window';
import {
  bindMachineViewToBackend,
  getShownRendererWebContents,
  isFrameWindow,
  markFrameWindow,
  setShownMachineView,
} from '../window-backend';
import {
  readWindowRail,
  setFrameMachineCommands,
  setFrameOpener,
  setMachineRailEnabledFlag,
  writeWindowRail,
} from '../machine-rail-state';
import { noteFrameFocused, rendererFor, shownMachine } from '../frames';
import type { FrameMachineSession } from '../../shared/types/machine-rail';

interface FrameProbe {
  /** The machine a frame shows (the stamp of any other window). */
  readonly machine: string;
  /** The page a frame's shown machine view shows (any other window's own URL). */
  readonly page: string;
}
type FakeWindow = InstanceType<typeof FakeBrowserWindow> & FrameProbe;

Object.defineProperties(FakeBrowserWindow.prototype, {
  machine: {
    get(this: FakeWindow) {
      return isFrameWindow(this as never) ? shownMachine(this as never) : this.backendId;
    },
  },
  page: {
    get(this: FakeWindow) {
      if (!isFrameWindow(this as never)) return this.webContents.getURL();
      const shown = getShownRendererWebContents(this as never);
      return shown === (this.webContents as never) ? 'about:blank' : shown.getURL();
    },
  },
});

/** Pages each frame opened, by window: what the rail owner was asked to open. */
const openedFrames = new Map<unknown, { machines: FrameMachineSession[]; selectedId: string }>();

/** Stand-in for the rail owner: a frame holds its machines and shows a view of the selected one. */
function installFrameOpener(): void {
  setFrameOpener((window, machines, selectedId) => {
    openedFrames.set(window, { machines, selectedId });
    const ids = machines.map((machine) => machine.id);
    writeWindowRail(window, { machineIds: ids, selectedId });
    const route = machines.find((machine) => machine.id === selectedId)?.route;
    const view = seedMachineView(
      window as unknown as FakeWindow,
      selectedId,
      `app://workspaces${route ?? '/workspace/new'}`,
    );
    setShownMachineView(window, view as never);
    return view as never;
  });
}

/**
 * A live window: a frame showing `backendId` on `url`, or (HUD, dock, dev
 * console, desktop overlay and about:blank pages) a plain window stamped with it.
 */
function seedLiveWindow(
  url: string,
  bounds = { x: 0, y: 0, width: 1200, height: 800 },
  backendId = 'local',
): FakeWindow {
  const w = new FakeBrowserWindow(bounds) as FakeWindow;
  const path = url === 'about:blank' ? '' : new URL(url).pathname;
  const plain = ['/hud', '/dock', '/dev-console', '/desktop-overlay'];
  if (url === 'about:blank' || plain.some((prefix) => path.startsWith(prefix))) {
    w.backendId = backendId;
    w.setURLForTest(url);
    return w;
  }
  markFrameWindow(w as never);
  w.setURLForTest('app://workspaces/frame');
  writeWindowRail(w as never, { machineIds: [backendId], selectedId: backendId });
  setShownMachineView(w as never, seedMachineView(w, backendId, url) as never);
  return w;
}

/** Older clients' file: migrated once, never written. */
function legacySessionsPath(): string {
  return path.join(mockGetPath('userData') as string, 'window-sessions.json');
}

interface SavedFrame {
  bounds: { x: number; y: number; width: number; height: number };
  isFullScreen?: boolean;
  machines: Array<{ id: string; route?: string }>;
  selectedId: string;
}

function readFramesFile(): { version: number; frames: SavedFrame[] } {
  return JSON.parse(fs.readFileSync(getWindowFramesPath(), 'utf-8'));
}

function readFrames(): SavedFrame[] {
  return readFramesFile().frames;
}

function writeFrames(frames: unknown[]): void {
  fs.writeFileSync(getWindowFramesPath(), JSON.stringify({ version: 1, frames }), 'utf-8');
}

/** A saved frame holding only `id`, on `route`. */
function single(
  id: string,
  route: string,
  bounds = { x: 0, y: 0, width: 1200, height: 800 },
): SavedFrame {
  return { bounds, machines: [{ id, route }], selectedId: id };
}

let nextViewId = 10_000;

/** The renderer links and messages reach: a frame's shown view, any other window's own page. */
function viewOf(window: InstanceType<typeof FakeBrowserWindow>): { id: number; send: unknown } {
  return getShownRendererWebContents(window as never) as never;
}

/** A machine view inside `window`, bound to `id` and showing `url`. */
function seedMachineView(window: InstanceType<typeof FakeBrowserWindow>, id: string, url: string) {
  let page = url;
  const contents = {
    id: nextViewId++,
    getURL: () => page,
    setURLForTest: (next: string) => {
      page = next;
    },
    isDestroyed: () => window.destroyed,
    on: vi.fn(),
    once: vi.fn(),
    send: vi.fn(),
  };
  bindMachineViewToBackend(window as never, contents as never, id);
  return contents;
}

/** Drain every already-queued microtask (and a macrotask turn) without releasing any gate. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('multi-backend window sessions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-sessions-mb-'));
    mockGetPath.mockReset();
    mockGetPath.mockReturnValue(tmpDir);
    mockGetDisplayMatching.mockReset();
    mockGetDisplayMatching.mockReturnValue({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } });
    FakeBrowserWindow.instances = [];
    FakeBrowserWindow.focused = null;
    mockRegisterWindowTitleListener.mockClear();
    _resetWindowSessionsCacheForTests();
    _resetHudWindowRefForTests();
    _resetRendererWindowGateForTests();
    markRendererWindowsAllowed();
    setMachineRailEnabledFlag(false);
    openedFrames.clear();
    installFrameOpener();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('saved frames', () => {
    it('never persists the exact registered dock overlay even before its route is loaded', async () => {
      const main = seedLiveWindow('app://workspaces/work/main', undefined, 'remote-1');
      const overlay = seedLiveWindow('about:blank', undefined, 'remote-1');
      registerDockAnnotationWindow(overlay as never);
      expect(isDockAnnotationWindow(overlay as never)).toBe(true);
      await saveAllWindowSessions();
      expect(readFrames()).toEqual([single('remote-1', '/work/main')]);
      overlay.setURLForTest('app://workspaces/dock-annotation');
      await saveAllWindowSessions();
      expect(readFrames()).toEqual([single('remote-1', '/work/main')]);
      expect(main.isDestroyed()).toBe(false);
      overlay.destroy();
      expect(isDockAnnotationWindow(overlay as never)).toBe(false);
    });

    it('filters saved dock-annotation routes and never recreates an overlay as a normal window', async () => {
      const bounds = { x: 0, y: 0, width: 1000, height: 700 };
      writeFrames([
        single('remote-1', '/dock-annotation', bounds),
        single('remote-1', '/work/main', bounds),
      ]);
      await restoreWindowsForBackend('remote-1');
      expect(
        FakeBrowserWindow.getAllWindows().map((window) => new URL(window.page).pathname),
      ).toEqual(['/work/main']);
      await createWindowForSession({ route: '/dock-annotation', bounds }, false, 'remote-1');
      expect(FakeBrowserWindow.getAllWindows()).toHaveLength(1);
    });

    it('saves every open window as a frame on its own machine, in a version-1 file', async () => {
      const localBounds = { x: 10, y: 20, width: 1200, height: 800 };
      const remoteBounds = { x: 30, y: 40, width: 1000, height: 700 };
      seedLiveWindow('app://workspaces/work/local', localBounds, 'local');
      seedLiveWindow('app://workspaces/work/remote', remoteBounds, 'remote-1');

      await saveAllWindowSessions();

      expect(readFramesFile()).toEqual({
        version: 1,
        frames: [
          single('local', '/work/local', localBounds),
          single('remote-1', '/work/remote', remoteBounds),
        ],
      });
    });

    it('saves every rail machine with the page its view shows, and the machine shown', async () => {
      setMachineRailEnabledFlag(true);
      const window = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      writeWindowRail(window as never, {
        machineIds: ['local', 'remote-1', 'remote-2'],
        selectedId: 'remote-1',
      });
      seedMachineView(window, 'remote-1', 'app://workspaces/workspace/r1');
      // remote-2 has not started a view yet: it saves without a page.

      await saveAllWindowSessions();

      expect(readFrames()).toEqual([
        {
          bounds: window.bounds,
          machines: [
            { id: 'local', route: '/work/local' },
            { id: 'remote-1', route: '/workspace/r1' },
            { id: 'remote-2' },
          ],
          selectedId: 'remote-1',
        },
      ]);
    });

    it('restores only the frames that open on the requested machine', async () => {
      const localBounds = { x: 1, y: 2, width: 1300, height: 850 };
      const remoteBounds = { x: 5, y: 6, width: 1100, height: 720 };
      writeFrames([
        single('local', '/work/l', localBounds),
        single('remote-1', '/work/r', remoteBounds),
      ]);

      await restoreWindowsForBackend('remote-1');

      const live = FakeBrowserWindow.getAllWindows();
      expect(live.map((w) => [w.machine, new URL(w.page).pathname])).toEqual([
        ['remote-1', '/work/r'],
      ]);
      expect(live[0].bounds).toEqual(remoteBounds);
    });

    it('restores at most 20 frames', async () => {
      writeFrames(Array.from({ length: 25 }, (_, i) => single('remote-1', `/w/${i}`)));
      await restoreAllBackendWindowSessions('local', vi.fn().mockResolvedValue({}));
      expect(FakeBrowserWindow.getAllWindows()).toHaveLength(20);
    });

    it('round-trips a saved frame through restore', async () => {
      const bounds = { x: 7, y: 8, width: 1280, height: 820 };
      const window = seedLiveWindow('app://workspaces/work/default', bounds);
      await saveAllWindowSessions();
      window.destroy();
      _resetWindowSessionsCacheForTests();

      await restoreAllBackendWindowSessions('local', vi.fn().mockResolvedValue({}));

      const [restored] = FakeBrowserWindow.getAllWindows();
      expect(restored.machine).toBe('local');
      expect(restored.bounds).toEqual(bounds);
      expect(new URL(restored.page).pathname).toBe('/work/default');
    });

    it('keeps the saved page of a restored window that has not loaded yet', async () => {
      writeFrames([single('remote-1', '/work/r')]);
      await restoreAllBackendWindowSessions('local', vi.fn().mockResolvedValue({}));
      const [restored] = FakeBrowserWindow.getAllWindows();
      restored.setURLForTest('about:blank');

      await saveAllWindowSessions();

      expect(readFrames()).toEqual([single('remote-1', '/work/r')]);
    });

    it('does not restore a window the user closed while others stayed open', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();

      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();
      await saveAllWindowSessions();
      expect(readFrames()).toEqual([single('local', '/work/local', local.bounds)]);

      await openOrFocusWindowsForBackend('remote-1');
      const remoteWindows = FakeBrowserWindow.getAllWindows().filter(
        (window) => window.machine === 'remote-1',
      );
      expect(remoteWindows).toHaveLength(1);
      expect(remoteWindows[0].page).not.toContain('/work/closed');
    });

    it('drops a closed window from disk at close time, even one of two on the same machine', async () => {
      const kept = seedLiveWindow('app://workspaces/work/kept', undefined, 'remote-1');
      const closed = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();
      expect(readFrames()).toHaveLength(2);

      // The close listener alone must update the file — no save may run
      // before a crash or force-quit.
      captureWindowSessionsSnapshot.call(closed as never);
      closed.destroy();

      expect(readFrames()).toEqual([single('remote-1', '/work/kept', kept.bounds)]);
    });

    it('keeps the last window when it closes, so the next launch reopens it', async () => {
      const last = seedLiveWindow('app://workspaces/work/last', undefined, 'remote-1');
      captureWindowSessionsSnapshot.call(last as never);
      last.destroy();

      await saveAllWindowSessions();

      expect(readFrames()).toEqual([single('remote-1', '/work/last', last.bounds)]);
    });

    it('excludes diagnostic windows from persistence and ignores stale saved console routes', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      seedLiveWindow('app://workspaces/dev-console', undefined, 'local');
      await saveAllWindowSessions();
      expect(readFrames()).toEqual([single('local', '/work/local', local.bounds)]);

      for (const window of FakeBrowserWindow.getAllWindows()) window.destroy();
      _resetWindowSessionsCacheForTests();
      writeFrames([single('local', '/dev-console'), single('local', '/work/local')]);
      await restoreAllBackendWindowSessions('local', vi.fn().mockResolvedValue({}));
      expect(FakeBrowserWindow.getAllWindows().map((w) => new URL(w.page).pathname)).toEqual([
        '/work/local',
      ]);
    });

    it('never restores a desktop-control indicator without an active native session', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      seedLiveWindow('app://workspaces/desktop-overlay?kind=glow', undefined, 'local');
      seedLiveWindow('app://workspaces/desktop-overlay?kind=controls', undefined, 'local');
      await saveAllWindowSessions();
      expect(readFrames()).toEqual([single('local', '/work/local', local.bounds)]);

      for (const window of FakeBrowserWindow.getAllWindows()) window.destroy();
      _resetWindowSessionsCacheForTests();
      writeFrames([single('local', '/desktop-overlay'), single('local', '/work/local')]);
      await restoreAllBackendWindowSessions('local', vi.fn().mockResolvedValue({}));
      expect(FakeBrowserWindow.getAllWindows().map((w) => new URL(w.page).pathname)).toEqual([
        '/work/local',
      ]);
    });

    it('a save in flight while a window closes cannot bring the closed window back', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();

      // Park the save's async write mid-flight; the close listener writes
      // synchronously, so only the save is suspended.
      let releaseWrite!: () => void;
      const gate = new Promise<void>((resolve) => (releaseWrite = resolve));
      const realWrite = fsAsync.writeFile.bind(fsAsync);
      const writeSpy = vi
        .spyOn(fsAsync, 'writeFile')
        .mockImplementationOnce(async (...args: Parameters<typeof fsAsync.writeFile>) => {
          await gate;
          return realWrite(...args);
        });
      const inFlight = saveAllWindowSessions();

      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();
      expect(readFrames()).toEqual([single('local', '/work/local', local.bounds)]);

      releaseWrite();
      await inFlight;
      writeSpy.mockRestore();

      expect(readFrames()).toEqual([single('local', '/work/local', local.bounds)]);
    });

    it('macOS close-all discards the layout without deleting or touching the old file', async () => {
      const legacy = JSON.stringify({
        local: [{ route: '/work/old', bounds: { x: 0, y: 0, width: 800, height: 600 } }],
      });
      fs.writeFileSync(legacySessionsPath(), legacy, 'utf-8');
      const window = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      await saveAllWindowSessions();
      captureWindowSessionsSnapshot.call(window as never);
      window.destroy();

      discardSavedWindowFrames();
      await saveAllWindowSessions();

      expect(readFramesFile()).toEqual({ version: 1, frames: [] });
      expect(fs.readFileSync(legacySessionsPath(), 'utf-8')).toBe(legacy);
      const connect = vi.fn().mockResolvedValue({});
      expect(await restoreAllBackendWindowSessions('local', connect)).toBe(false);
      expect(FakeBrowserWindow.getAllWindows()).toHaveLength(0);
    });
  });

  describe('quit/update-install teardown (markWindowSessionTeardown)', () => {
    it('keeps a window closed during app-quit teardown and does not dispose its client', async () => {
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');
      await saveAllWindowSessions();

      markWindowSessionTeardown();
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(readFrames()).toEqual([
        single('local', '/work/local', local.bounds),
        single('remote-1', '/work/remote', remote.bounds),
      ]);
      expect(disposer).not.toHaveBeenCalled();
    });

    it('teardown closes keep every window for the final save', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      markWindowSessionTeardown();
      captureWindowSessionsSnapshot.call(local as never);
      local.destroy();
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      // All windows are gone; the save falls back to the frames captured
      // before the first teardown close.
      await saveAllWindowSessions();
      expect(readFrames()).toEqual([
        single('local', '/work/local', local.bounds),
        single('remote-1', '/work/remote', remote.bounds),
      ]);
    });

    it('unmark (aborted update install) makes later closes deliberate again', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();

      markWindowSessionTeardown();
      unmarkWindowSessionTeardown();
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(readFrames()).toEqual([single('local', '/work/local', local.bounds)]);
    });
  });

  describe('pooled client disposal on last window close', () => {
    // A frame's machines are released by the rail owner when the frame
    // closes; window.ts disposes the client of a window that is not a frame
    // (a HUD) when nothing else uses its machine.
    const hud = (backendId: string) => seedLiveWindow('app://workspaces/hud', undefined, backendId);

    it("leaves a closing frame's machines to the rail owner", () => {
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(disposer).not.toHaveBeenCalled();
    });

    it('disposes a remote client when its last window, a HUD, is explicitly closed', () => {
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = hud('remote-1');

      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(disposer).toHaveBeenCalledExactlyOnceWith('remote-1');
    });

    it('does not dispose while a frame still holds the machine', () => {
      setMachineRailEnabledFlag(true);
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      writeWindowRail(local as never, { machineIds: ['local', 'remote-1'], selectedId: 'local' });
      const remote = hud('remote-1');

      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(disposer).not.toHaveBeenCalled();
    });

    it('never disposes the local backend (sidecar management stays alive)', () => {
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      const local = hud('local');
      seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      captureWindowSessionsSnapshot.call(local as never);
      local.destroy();

      expect(disposer).not.toHaveBeenCalled();
    });

    it('does not dispose on a whole-process last-window close (quit path)', () => {
      // No surviving window → window-all-closed / quit territory;
      // gracefulShutdown() owns client teardown there.
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      const remote = hud('remote-1');

      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(disposer).not.toHaveBeenCalled();
    });

    it('a throwing disposer still drops the closed window from disk', async () => {
      setOnLastWindowClosedForBackend(() => {
        throw new Error('dispose failed');
      });
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = hud('remote-1');
      await saveAllWindowSessions();
      expect(readFrames()).toHaveLength(2);

      expect(() => captureWindowSessionsSnapshot.call(remote as never)).not.toThrow();
      remote.destroy();

      expect(readFrames()).toEqual([single('local', '/work/local', local.bounds)]);
    });
  });

  describe('startup migration from window-sessions.json', () => {
    const bounds = { x: 3, y: 4, width: 1500, height: 950 };

    it('restores an old multi-backend file with rails, and writes the frames file once', async () => {
      const legacy = JSON.stringify({
        local: [
          {
            route: '/work/l',
            bounds,
            rail: { machineIds: ['remote-2'], selectedId: 'remote-2' },
          },
        ],
        'remote-1': [{ route: '/work/r1', bounds, isFullScreen: true }],
      });
      fs.writeFileSync(legacySessionsPath(), legacy, 'utf-8');

      const restored = await restoreAllBackendWindowSessions(
        'local',
        vi.fn().mockResolvedValue({}),
      );

      expect(restored).toBe(true);
      // Each old session reopens as a frame on its bucket's machine and its
      // rail machines, showing the rail's selection.
      expect([...openedFrames.values()]).toEqual([
        {
          machines: [{ id: 'local', route: '/work/l' }, { id: 'remote-2' }],
          selectedId: 'remote-2',
        },
        { machines: [{ id: 'remote-1', route: '/work/r1' }], selectedId: 'remote-1' },
      ]);
      expect(readFramesFile()).toEqual({
        version: 1,
        frames: [
          {
            bounds,
            machines: [{ id: 'local', route: '/work/l' }, { id: 'remote-2' }],
            selectedId: 'remote-2',
          },
          {
            bounds,
            isFullScreen: true,
            machines: [{ id: 'remote-1', route: '/work/r1' }],
            selectedId: 'remote-1',
          },
        ],
      });
      // Update compatibility: an older client still finds its own file.
      expect(fs.readFileSync(legacySessionsPath(), 'utf-8')).toBe(legacy);
    });

    it('restores the oldest bare-array file as local windows', async () => {
      fs.writeFileSync(legacySessionsPath(), JSON.stringify([{ route: '/work/legacy', bounds }]));

      const restored = await restoreAllBackendWindowSessions('local', vi.fn());

      expect(restored).toBe(true);
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(1);
      expect(live[0].machine).toBe('local');
      expect(live[0].page).toContain('/work/legacy');
    });

    it('never touches the old file when saving after a migration', async () => {
      const legacy = JSON.stringify([{ route: '/work/legacy', bounds }]);
      fs.writeFileSync(legacySessionsPath(), legacy, 'utf-8');
      await restoreAllBackendWindowSessions('local', vi.fn().mockResolvedValue({}));
      seedLiveWindow('app://workspaces/work/new', bounds, 'remote-1');

      await saveAllWindowSessions();

      expect(fs.readFileSync(legacySessionsPath(), 'utf-8')).toBe(legacy);
      expect(readFrames().map((frame) => frame.machines[0])).toEqual([
        { id: 'local', route: '/work/legacy' },
        { id: 'remote-1', route: '/work/new' },
      ]);
    });

    it('migrates again when an older client saved after this one (downgrade, then upgrade)', async () => {
      writeFrames([single('local', '/work/stale')]);
      const past = new Date(Date.now() - 60_000);
      fs.utimesSync(getWindowFramesPath(), past, past);
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({ local: [{ route: '/work/newer', bounds }] }),
      );

      await restoreAllBackendWindowSessions('local', vi.fn().mockResolvedValue({}));

      expect(FakeBrowserWindow.getAllWindows().map((w) => new URL(w.page).pathname)).toEqual([
        '/work/newer',
      ]);
    });

    it('prefers the frames file once it is newer than the old file', async () => {
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({ local: [{ route: '/work/old', bounds }] }),
      );
      const past = new Date(Date.now() - 60_000);
      fs.utimesSync(legacySessionsPath(), past, past);
      writeFrames([single('local', '/work/current')]);

      await restoreAllBackendWindowSessions('local', vi.fn().mockResolvedValue({}));

      expect(FakeBrowserWindow.getAllWindows().map((w) => new URL(w.page).pathname)).toEqual([
        '/work/current',
      ]);
    });

    it('drops machines that are no longer saved and opens the frame on the next one', async () => {
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({
          forgotten: [
            {
              route: '/work/gone',
              bounds,
              rail: { machineIds: ['remote-2'], selectedId: 'remote-2' },
            },
          ],
        }),
      );
      const connect = vi.fn((id: string) =>
        id === 'forgotten'
          ? Promise.reject(new Error('Backend connection not found'))
          : Promise.resolve({}),
      );

      await restoreAllBackendWindowSessions('local', connect);

      const live = FakeBrowserWindow.getAllWindows();
      expect(live.map((w) => w.machine)).toEqual(['remote-2']);
      expect(new URL(live[0].page).pathname).toBe('/workspace/new');
    });

    it.each([
      ['not JSON', '{oops'],
      ['a string', '"corrupt"'],
      ['buckets of junk', JSON.stringify({ local: [null, { route: 1 }], 'remote-1': 'x' })],
    ])(
      'restores nothing from a corrupt old file (%s) and leaves it in place',
      async (_label, raw) => {
        fs.writeFileSync(legacySessionsPath(), raw, 'utf-8');

        const restored = await restoreAllBackendWindowSessions(
          'local',
          vi.fn().mockResolvedValue({}),
        );

        expect(restored).toBe(false);
        expect(FakeBrowserWindow.getAllWindows()).toHaveLength(0);
        expect(fs.readFileSync(legacySessionsPath(), 'utf-8')).toBe(raw);
      },
    );

    it('restores nothing from a corrupt frames file', async () => {
      fs.writeFileSync(getWindowFramesPath(), '{oops', 'utf-8');
      const restored = await restoreAllBackendWindowSessions(
        'local',
        vi.fn().mockResolvedValue({}),
      );
      expect(restored).toBe(false);
    });
  });

  describe('display-aware validation + fullscreen (multi-monitor restore)', () => {
    it('restores a session onto its own display instead of resetting to primary', async () => {
      // Bounds on a secondary monitor to the right of the primary — they fail
      // the primary-workArea visibility check, so this regresses if validation
      // goes back to screen.getPrimaryDisplay().
      const secondaryWorkArea = { x: 1920, y: 0, width: 2560, height: 1415 };
      mockGetDisplayMatching.mockReturnValue({ workArea: secondaryWorkArea });
      const bounds = { x: 2000, y: 100, width: 1200, height: 800 };
      writeFrames([single('local', '/work/second', bounds)]);

      await restoreWindowsForBackend('local');

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(mockGetDisplayMatching).toHaveBeenCalledWith(bounds);
      expect(window.bounds).toEqual(bounds);
    });

    it('falls back to the matched display work area for off-screen bounds', async () => {
      // A disconnected monitor: getDisplayMatching returns the nearest live
      // display, whose work area the saved bounds no longer intersect.
      const nearestWorkArea = { x: 0, y: 0, width: 1920, height: 1080 };
      mockGetDisplayMatching.mockReturnValue({ workArea: nearestWorkArea });
      const bounds = { x: 99999, y: 99999, width: 1200, height: 800 };
      writeFrames([single('local', '/work/gone', bounds)]);

      await restoreWindowsForBackend('local');

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(window.bounds).toEqual(nearestWorkArea);
    });

    it('createWindow keeps legacy saved bounds that land on a secondary display', async () => {
      const secondaryWorkArea = { x: 1920, y: 0, width: 2560, height: 1415 };
      mockGetDisplayMatching.mockReturnValue({ workArea: secondaryWorkArea });
      const saved = { x: 2100, y: 50, width: 1400, height: 900 };
      fs.writeFileSync(path.join(tmpDir, 'window-bounds.json'), JSON.stringify(saved), 'utf-8');

      await createWindow();

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(window.bounds).toEqual(saved);
    });

    it('createWindow falls back to the matched display work area for off-screen legacy bounds', async () => {
      // Bounds near a since-disconnected secondary display: getDisplayMatching
      // picks the nearest live display, whose work area they no longer
      // intersect. The fallback must land on THAT display's work area, not
      // reset to the primary display.
      const matchedWorkArea = { x: 1920, y: 0, width: 2560, height: 1415 };
      mockGetDisplayMatching.mockReturnValue({ workArea: matchedWorkArea });
      const saved = { x: 99999, y: 99999, width: 1400, height: 900 };
      fs.writeFileSync(path.join(tmpDir, 'window-bounds.json'), JSON.stringify(saved), 'utf-8');

      await createWindow();

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(window.bounds).toEqual(matchedWorkArea);
    });

    it('captures isFullScreen in the saved frame', async () => {
      const bounds = { x: 1920, y: 0, width: 2560, height: 1440 };
      const window = seedLiveWindow('app://workspaces/work/fs', bounds);
      window.fullScreen = true;

      await saveAllWindowSessions();

      expect(readFrames()).toEqual([
        { ...single('local', '/work/fs', bounds), isFullScreen: true },
      ]);
    });

    it('restores a fullscreen frame via setFullScreen(true)', async () => {
      const bounds = { x: 1920, y: 0, width: 2560, height: 1440 };
      mockGetDisplayMatching.mockReturnValue({
        workArea: { x: 1920, y: 0, width: 2560, height: 1415 },
      });
      writeFrames([{ ...single('local', '/work/fs', bounds), isFullScreen: true }]);

      await restoreWindowsForBackend('local');

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(window.setFullScreen).toHaveBeenCalledWith(true);
      expect(window.isFullScreen()).toBe(true);
    });

    it('does not enter fullscreen for legacy sessions without the flag', async () => {
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({ local: [{ route: '/work/plain', bounds }] }),
        'utf-8',
      );

      await restoreWindowsForBackend('local');

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(window.setFullScreen).not.toHaveBeenCalled();
      expect(window.isFullScreen()).toBe(false);
    });
  });

  describe('restoreWindowsForBackend', () => {
    it('registers the title listener for every fresh and restored window', async () => {
      await createWindow();
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({ 'remote-a': [{ route: '/hud', bounds }] }),
        'utf-8',
      );

      await restoreWindowsForBackend('remote-a');

      expect(mockRegisterWindowTitleListener.mock.calls.map(([window]) => window)).toEqual(
        FakeBrowserWindow.getAllWindows(),
      );
    });

    it('opens restored frames on their saved backend bucket', async () => {
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({
          'remote-a': [{ route: '/work/a', bounds }],
          'remote-b': [{ route: '/work/b', bounds }],
        }),
        'utf-8',
      );

      await restoreWindowsForBackend('remote-a');
      await restoreWindowsForBackend('remote-b');

      const live = FakeBrowserWindow.getAllWindows() as FakeWindow[];
      expect(live.map((window) => window.machine)).toEqual(['remote-a', 'remote-b']);
    });

    it('opens a fresh window without a backend id on the local machine', async () => {
      await createWindow();

      const [window] = FakeBrowserWindow.getAllWindows() as FakeWindow[];
      expect(window.machine).toBe('local');
    });

    it('defaults an unbound IPC sender to local', () => {
      expect(getBackendIdForWebContents({} as never)).toBe('local');
    });

    it('stamps a restored HUD window with its saved backend bucket (not forced local)', async () => {
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({ 'remote-a': [{ route: '/hud', bounds }] }),
        'utf-8',
      );

      await restoreWindowsForBackend('remote-a');

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(getBackendIdForWebContents(window.webContents as never)).toBe('remote-a');
    });

    it('registers a restored /hud session in the tracked HUD registry', async () => {
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({
          'remote-a': [
            { route: '/hud', bounds },
            { route: '/work/remote', bounds },
          ],
        }),
        'utf-8',
      );

      await restoreWindowsForBackend('remote-a');

      // The /hud window is tracked immediately (before its URL loads), so a
      // concurrent open-HUD request cannot create a duplicate during restore;
      // the plain window is not.
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(2);
      const hud = live.find((w) => w.page.includes('/hud'));
      const plain = live.find((w) => !w.page.includes('/hud'));
      expect(isTrackedHudWindow(hud as never)).toBe(true);
      expect(isTrackedHudWindow(plain as never)).toBe(false);
    });

    it('restores the incoming backend layout', async () => {
      const remoteBounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({ 'remote-1': [{ route: '/work/remote', bounds: remoteBounds }] }),
        'utf-8',
      );

      await restoreWindowsForBackend('remote-1');

      // Exactly one live window restored, loading the incoming backend's route.
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(1);
      expect(live[0].page).toContain('/work/remote');
    });

    it('opens a single fresh window when the incoming backend has no saved sessions', async () => {
      await restoreWindowsForBackend('remote-empty');

      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(1);
      expect(live[0].isDestroyed()).toBe(false);
    });

    it('adds saved remote sessions without destroying an existing local window', async () => {
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      const local = seedLiveWindow('app://workspaces/work/local', bounds, 'local');
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({ 'remote-1': [{ route: '/work/remote', bounds }] }),
        'utf-8',
      );

      await openOrFocusWindowsForBackend('remote-1');

      const live = FakeBrowserWindow.getAllWindows();
      expect(local.isDestroyed()).toBe(false);
      expect(live).toHaveLength(2);
      expect((live[1] as FakeWindow).machine).toBe('remote-1');
    });

    it('focuses an existing backend window instead of restoring duplicates', async () => {
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      await openOrFocusWindowsForBackend('remote-1');

      expect(FakeBrowserWindow.getAllWindows()).toHaveLength(1);
      expect(remote.show).toHaveBeenCalledOnce();
      expect(remote.focus).toHaveBeenCalledOnce();
    });

    it.each([
      ['loaded production HUD', 'app://workspaces/hud', false],
      ['loaded development HUD', 'http://127.0.0.1:5190/hud', false],
      ['tracked HUD before navigation', 'about:blank', true],
    ])(
      'skips a %s and restores the first app window for the selected backend',
      async (_, url, tracked) => {
        const local = seedLiveWindow('app://workspaces/work/local');
        const hud = seedLiveWindow(url, undefined, 'remote-1');
        if (tracked) registerHudWindow(hud as never);
        const closed = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
        closed.destroy();
        const first = seedLiveWindow('app://workspaces/work/first', undefined, 'remote-1');
        const second = seedLiveWindow('app://workspaces/work/second', undefined, 'remote-1');
        first.minimized = true;
        vi.mocked(setMainWindow).mockClear();

        await openOrFocusWindowsForBackend('remote-1');

        expect(FakeBrowserWindow.getAllWindows()).toEqual([local, hud, first, second]);
        expect(first.restore).toHaveBeenCalledOnce();
        expect(first.isMinimized()).toBe(false);
        expect(first.show).toHaveBeenCalledOnce();
        expect(first.focus).toHaveBeenCalledOnce();
        expect(FakeBrowserWindow.getFocusedWindow()).toBe(first);
        expect(setMainWindow).toHaveBeenCalledExactlyOnceWith(first);
        for (const skipped of [local, hud, closed, second]) {
          expect(skipped.restore).not.toHaveBeenCalled();
          expect(skipped.show).not.toHaveBeenCalled();
          expect(skipped.focus).not.toHaveBeenCalled();
        }
      },
    );

    it('reopens a closed backend window and shows a transferred workspace in it', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/old', undefined, 'remote-1');
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();
      FakeBrowserWindow.focused = local;
      vi.mocked(setMainWindow).mockClear();

      await openOrFocusWindowsForBackend('remote-1');
      expect(showWorkspaceInBackendWindow('remote-1', 'ws-moved')).toBe(true);

      const reopened = FakeBrowserWindow.getAllWindows().filter(
        (window) => window.machine === 'remote-1',
      );
      expect(reopened).toHaveLength(1);
      expect(consumePendingDeepLinks(viewOf(reopened[0]).id).actions).toEqual([
        { type: 'open', params: { id: 'ws-moved' } },
      ]);
      expect(consumePendingDeepLinks(viewOf(local).id).actions).toEqual([]);
      expect(viewOf(reopened[0]).send).toHaveBeenCalledWith('deep-link', { pending: true });
      expect(FakeBrowserWindow.getFocusedWindow()).toBe(reopened[0]);
      expect(setMainWindow).toHaveBeenLastCalledWith(reopened[0]);
    });

    it('shows a transferred workspace in an already-open, minimized backend window', async () => {
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');
      remote.minimized = true;

      expect(showWorkspaceInBackendWindow('remote-1', 'ws-moved')).toBe(true);

      expect(FakeBrowserWindow.getAllWindows()).toHaveLength(1);
      expect(remote.restore).toHaveBeenCalledOnce();
      expect(remote.focus).toHaveBeenCalled();
      expect(consumePendingDeepLinks(viewOf(remote).id).actions).toEqual([
        { type: 'open', params: { id: 'ws-moved' } },
      ]);
    });

    it('reports false when no app window is bound to the backend', () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');

      expect(showWorkspaceInBackendWindow('remote-1', 'ws-moved')).toBe(false);
      expect(consumePendingDeepLinks(viewOf(local).id).actions).toEqual([]);
      expect(local.focus).not.toHaveBeenCalled();
    });

    it('opens and focuses a fresh app window when only a live HUD exists', async () => {
      const hud = seedLiveWindow('app://workspaces/hud', undefined, 'remote-1');
      vi.mocked(setMainWindow).mockClear();

      await openOrFocusWindowsForBackend('remote-1');

      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(2);
      expect(live[1].machine).toBe('remote-1');
      expect(new URL(live[1].page).pathname).toBe('/workspace/new');
      expect(FakeBrowserWindow.getFocusedWindow()).toBe(live[1]);
      expect(setMainWindow).toHaveBeenLastCalledWith(live[1]);
      expect(setMainWindow).not.toHaveBeenCalledWith(hud);
      expect(hud.focus).not.toHaveBeenCalled();
    });

    it.each([false, true])(
      'restores saved app sessions without selecting the HUD (live HUD: %s)',
      async (hasLiveHud) => {
        const local = seedLiveWindow('app://workspaces/work/local');
        const hud = hasLiveHud ? seedLiveWindow('about:blank', undefined, 'remote-1') : null;
        if (hud) registerHudWindow(hud as never);
        const bounds = { x: 100, y: 100, width: 1024, height: 768 };
        fs.writeFileSync(
          legacySessionsPath(),
          JSON.stringify({
            'remote-1': [
              { route: '/hud', bounds },
              { route: '/work/first', bounds },
              { route: '/work/second', bounds },
            ],
          }),
        );
        vi.mocked(setMainWindow).mockClear();

        await openOrFocusWindowsForBackend('remote-1');

        const live = FakeBrowserWindow.getAllWindows();
        expect(live).toHaveLength(4);
        const remote = live.filter((window) => window.machine === 'remote-1');
        expect(remote).toHaveLength(3);
        const [restoredHud, first, second] = remote;
        if (hud) expect(restoredHud).toBe(hud);
        expect(new URL(first.page).pathname).toBe('/work/first');
        expect(new URL(second.page).pathname).toBe('/work/second');
        expect(FakeBrowserWindow.getFocusedWindow()).toBe(first);
        expect(setMainWindow).toHaveBeenLastCalledWith(first);
        expect(setMainWindow).not.toHaveBeenCalledWith(restoredHud);
        expect(restoredHud.focus).not.toHaveBeenCalled();
        expect(local.focus).not.toHaveBeenCalled();
      },
    );

    it.each([false, true])(
      'opens a regular app for HUD-only saved sessions (live HUD: %s)',
      async (hasLiveHud) => {
        const hud = hasLiveHud
          ? seedLiveWindow('app://workspaces/hud', undefined, 'remote-1')
          : null;
        const bounds = { x: 100, y: 100, width: 1024, height: 768 };
        fs.writeFileSync(
          legacySessionsPath(),
          JSON.stringify({
            'remote-1': [{ route: '/hud', bounds }],
          }),
        );
        vi.mocked(setMainWindow).mockClear();

        await openOrFocusWindowsForBackend('remote-1');

        const live = FakeBrowserWindow.getAllWindows();
        expect(live).toHaveLength(2);
        const [restoredHud, regular] = live;
        if (hud) expect(restoredHud).toBe(hud);
        expect(regular.machine).toBe('remote-1');
        expect(new URL(regular.page).pathname).toBe('/workspace/new');
        expect(FakeBrowserWindow.getFocusedWindow()).toBe(regular);
        expect(setMainWindow).toHaveBeenLastCalledWith(regular);
        expect(setMainWindow).not.toHaveBeenCalledWith(restoredHud);
        expect(restoredHud.focus).not.toHaveBeenCalled();
      },
    );

    it('resolves the focused window backend for menu and quit consumers', () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      local.focus();
      expect(getFocusedWindowBackendId()).toBe('local');
      remote.focus();
      expect(getFocusedWindowBackendId()).toBe('remote-1');
    });

    it('ignores exact overlay focus and main fallback without inferring ownership from a route', () => {
      const main = seedLiveWindow('app://workspaces/work/main', undefined, 'remote-main');
      const overlay = seedLiveWindow('about:blank', undefined, 'remote-overlay');
      registerDockAnnotationWindow(overlay as never);
      overlay.focus();
      vi.mocked(getMainWindow).mockReturnValueOnce(main as never);
      expect(getFocusedWindowBackendId()).toBe('remote-main');
      vi.mocked(getMainWindow).mockReturnValueOnce(overlay as never);
      expect(getFocusedWindowBackendId()).toBe('local');
      // A frame whose view shows the annotation route is still a frame.
      const unowned = seedLiveWindow('app://workspaces/work/x', undefined, 'remote-unowned');
      (viewOf(unowned) as unknown as { setURLForTest(url: string): void }).setURLForTest(
        'app://workspaces/dock-annotation',
      );
      expect(isDockAnnotationWindow(unowned as never)).toBe(false);
      unowned.focus();
      expect(getFocusedWindowBackendId()).toBe('remote-unowned');
    });

    it('opens a regular local survivor when only a registered overlay would otherwise remain', async () => {
      seedLiveWindow('app://workspaces/work/closing', undefined, 'remote-1');
      const overlay = seedLiveWindow('app://workspaces/dock-annotation', undefined, 'remote-2');
      registerDockAnnotationWindow(overlay as never);
      await ensureLocalWindowBeforeClosingBackend('remote-1');
      const local = FakeBrowserWindow.getAllWindows().find((window) => window.machine === 'local');
      expect(local).toBeDefined();
      expect(overlay.show).not.toHaveBeenCalled();
      expect(overlay.focus).not.toHaveBeenCalled();
    });

    it('never promotes the surviving overlay to main when another backend closes', () => {
      const overlay = seedLiveWindow('app://workspaces/dock-annotation', undefined, 'remote-2');
      registerDockAnnotationWindow(overlay as never);
      const survivor = seedLiveWindow('app://workspaces/work/surviving', undefined, 'remote-2');
      const closing = seedLiveWindow('app://workspaces/work/closing', undefined, 'remote-1');
      vi.mocked(getMainWindow).mockReturnValueOnce(closing as never);
      vi.mocked(setMainWindow).mockClear();
      closeWindowsForBackend('remote-1');
      expect(setMainWindow).toHaveBeenCalledExactlyOnceWith(survivor);
      expect(overlay.isDestroyed()).toBe(false);
    });

    it('closes only windows belonging to the forgotten backend', () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      closeWindowsForBackend('remote-1');

      expect(local.isDestroyed()).toBe(false);
      expect(remote.isDestroyed()).toBe(true);
      expect(FakeBrowserWindow.getAllWindows()).toEqual([local]);
    });

    it('opens local before closing the last backend windows', async () => {
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      await ensureLocalWindowBeforeClosingBackend('remote-1');

      const beforeClose = FakeBrowserWindow.getAllWindows();
      expect(beforeClose).toHaveLength(2);
      expect(getBackendIdForWebContents(beforeClose[1].webContents as never)).toBe('local');

      closeWindowsForBackend('remote-1');
      expect(remote.isDestroyed()).toBe(true);
      expect(FakeBrowserWindow.getAllWindows()).toEqual([beforeClose[1]]);
    });

    it('does not open local when another backend window will survive', async () => {
      const forgotten = seedLiveWindow('app://workspaces/work/a', undefined, 'remote-1');
      const surviving = seedLiveWindow('app://workspaces/work/b', undefined, 'remote-2');

      await ensureLocalWindowBeforeClosingBackend('remote-1');
      closeWindowsForBackend('remote-1');

      expect(forgotten.isDestroyed()).toBe(true);
      expect(surviving.isDestroyed()).toBe(false);
      expect(FakeBrowserWindow.getAllWindows()).toEqual([surviving]);
    });
  });

  describe('frame-aware open and show', () => {
    /** Stand-in for the rail owner's select/add commands. */
    const commands = {
      select: vi.fn((window: FakeWindow, id: string) => {
        const rail = readWindowRail(window as never);
        if (!rail.machineIds.includes(id)) return null;
        const contents =
          rendererFor(window as never, id) ??
          (seedMachineView(window, id, 'app://workspaces/workspace/new') as never);
        writeWindowRail(window as never, { machineIds: rail.machineIds, selectedId: id });
        setShownMachineView(window as never, contents);
        return { window: window as never, contents, ready: Promise.resolve(true) };
      }),
      add: vi.fn(async (window: FakeWindow, id: string) => {
        const rail = readWindowRail(window as never);
        writeWindowRail(window as never, { ...rail, machineIds: [...rail.machineIds, id] });
        commands.select(window, id);
        window.focus();
        return true;
      }),
    };

    /** A frame showing `shown` on `url` that also holds `hidden` (not started). */
    function seedRailFrame(shown: string, hidden: string[], url = 'app://workspaces/work/x') {
      const frame = seedLiveWindow(url, undefined, shown);
      writeWindowRail(frame as never, { machineIds: [shown, ...hidden], selectedId: shown });
      return frame;
    }

    beforeEach(() => {
      commands.select.mockClear();
      commands.add.mockClear();
      setFrameMachineCommands(commands as never);
    });

    afterEach(() => setFrameMachineCommands(null));

    it('opens a machine in a frame that holds it without showing it, selecting it there', async () => {
      setMachineRailEnabledFlag(true);
      const frame = seedRailFrame('local', ['remote-1']);
      vi.mocked(setMainWindow).mockClear();

      await openOrFocusWindowsForBackend('remote-1');

      expect(FakeBrowserWindow.getAllWindows()).toEqual([frame]);
      expect(commands.select).toHaveBeenCalledExactlyOnceWith(frame, 'remote-1');
      expect(frame.machine).toBe('remote-1');
      expect(frame.focus).toHaveBeenCalledOnce();
      expect(setMainWindow).toHaveBeenCalledExactlyOnceWith(frame);
      expect(commands.add).not.toHaveBeenCalled();
    });

    it('prefers the focused frame, then the most recently focused, among frames holding it', async () => {
      setMachineRailEnabledFlag(true);
      const first = seedRailFrame('local', ['remote-1']);
      const second = seedRailFrame('remote-2', ['remote-1']);
      const third = seedRailFrame('remote-3', ['remote-1']);
      noteFrameFocused(third as never);
      noteFrameFocused(second as never);

      await openOrFocusWindowsForBackend('remote-1');
      expect(commands.select).toHaveBeenLastCalledWith(second, 'remote-1');

      FakeBrowserWindow.focused = third;
      await openOrFocusWindowsForBackend('remote-1');
      expect(commands.select).toHaveBeenLastCalledWith(third, 'remote-1');
      expect(first.focus).not.toHaveBeenCalled();
      expect(FakeBrowserWindow.getAllWindows()).toHaveLength(3);
    });

    it('rail on: adds a machine no frame holds to the most recently focused frame', async () => {
      setMachineRailEnabledFlag(true);
      const older = seedLiveWindow('app://workspaces/work/a', undefined, 'local');
      const recent = seedLiveWindow('app://workspaces/work/b', undefined, 'remote-2');
      noteFrameFocused(recent as never);
      vi.mocked(setMainWindow).mockClear();

      await openOrFocusWindowsForBackend('remote-1');

      expect(commands.add).toHaveBeenCalledExactlyOnceWith(recent, 'remote-1');
      expect(FakeBrowserWindow.getAllWindows()).toEqual([older, recent]);
      expect(recent.machine).toBe('remote-1');
      expect(setMainWindow).toHaveBeenLastCalledWith(recent);
    });

    it('rail on: opens a new frame when the recent frame cannot take the machine', async () => {
      setMachineRailEnabledFlag(true);
      const frame = seedLiveWindow('app://workspaces/work/a', undefined, 'local');
      commands.add.mockResolvedValueOnce(false);

      await openOrFocusWindowsForBackend('remote-1');

      expect(commands.add).toHaveBeenCalledOnce();
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(2);
      expect(live[0]).toBe(frame);
      expect(live[1].machine).toBe('remote-1');
    });

    it('rail off: opens a new frame for a machine no frame holds', async () => {
      seedLiveWindow('app://workspaces/work/a', undefined, 'local');

      await openOrFocusWindowsForBackend('remote-1');

      expect(commands.add).not.toHaveBeenCalled();
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(2);
      expect(live[1].machine).toBe('remote-1');
    });

    it('shows a workspace in a frame that holds the machine without showing it', () => {
      setMachineRailEnabledFlag(true);
      const other = seedLiveWindow('app://workspaces/work/a', undefined, 'local');
      const frame = seedRailFrame('remote-2', ['remote-1']);
      frame.minimized = true;

      expect(showWorkspaceInBackendWindow('remote-1', 'ws-moved')).toBe(true);

      expect(commands.select).toHaveBeenCalledExactlyOnceWith(frame, 'remote-1');
      expect(frame.machine).toBe('remote-1');
      expect(consumePendingDeepLinks(viewOf(frame).id).actions).toEqual([
        { type: 'open', params: { id: 'ws-moved' } },
      ]);
      expect(frame.restore).toHaveBeenCalledOnce();
      expect(frame.focus).toHaveBeenCalled();
      expect(other.focus).not.toHaveBeenCalled();
    });

    it('forgetting a machine closes the frames holding only it and keeps frames holding others', () => {
      setMachineRailEnabledFlag(true);
      const only = seedLiveWindow('app://workspaces/work/a', undefined, 'remote-1');
      const shared = seedRailFrame('local', ['remote-1']);
      const showing = seedRailFrame('remote-1', ['remote-2']);

      closeWindowsForBackend('remote-1');

      expect(only.isDestroyed()).toBe(true);
      expect(shared.isDestroyed()).toBe(false);
      expect(showing.isDestroyed()).toBe(false);
    });

    it('does not open local before forgetting a machine a mixed frame survives', async () => {
      seedRailFrame('remote-1', ['remote-2']);

      await ensureLocalWindowBeforeClosingBackend('remote-1');

      expect(FakeBrowserWindow.getAllWindows()).toHaveLength(1);
    });
  });

  describe('HUD window save + restore round-trip', () => {
    it('restores the /hud session alongside the workspace window', async () => {
      // Backend A (local) has a workspace window and the HUD pop-out open.
      const workBounds = { x: 10, y: 10, width: 1300, height: 860 };
      const hudBounds = { x: 50, y: 50, width: 900, height: 700 };
      seedLiveWindow('app://workspaces/work/a', workBounds);
      seedLiveWindow('app://workspaces/hud', hudBounds);

      // Save A's layout, tear its windows down, then restore it.
      await saveAllWindowSessions();
      _resetWindowSessionsCacheForTests();
      clearWindowSessionsSnapshot();
      for (const w of FakeBrowserWindow.getAllWindows()) w.destroy();
      await restoreWindowsForBackend('local');

      // Both of A's windows are back, including the HUD.
      const live = FakeBrowserWindow.getAllWindows();
      const urls = live.map((w) => w.page);
      expect(urls.some((u) => new URL(u).pathname.startsWith('/hud'))).toBe(true);
      expect(urls.some((u) => new URL(u).pathname === '/work/a')).toBe(true);
      expect(live).toHaveLength(2);
    });
  });

  describe('boot restore of all backends (restoreAllBackendWindowSessions)', () => {
    const bounds = { x: 100, y: 100, width: 1024, height: 768 };

    beforeEach(() => {
      vi.mocked(setMainWindow).mockClear();
    });

    it('restores every saved backend bucket, each window stamped with its backend id', async () => {
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({
          local: [{ route: '/work/l', bounds }],
          'remote-1': [{ route: '/work/r1', bounds }],
          'remote-2': [
            { route: '/work/r2a', bounds },
            { route: '/work/r2b', bounds },
          ],
        }),
        'utf-8',
      );

      const connect = vi.fn().mockResolvedValue({});
      const restored = await restoreAllBackendWindowSessions('local', connect);

      expect(restored).toBe(true);
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(4);
      const byBackend = (id: string) => live.filter((w) => w.machine === id);
      expect(byBackend('local')).toHaveLength(1);
      expect(byBackend('remote-1')).toHaveLength(1);
      expect(byBackend('remote-2')).toHaveLength(2);
    });

    it('connects a pooled client for every bucket, including the active backend', async () => {
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({
          local: [{ route: '/work/l', bounds }],
          'remote-1': [{ route: '/work/r1', bounds }],
          'remote-2': [{ route: '/work/r2', bounds }],
        }),
        'utf-8',
      );

      const connect = vi.fn().mockResolvedValue({});
      await restoreAllBackendWindowSessions('remote-1', connect);

      // Unconditional connect: the active backend's call is idempotent on the
      // pool, so no bucket relies on boot having already created its client.
      expect(connect).toHaveBeenCalledTimes(3);
      expect(connect).toHaveBeenNthCalledWith(1, 'remote-1');
      expect(connect).toHaveBeenCalledWith('local');
      expect(connect).toHaveBeenCalledWith('remote-2');
    });

    it("the active backend's first window restores first and becomes the main window", async () => {
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({
          local: [{ route: '/work/l', bounds }],
          'remote-1': [{ route: '/work/r1', bounds }],
        }),
        'utf-8',
      );

      await restoreAllBackendWindowSessions('remote-1', vi.fn().mockResolvedValue({}));

      const live = FakeBrowserWindow.getAllWindows();
      expect(live[0].machine).toBe('remote-1');
      expect(setMainWindow).toHaveBeenCalledTimes(1);
      expect(setMainWindow).toHaveBeenCalledWith(live[0]);
    });

    it('skips a backend whose client cannot be built (fail-soft) but restores the rest', async () => {
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({
          local: [{ route: '/work/l', bounds }],
          'remote-forgotten': [{ route: '/work/gone', bounds }],
          'remote-2': [{ route: '/work/r2', bounds }],
        }),
        'utf-8',
      );

      const connect = vi.fn((id: string) =>
        id === 'remote-forgotten'
          ? Promise.reject(new Error('Backend connection not found'))
          : Promise.resolve({}),
      );
      const restored = await restoreAllBackendWindowSessions('local', connect);

      expect(restored).toBe(true);
      const live = FakeBrowserWindow.getAllWindows();
      expect(live.map((w) => w.machine).sort()).toEqual(['local', 'remote-2']);
      expect(live.every((w) => !w.page.includes('/work/gone'))).toBe(true);
    });

    it('returns false and opens nothing when no backend has saved sessions', async () => {
      const connect = vi.fn().mockResolvedValue({});
      const restored = await restoreAllBackendWindowSessions('local', connect);

      expect(restored).toBe(false);
      expect(connect).not.toHaveBeenCalled();
      expect(FakeBrowserWindow.getAllWindows()).toHaveLength(0);
      expect(setMainWindow).not.toHaveBeenCalled();
    });

    it('does not restore a window the user closed while others stayed open', async () => {
      seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      FakeBrowserWindow.instances = [];
      _resetWindowSessionsCacheForTests();
      const connect = vi.fn().mockResolvedValue({});
      const restored = await restoreAllBackendWindowSessions('local', connect);

      expect(restored).toBe(true);
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(1);
      expect(live[0].machine).toBe('local');
      expect(connect).toHaveBeenCalledTimes(1);
      expect(connect).toHaveBeenCalledWith('local');
    });

    it('restores a legacy top-level array as the local bucket', async () => {
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify([{ route: '/work/legacy', bounds }]),
        'utf-8',
      );

      const restored = await restoreAllBackendWindowSessions('local', vi.fn());

      expect(restored).toBe(true);
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(1);
      expect(live[0].machine).toBe('local');
      expect(live[0].page).toContain('/work/legacy');
    });

    it('the active bucket still provides the main window when a non-active bucket also restores', async () => {
      // Non-active buckets sort after the active one regardless of on-disk order.
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({
          'remote-1': [{ route: '/work/r1', bounds }],
          local: [{ route: '/work/l', bounds }],
        }),
        'utf-8',
      );

      await restoreAllBackendWindowSessions('local', vi.fn().mockResolvedValue({}));

      const live = FakeBrowserWindow.getAllWindows();
      expect(live[0].machine).toBe('local');
      expect(setMainWindow).toHaveBeenCalledWith(live[0]);
    });
  });

  describe('save + restore across backends', () => {
    it('keeps saved frames whose machine could not connect until that machine opens', async () => {
      const remoteBounds = { x: 100, y: 100, width: 1024, height: 768 };
      writeFrames([single('local', '/work/l'), single('remote-1', '/work/remote', remoteBounds)]);
      const connect = vi.fn((id: string) =>
        id === 'remote-1' ? Promise.reject(new Error('no token')) : Promise.resolve({}),
      );
      await restoreAllBackendWindowSessions('local', connect);
      expect(FakeBrowserWindow.getAllWindows().map((w) => w.machine)).toEqual(['local']);

      await saveAllWindowSessions();
      expect(readFrames()).toEqual([
        single('local', '/work/l'),
        single('remote-1', '/work/remote', remoteBounds),
      ]);

      await openOrFocusWindowsForBackend('remote-1');
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(2);
      expect(live[1].machine).toBe('remote-1');
      expect(new URL(live[1].page).pathname).toBe('/work/remote');
      expect(live[1].bounds).toEqual(remoteBounds);
    });

    it('opens a rail frame with every machine and its page, showing the one it showed', async () => {
      setMachineRailEnabledFlag(true);
      const saved = {
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
        machines: [
          { id: 'local', route: '/work/l' },
          { id: 'remote-1', route: '/work/r1' },
          { id: 'remote-2' },
        ],
        selectedId: 'remote-1',
      };
      writeFrames([saved]);

      await restoreAllBackendWindowSessions('local', vi.fn().mockResolvedValue({}));

      const [window] = FakeBrowserWindow.getAllWindows() as FakeWindow[];
      expect(openedFrames.get(window)).toEqual({
        machines: saved.machines,
        selectedId: 'remote-1',
      });
      expect(window.machine).toBe('remote-1');
      expect(new URL(window.page).pathname).toBe('/work/r1');
      // Its own page renders no machine (the rail owner loads the frame page later).
      expect(window.webContents.getURL()).toBe('about:blank');
    });
  });

  describe('workspace bootstrap route', () => {
    const bounds = { x: 100, y: 100, width: 1024, height: 768 };
    const loadedPaths = () =>
      FakeBrowserWindow.getAllWindows().map((w) => new URL(w.page).pathname);

    it('opens a fresh window on the workspace bootstrap route', async () => {
      await createWindow();
      expect(loadedPaths()).toEqual(['/workspace/new']);
    });

    it('keeps empty invited people in separate backend buckets across a full session reload', async () => {
      // Backend ids are the distinct persistent person rows, even on the same pinned host.
      const people = ['invited-person-B', 'invited-person-C'];
      for (const id of people) await restoreWindowsForBackend(id);
      expect(loadedPaths()).toEqual(['/workspace/new', '/workspace/new']);
      expect(FakeBrowserWindow.getAllWindows().map((w) => w.machine)).toEqual(people);
      await saveAllWindowSessions();
      FakeBrowserWindow.instances = [];
      _resetWindowSessionsCacheForTests();
      const connect = vi.fn().mockResolvedValue({});
      await restoreAllBackendWindowSessions('local', connect);
      expect(loadedPaths()).toEqual(['/workspace/new', '/workspace/new']);
      expect(FakeBrowserWindow.getAllWindows().map((w) => w.machine)).toEqual(people);
      expect(connect.mock.calls.map(([id]) => id)).toEqual(people);
    });

    it('restores a legacy root session onto the bootstrap route and keeps other routes', async () => {
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({
          local: [
            { route: '/', bounds },
            { route: '/workspace/kept', bounds },
          ],
        }),
        'utf-8',
      );

      await restoreWindowsForBackend('local');

      expect(loadedPaths()).toEqual(['/workspace/new', '/workspace/kept']);
    });

    it('opens newWindow create links on the bootstrap route and queues the action there', async () => {
      const action = { type: 'create' as const, params: { repo: '/r', newWindow: 'true' } };
      await createWindowForDeepLink('intent://create?repo=%2Fr&newWindow=true', {
        parseDeepLink: () => action,
        handleDeepLink: vi.fn(async () => {}),
      } as unknown as DeepLinkHandler);

      const [window] = FakeBrowserWindow.getAllWindows();
      const url = new URL(window.page);
      expect(url.pathname).toBe('/workspace/new');
      // The action never rides in the URL; the window pulls it from main.
      expect(url.searchParams.has('deepLink')).toBe(false);
      expect(consumePendingDeepLinks(viewOf(window).id).actions).toEqual([action]);
    });

    it('opens a local window for an open link when only a remote window exists', async () => {
      const remote = new FakeBrowserWindow();
      remote.backendId = 'remote-1';
      const action = { type: 'open' as const, params: { path: '/Users/me' } };
      await createWindowForDeepLink('intent://open?path=%2FUsers%2Fme', {
        parseDeepLink: () => action,
        handleDeepLink: vi.fn(async () => {}),
      } as unknown as DeepLinkHandler);

      const local = FakeBrowserWindow.getAllWindows().filter((w) => w.machine === 'local');
      expect(local).toHaveLength(1);
      expect(consumePendingDeepLinks(viewOf(local[0]).id).actions).toEqual([action]);
      expect(consumePendingDeepLinks(viewOf(remote).id).actions).toEqual([]);
    });
  });

  describe('renderer window gate', () => {
    const bounds = { x: 100, y: 100, width: 1024, height: 768 };
    // A non-pair deep link whose action opens a NEW window (`create` with
    // newWindow=true) — the deep-link branch that always constructs one.
    const openDeepLink = 'intent://create?repo=%2Fr&newWindow=true';
    const openDeepLinkHandler = {
      parseDeepLink: () => ({ type: 'create' as const, params: { repo: '/r', newWindow: 'true' } }),
      handleDeepLink: vi.fn(async () => {}),
    } as unknown as DeepLinkHandler;

    beforeEach(() => {
      // The outer beforeEach releases the gate for the rest of the suite; the
      // cases below start with it closed, as at process start.
      _resetRendererWindowGateForTests();
      vi.mocked(setMainWindow).mockClear();
    });

    it('createWindow constructs nothing until the gate is released, then exactly one window', async () => {
      const pending = createWindow();
      await flushMicrotasks();
      expect(FakeBrowserWindow.instances).toHaveLength(0);

      markRendererWindowsAllowed();
      await pending;

      expect(FakeBrowserWindow.instances).toHaveLength(1);
      expect(mockRegisterWindowTitleListener).toHaveBeenCalledTimes(1);
    });

    it('createWindowForDeepLink (non-pair intent:// URL) waits for the gate, then opens exactly one window', async () => {
      const pending = createWindowForDeepLink(openDeepLink, openDeepLinkHandler);
      await flushMicrotasks();
      expect(FakeBrowserWindow.instances).toHaveLength(0);

      markRendererWindowsAllowed();
      await pending;

      expect(FakeBrowserWindow.instances).toHaveLength(1);
      expect(
        consumePendingDeepLinks(viewOf(FakeBrowserWindow.instances[0]).id).actions,
      ).toHaveLength(1);
    });

    it('createWindowForSession waits for the gate, then restores exactly one window', async () => {
      const pending = createWindowForSession({ route: '/work/r1', bounds }, true, 'remote-1');
      await flushMicrotasks();
      expect(FakeBrowserWindow.instances).toHaveLength(0);
      expect(setMainWindow).not.toHaveBeenCalled();

      markRendererWindowsAllowed();
      await pending;

      expect(FakeBrowserWindow.instances).toHaveLength(1);
      expect(FakeBrowserWindow.instances[0].machine).toBe('remote-1');
    });

    it('restoreAllBackendWindowSessions constructs nothing while closed, then every saved window', async () => {
      fs.writeFileSync(
        legacySessionsPath(),
        JSON.stringify({
          local: [{ route: '/work/l', bounds }],
          'remote-1': [
            { route: '/work/r1a', bounds },
            { route: '/work/r1b', bounds },
          ],
        }),
        'utf-8',
      );
      const connect = vi.fn().mockResolvedValue({});

      const pending = restoreAllBackendWindowSessions('local', connect);
      await flushMicrotasks();
      expect(FakeBrowserWindow.instances).toHaveLength(0);

      markRendererWindowsAllowed();
      await expect(pending).resolves.toBe(true);

      expect(FakeBrowserWindow.instances).toHaveLength(3);
      expect(FakeBrowserWindow.instances.map((w) => w.machine)).toEqual([
        'local',
        'remote-1',
        'remote-1',
      ]);
    });

    it('two creators waiting concurrently both complete after a single release', async () => {
      const first = createWindow('local');
      const second = createWindowForSession({ route: '/work/r1', bounds }, false, 'remote-1');
      await flushMicrotasks();
      expect(FakeBrowserWindow.instances).toHaveLength(0);

      markRendererWindowsAllowed();
      await Promise.all([first, second]);

      expect(FakeBrowserWindow.instances).toHaveLength(2);
      expect(FakeBrowserWindow.instances.map((w) => w.machine).sort()).toEqual([
        'local',
        'remote-1',
      ]);

      // The gate stays open: a later creator no longer waits.
      await createWindow('local');
      expect(FakeBrowserWindow.instances).toHaveLength(3);
    });
  });
});
