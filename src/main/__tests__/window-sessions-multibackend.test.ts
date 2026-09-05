/**
 * Multi-backend window/session state (T4).
 *
 * window-sessions.json is a backend-keyed map (`Record<backendId,
 * WindowSession[]>`) so each backend restores its own window layout. This
 * suite covers:
 *   - per-backend save/restore (one backend's save never clobbers another's),
 *   - lazy migration of a legacy top-level array into the `local` bucket,
 *   - `restoreWindowsForBackend` (restore a backend's saved layout, or open a
 *     fresh window) and the open/close-per-backend hooks.
 */

import * as fs from 'fs';
import fsAsync from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPath = vi.fn();
const mockGetDisplayMatching = vi.fn();

/** A live BrowserWindow test double: constructable + destroyable + URL-bearing. */
const { FakeBrowserWindow, mockRegisterWindowTitleListener } = vi.hoisted(() => {
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    static focused: FakeBrowserWindow | null = null;
    backendId = 'local';
    destroyed = false;
    fullScreen = false;
    bounds: { x: number; y: number; width: number; height: number };
    handlers = new Map<string, (...args: unknown[]) => void>();
    private url = 'about:blank';
    webContents = {
      on: vi.fn(),
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
      return false;
    }
    isFullScreen() {
      return this.fullScreen;
    }
    setFullScreen = vi.fn((flag: boolean) => {
      this.fullScreen = flag;
    });
    restore = vi.fn();
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

import { _resetHudWindowRefForTests, isTrackedHudWindow } from '../hud-window';
import { setMainWindow } from '../state';
import {
  _resetWindowSessionsCacheForTests,
  captureWindowSessionsSnapshot,
  closeWindowsForBackend,
  clearWindowSessionsSnapshot,
  createWindow,
  ensureLocalWindowBeforeClosingBackend,
  getWindowSessionsPath,
  getBackendIdForWebContents,
  getFocusedWindowBackendId,
  isValidWindowSession,
  listSavedSessionBackendIds,
  loadWindowSessions,
  markWindowSessionTeardown,
  openOrFocusWindowsForBackend,
  unmarkWindowSessionTeardown,
  restoreAllBackendWindowSessions,
  restoreWindowsForBackend,
  saveAllWindowSessions,
  saveWindowSessions,
  setOnLastWindowClosedForBackend,
  type WindowSession,
} from '../window';

function seedLiveWindow(
  url: string,
  bounds = { x: 0, y: 0, width: 1200, height: 800 },
  backendId = 'local',
): FakeBrowserWindow {
  const w = new FakeBrowserWindow(bounds);
  w.backendId = backendId;
  w.setURLForTest(url);
  return w;
}

function readMap(): Record<string, WindowSession[]> {
  return JSON.parse(fs.readFileSync(getWindowSessionsPath(), 'utf-8'));
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
  });

  describe('per-backend save/restore', () => {
    it('saves each backend under its own key without clobbering the others', async () => {
      const localBounds = { x: 10, y: 20, width: 1400, height: 900 };
      seedLiveWindow('app://workspaces/work/local', localBounds);
      await saveWindowSessions('local');

      // Move to a different set of live windows and save under a remote id.
      FakeBrowserWindow.instances = [];
      _resetWindowSessionsCacheForTests();
      const remoteBounds = { x: 30, y: 40, width: 1000, height: 700 };
      seedLiveWindow('app://workspaces/work/remote', remoteBounds, 'remote-1');
      await saveWindowSessions('remote-1');

      const map = readMap();
      expect(map).toEqual({
        local: [{ route: '/work/local', bounds: localBounds }],
        'remote-1': [{ route: '/work/remote', bounds: remoteBounds }],
      });
    });

    it('restores only the requested backend bucket', async () => {
      const localBounds = { x: 1, y: 2, width: 1300, height: 850 };
      seedLiveWindow('app://workspaces/work/l', localBounds);
      await saveWindowSessions('local');

      FakeBrowserWindow.instances = [];
      _resetWindowSessionsCacheForTests();
      const remoteBounds = { x: 5, y: 6, width: 1100, height: 720 };
      seedLiveWindow('app://workspaces/work/r', remoteBounds, 'remote-1');
      await saveWindowSessions('remote-1');

      expect(loadWindowSessions('local')).toEqual([{ route: '/work/l', bounds: localBounds }]);
      expect(loadWindowSessions('remote-1')).toEqual([{ route: '/work/r', bounds: remoteBounds }]);
      expect(loadWindowSessions('never-seen')).toBeNull();
    });

    it('caps each backend at 20 restored windows', async () => {
      const bounds = { x: 0, y: 0, width: 1200, height: 800 };
      const many = Array.from({ length: 25 }, (_, i) => ({ route: `/w/${i}`, bounds }));
      fs.writeFileSync(getWindowSessionsPath(), JSON.stringify({ 'remote-1': many }), 'utf-8');
      expect(loadWindowSessions('remote-1')).toHaveLength(20);
    });

    it('explicit local save/load round-trips under the local bucket', async () => {
      const bounds = { x: 7, y: 8, width: 1280, height: 820 };
      seedLiveWindow('app://workspaces/work/default', bounds);
      await saveWindowSessions('local');
      expect(readMap()).toEqual({ local: [{ route: '/work/default', bounds }] });
      expect(loadWindowSessions('local')).toEqual([{ route: '/work/default', bounds }]);
    });

    it('persists concurrently open local and remote windows without activeId', async () => {
      const localBounds = { x: 10, y: 20, width: 1200, height: 800 };
      const remoteBounds = { x: 30, y: 40, width: 1000, height: 700 };
      seedLiveWindow('app://workspaces/work/local', localBounds, 'local');
      seedLiveWindow('app://workspaces/work/remote', remoteBounds, 'remote-1');

      await saveAllWindowSessions();

      expect(readMap()).toEqual({
        local: [{ route: '/work/local', bounds: localBounds }],
        'remote-1': [{ route: '/work/remote', bounds: remoteBounds }],
      });
    });

    it('does not restore a remote layout after its last window is explicitly closed', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();

      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(loadWindowSessions('remote-1')).toBeNull();
      await saveAllWindowSessions();
      expect(readMap()).toEqual({
        local: [{ route: '/work/local', bounds: local.bounds }],
      });

      openOrFocusWindowsForBackend('remote-1');
      const remoteWindows = FakeBrowserWindow.getAllWindows().filter(
        (window) => window.backendId === 'remote-1',
      );
      expect(remoteWindows).toHaveLength(1);
      expect(remoteWindows[0].webContents.getURL()).not.toContain('/work/closed');
    });

    it('prunes the on-disk bucket immediately at close time (crash-safe tombstone)', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();
      expect(readMap()['remote-1']).toBeDefined();

      // The close listener alone must clear the bucket — no aggregate save may
      // run before a crash/force-quit, so the tombstone cannot stay memory-only.
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(readMap()).toEqual({
        local: [{ route: '/work/local', bounds: local.bounds }],
      });
    });

    it('an aggregate save in flight during the sync prune cannot resurrect the bucket', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();

      // Park the aggregate save's async write mid-flight; the sync prune below
      // uses fs.writeFileSync, so only the save path is suspended.
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

      // While the write is parked, the remote's last window closes:
      // tombstone + sync prune drop the bucket from disk.
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();
      expect(readMap()['remote-1']).toBeUndefined();

      releaseWrite();
      await inFlight;
      writeSpy.mockRestore();

      expect(readMap()).toEqual({
        local: [{ route: '/work/local', bounds: local.bounds }],
      });
    });

    it('a single-backend save in flight during the sync prune cannot resurrect the bucket', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();

      let releaseWrite!: () => void;
      const gate = new Promise<void>((resolve) => (releaseWrite = resolve));
      const realWrite = fsAsync.writeFile.bind(fsAsync);
      const writeSpy = vi
        .spyOn(fsAsync, 'writeFile')
        .mockImplementationOnce(async (...args: Parameters<typeof fsAsync.writeFile>) => {
          await gate;
          return realWrite(...args);
        });
      const inFlight = saveWindowSessions('local');

      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();
      expect(readMap()['remote-1']).toBeUndefined();

      releaseWrite();
      await inFlight;
      writeSpy.mockRestore();

      expect(readMap()).toEqual({
        local: [{ route: '/work/local', bounds: local.bounds }],
      });
    });
  });

  describe('quit/update-install teardown (markWindowSessionTeardown)', () => {
    it('does not tombstone or prune a backend closed during app-quit teardown', async () => {
      // Two backends, one window each — the app-quit scenario where
      // gracefulShutdown()'s mainWindow.close() fires the close listener while
      // the other backend's window is still live.
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');
      await saveAllWindowSessions();
      expect(readMap()['remote-1']).toBeDefined();

      markWindowSessionTeardown();
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      // No tombstone: the bucket saved before quit survives on disk and stays
      // loadable, and the pooled client is not disposed mid-shutdown.
      expect(readMap()).toEqual({
        local: [{ route: '/work/local', bounds: local.bounds }],
        'remote-1': [{ route: '/work/remote', bounds: remote.bounds }],
      });
      expect(loadWindowSessions('remote-1')).toEqual([
        { route: '/work/remote', bounds: remote.bounds },
      ]);
      expect(disposer).not.toHaveBeenCalled();
    });

    it('teardown closes still refresh the snapshot so a final save persists every bucket', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      markWindowSessionTeardown();
      captureWindowSessionsSnapshot.call(local as never);
      local.destroy();
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      // All windows are gone; the aggregate save must fall back to the
      // snapshots captured by the teardown-time close listeners.
      await saveAllWindowSessions();
      expect(readMap()).toEqual({
        local: [{ route: '/work/local', bounds: local.bounds }],
        'remote-1': [{ route: '/work/remote', bounds: remote.bounds }],
      });
    });

    it('unmark (aborted update install) restores tombstoning for later deliberate closes', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();

      // quitAndInstall() failed: the teardown mark is reverted and the app
      // keeps running — a later deliberate last-window close must behave
      // exactly as if teardown was never marked.
      markWindowSessionTeardown();
      unmarkWindowSessionTeardown();
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(readMap()).toEqual({
        local: [{ route: '/work/local', bounds: local.bounds }],
      });
      expect(loadWindowSessions('remote-1')).toBeNull();
    });

    it('a deliberate last-window close before teardown still tombstones + prunes', async () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();

      // No teardown mark: this is the mid-session deliberate close path.
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(readMap()).toEqual({
        local: [{ route: '/work/local', bounds: local.bounds }],
      });
      expect(loadWindowSessions('remote-1')).toBeNull();
    });
  });

  describe('pooled client disposal on last window close', () => {
    it('disposes the remote client when its last window is explicitly closed', () => {
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(disposer).toHaveBeenCalledTimes(1);
      expect(disposer).toHaveBeenCalledWith('remote-1');
    });

    it('does not dispose while another window of the same backend survives', () => {
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remoteA = seedLiveWindow('app://workspaces/work/a', undefined, 'remote-1');
      seedLiveWindow('app://workspaces/work/b', undefined, 'remote-1');

      captureWindowSessionsSnapshot.call(remoteA as never);
      remoteA.destroy();

      expect(disposer).not.toHaveBeenCalled();
    });

    it('never disposes the local backend (sidecar management stays alive)', () => {
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      captureWindowSessionsSnapshot.call(local as never);
      local.destroy();

      expect(disposer).not.toHaveBeenCalled();
    });

    it('does not dispose on a whole-process last-window close (quit path)', () => {
      // No surviving backend → this is window-all-closed / quit territory, not
      // a per-backend close; gracefulShutdown() owns client teardown there.
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(disposer).not.toHaveBeenCalled();
    });

    it('a throwing disposer still records the closed-backend tombstone', async () => {
      setOnLastWindowClosedForBackend(() => {
        throw new Error('dispose failed');
      });
      seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();

      expect(() => captureWindowSessionsSnapshot.call(remote as never)).not.toThrow();
      remote.destroy();

      expect(loadWindowSessions('remote-1')).toBeNull();
    });
  });

  describe('legacy migration', () => {
    it('reads a legacy top-level array as the local backend bucket', () => {
      const bounds = { x: 3, y: 4, width: 1500, height: 950 };
      const legacy: WindowSession[] = [{ route: '/work/legacy', bounds }];
      fs.writeFileSync(getWindowSessionsPath(), JSON.stringify(legacy), 'utf-8');

      expect(loadWindowSessions('local')).toEqual(legacy);
      expect(loadWindowSessions('remote-1')).toBeNull();
    });

    it('rewrites the legacy array into keyed-map form on the next save', async () => {
      const legacyBounds = { x: 3, y: 4, width: 1500, height: 950 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify([{ route: '/work/legacy', bounds: legacyBounds }]),
        'utf-8',
      );

      // Saving a remote backend must migrate the legacy local layout into the
      // map (under `local`) rather than dropping it.
      const remoteBounds = { x: 9, y: 9, width: 1000, height: 700 };
      seedLiveWindow('app://workspaces/work/remote', remoteBounds, 'remote-1');
      await saveWindowSessions('remote-1');

      expect(readMap()).toEqual({
        local: [{ route: '/work/legacy', bounds: legacyBounds }],
        'remote-1': [{ route: '/work/remote', bounds: remoteBounds }],
      });
    });
  });

  describe('display-aware validation + fullscreen (multi-monitor restore)', () => {
    it('restores a session onto its own display instead of resetting to primary', () => {
      // Bounds on a secondary monitor to the right of the primary — they fail
      // the primary-workArea visibility check, so this regresses if validation
      // goes back to screen.getPrimaryDisplay().
      const secondaryWorkArea = { x: 1920, y: 0, width: 2560, height: 1415 };
      mockGetDisplayMatching.mockReturnValue({ workArea: secondaryWorkArea });
      const bounds = { x: 2000, y: 100, width: 1200, height: 800 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({ local: [{ route: '/work/second', bounds }] }),
        'utf-8',
      );

      restoreWindowsForBackend('local');

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(mockGetDisplayMatching).toHaveBeenCalledWith(bounds);
      expect(window.bounds).toEqual(bounds);
    });

    it('falls back to the matched display work area for off-screen bounds', () => {
      // A disconnected monitor: getDisplayMatching returns the nearest live
      // display, whose work area the saved bounds no longer intersect.
      const nearestWorkArea = { x: 0, y: 0, width: 1920, height: 1080 };
      mockGetDisplayMatching.mockReturnValue({ workArea: nearestWorkArea });
      const bounds = { x: 99999, y: 99999, width: 1200, height: 800 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({ local: [{ route: '/work/gone', bounds }] }),
        'utf-8',
      );

      restoreWindowsForBackend('local');

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(window.bounds).toEqual(nearestWorkArea);
    });

    it('createWindow keeps legacy saved bounds that land on a secondary display', () => {
      const secondaryWorkArea = { x: 1920, y: 0, width: 2560, height: 1415 };
      mockGetDisplayMatching.mockReturnValue({ workArea: secondaryWorkArea });
      const saved = { x: 2100, y: 50, width: 1400, height: 900 };
      fs.writeFileSync(path.join(tmpDir, 'window-bounds.json'), JSON.stringify(saved), 'utf-8');

      createWindow();

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(window.bounds).toEqual(saved);
    });

    it('createWindow falls back to the matched display work area for off-screen legacy bounds', () => {
      // Bounds near a since-disconnected secondary display: getDisplayMatching
      // picks the nearest live display, whose work area they no longer
      // intersect. The fallback must land on THAT display's work area, not
      // reset to the primary display.
      const matchedWorkArea = { x: 1920, y: 0, width: 2560, height: 1415 };
      mockGetDisplayMatching.mockReturnValue({ workArea: matchedWorkArea });
      const saved = { x: 99999, y: 99999, width: 1400, height: 900 };
      fs.writeFileSync(path.join(tmpDir, 'window-bounds.json'), JSON.stringify(saved), 'utf-8');

      createWindow();

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(window.bounds).toEqual(matchedWorkArea);
    });

    it('captures isFullScreen in the saved session', async () => {
      const bounds = { x: 1920, y: 0, width: 2560, height: 1440 };
      const window = seedLiveWindow('app://workspaces/work/fs', bounds);
      window.fullScreen = true;

      await saveWindowSessions('local');

      expect(readMap()).toEqual({
        local: [{ route: '/work/fs', bounds, isFullScreen: true }],
      });
    });

    it('restores a fullscreen session via setFullScreen(true)', () => {
      const bounds = { x: 1920, y: 0, width: 2560, height: 1440 };
      mockGetDisplayMatching.mockReturnValue({
        workArea: { x: 1920, y: 0, width: 2560, height: 1415 },
      });
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({ local: [{ route: '/work/fs', bounds, isFullScreen: true }] }),
        'utf-8',
      );

      restoreWindowsForBackend('local');

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(window.setFullScreen).toHaveBeenCalledWith(true);
      expect(window.isFullScreen()).toBe(true);
    });

    it('does not enter fullscreen for legacy sessions without the flag', () => {
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({ local: [{ route: '/work/plain', bounds }] }),
        'utf-8',
      );

      restoreWindowsForBackend('local');

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(window.setFullScreen).not.toHaveBeenCalled();
      expect(window.isFullScreen()).toBe(false);
    });

    it('isValidWindowSession accepts the flag, its absence, and rejects non-booleans', () => {
      const bounds = { x: 0, y: 0, width: 1200, height: 800 };
      expect(isValidWindowSession({ route: '/a', bounds })).toBe(true);
      expect(isValidWindowSession({ route: '/a', bounds, isFullScreen: true })).toBe(true);
      expect(isValidWindowSession({ route: '/a', bounds, isFullScreen: false })).toBe(true);
      expect(isValidWindowSession({ route: '/a', bounds, isFullScreen: 'yes' })).toBe(false);
    });
  });

  describe('restoreWindowsForBackend', () => {
    it('registers the title listener for every fresh and restored window', () => {
      createWindow();
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({ 'remote-a': [{ route: '/hud', bounds }] }),
        'utf-8',
      );

      restoreWindowsForBackend('remote-a');

      expect(mockRegisterWindowTitleListener.mock.calls.map(([window]) => window)).toEqual(
        FakeBrowserWindow.getAllWindows(),
      );
    });

    it('stamps restored windows with their saved backend bucket', () => {
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({
          'remote-a': [{ route: '/work/a', bounds }],
          'remote-b': [{ route: '/work/b', bounds }],
        }),
        'utf-8',
      );

      restoreWindowsForBackend('remote-a');
      restoreWindowsForBackend('remote-b');

      const live = FakeBrowserWindow.getAllWindows();
      expect(getBackendIdForWebContents(live[0].webContents as never)).toBe('remote-a');
      expect(getBackendIdForWebContents(live[1].webContents as never)).toBe('remote-b');
    });

    it('stamps a fresh window without a backend id as local', () => {
      createWindow();

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(getBackendIdForWebContents(window.webContents as never)).toBe('local');
    });

    it('defaults an unbound IPC sender to local', () => {
      expect(getBackendIdForWebContents({} as never)).toBe('local');
    });

    it('stamps a restored HUD window with its saved backend bucket (not forced local)', () => {
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({ 'remote-a': [{ route: '/hud', bounds }] }),
        'utf-8',
      );

      restoreWindowsForBackend('remote-a');

      const [window] = FakeBrowserWindow.getAllWindows();
      expect(getBackendIdForWebContents(window.webContents as never)).toBe('remote-a');
    });

    it('registers a restored /hud session in the tracked HUD registry', () => {
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({
          'remote-a': [
            { route: '/hud', bounds },
            { route: '/work/remote', bounds },
          ],
        }),
        'utf-8',
      );

      restoreWindowsForBackend('remote-a');

      // The /hud window is tracked immediately (before its URL loads), so a
      // concurrent open-HUD request cannot create a duplicate during restore;
      // the plain window is not.
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(2);
      const hud = live.find((w) => w.webContents.getURL().includes('/hud'));
      const plain = live.find((w) => !w.webContents.getURL().includes('/hud'));
      expect(isTrackedHudWindow(hud as never)).toBe(true);
      expect(isTrackedHudWindow(plain as never)).toBe(false);
    });

    it('restores the incoming backend layout', () => {
      const remoteBounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({ 'remote-1': [{ route: '/work/remote', bounds: remoteBounds }] }),
        'utf-8',
      );

      restoreWindowsForBackend('remote-1');

      // Exactly one live window restored, loading the incoming backend's route.
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(1);
      expect(live[0].webContents.getURL()).toContain('/work/remote');
    });

    it('opens a single fresh window when the incoming backend has no saved sessions', () => {
      restoreWindowsForBackend('remote-empty');

      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(1);
      expect(live[0].isDestroyed()).toBe(false);
    });

    it('adds saved remote sessions without destroying an existing local window', () => {
      const bounds = { x: 100, y: 100, width: 1024, height: 768 };
      const local = seedLiveWindow('app://workspaces/work/local', bounds);
      (local as unknown as { backendId: string }).backendId = 'local';
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({ 'remote-1': [{ route: '/work/remote', bounds }] }),
        'utf-8',
      );

      openOrFocusWindowsForBackend('remote-1');

      const live = FakeBrowserWindow.getAllWindows();
      expect(local.isDestroyed()).toBe(false);
      expect(live).toHaveLength(2);
      expect(getBackendIdForWebContents(live[1].webContents as never)).toBe('remote-1');
    });

    it('focuses an existing backend window instead of restoring duplicates', () => {
      const remote = seedLiveWindow('app://workspaces/work/remote');
      (remote as unknown as { backendId: string }).backendId = 'remote-1';

      openOrFocusWindowsForBackend('remote-1');

      expect(FakeBrowserWindow.getAllWindows()).toHaveLength(1);
      expect(remote.show).toHaveBeenCalledOnce();
      expect(remote.focus).toHaveBeenCalledOnce();
    });

    it('resolves the focused window backend for menu and quit consumers', () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      local.focus();
      expect(getFocusedWindowBackendId()).toBe('local');
      remote.focus();
      expect(getFocusedWindowBackendId()).toBe('remote-1');
    });

    it('closes only windows belonging to the forgotten backend', () => {
      const local = seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      closeWindowsForBackend('remote-1');

      expect(local.isDestroyed()).toBe(false);
      expect(remote.isDestroyed()).toBe(true);
      expect(FakeBrowserWindow.getAllWindows()).toEqual([local]);
    });

    it('opens local before closing the last backend windows', () => {
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      ensureLocalWindowBeforeClosingBackend('remote-1');

      const beforeClose = FakeBrowserWindow.getAllWindows();
      expect(beforeClose).toHaveLength(2);
      expect(getBackendIdForWebContents(beforeClose[1].webContents as never)).toBe('local');

      closeWindowsForBackend('remote-1');
      expect(remote.isDestroyed()).toBe(true);
      expect(FakeBrowserWindow.getAllWindows()).toEqual([beforeClose[1]]);
    });

    it('does not open local when another backend window will survive', () => {
      const forgotten = seedLiveWindow('app://workspaces/work/a', undefined, 'remote-1');
      const surviving = seedLiveWindow('app://workspaces/work/b', undefined, 'remote-2');

      ensureLocalWindowBeforeClosingBackend('remote-1');
      closeWindowsForBackend('remote-1');

      expect(forgotten.isDestroyed()).toBe(true);
      expect(surviving.isDestroyed()).toBe(false);
      expect(FakeBrowserWindow.getAllWindows()).toEqual([surviving]);
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
      await saveWindowSessions('local');
      clearWindowSessionsSnapshot();
      for (const w of FakeBrowserWindow.getAllWindows()) w.destroy();
      restoreWindowsForBackend('local');

      // Both of A's windows are back, including the HUD.
      const live = FakeBrowserWindow.getAllWindows();
      const urls = live.map((w) => w.webContents.getURL());
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
        getWindowSessionsPath(),
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
      const byBackend = (id: string) => live.filter((w) => w.backendId === id);
      expect(byBackend('local')).toHaveLength(1);
      expect(byBackend('remote-1')).toHaveLength(1);
      expect(byBackend('remote-2')).toHaveLength(2);
    });

    it('connects a pooled client for every bucket, including the active backend', async () => {
      fs.writeFileSync(
        getWindowSessionsPath(),
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
        getWindowSessionsPath(),
        JSON.stringify({
          local: [{ route: '/work/l', bounds }],
          'remote-1': [{ route: '/work/r1', bounds }],
        }),
        'utf-8',
      );

      await restoreAllBackendWindowSessions('remote-1', vi.fn().mockResolvedValue({}));

      const live = FakeBrowserWindow.getAllWindows();
      expect(live[0].backendId).toBe('remote-1');
      expect(setMainWindow).toHaveBeenCalledTimes(1);
      expect(setMainWindow).toHaveBeenCalledWith(live[0]);
    });

    it('skips a backend whose client cannot be built (fail-soft) but restores the rest', async () => {
      fs.writeFileSync(
        getWindowSessionsPath(),
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
      expect(live.map((w) => w.backendId).sort()).toEqual(['local', 'remote-2']);
      expect(live.every((w) => !w.webContents.getURL().includes('/work/gone'))).toBe(true);
    });

    it('returns false and opens nothing when no backend has saved sessions', async () => {
      const connect = vi.fn().mockResolvedValue({});
      const restored = await restoreAllBackendWindowSessions('local', connect);

      expect(restored).toBe(false);
      expect(connect).not.toHaveBeenCalled();
      expect(FakeBrowserWindow.getAllWindows()).toHaveLength(0);
      expect(setMainWindow).not.toHaveBeenCalled();
    });

    it('does not restore a tombstoned backend whose last window was explicitly closed', async () => {
      seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/closed', undefined, 'remote-1');
      await saveAllWindowSessions();
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();

      expect(listSavedSessionBackendIds()).toEqual(['local']);

      FakeBrowserWindow.instances = [];
      const connect = vi.fn().mockResolvedValue({});
      const restored = await restoreAllBackendWindowSessions('local', connect);

      expect(restored).toBe(true);
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(1);
      expect(live[0].backendId).toBe('local');
      expect(connect).toHaveBeenCalledTimes(1);
      expect(connect).toHaveBeenCalledWith('local');
    });

    it('restores a legacy top-level array as the local bucket', async () => {
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify([{ route: '/work/legacy', bounds }]),
        'utf-8',
      );

      const restored = await restoreAllBackendWindowSessions('local', vi.fn());

      expect(restored).toBe(true);
      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(1);
      expect(live[0].backendId).toBe('local');
      expect(live[0].webContents.getURL()).toContain('/work/legacy');
    });

    it('the active bucket still provides the main window when a non-active bucket also restores', async () => {
      // Non-active buckets sort after the active one regardless of on-disk order.
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({
          'remote-1': [{ route: '/work/r1', bounds }],
          local: [{ route: '/work/l', bounds }],
        }),
        'utf-8',
      );

      await restoreAllBackendWindowSessions('local', vi.fn().mockResolvedValue({}));

      const live = FakeBrowserWindow.getAllWindows();
      expect(live[0].backendId).toBe('local');
      expect(setMainWindow).toHaveBeenCalledWith(live[0]);
    });
  });

  describe('save + restore across backends', () => {
    it('saving one backend leaves another backend restorable from its own bucket', async () => {
      const localBounds = { x: 10, y: 10, width: 1300, height: 860 };
      const w1 = seedLiveWindow('app://workspaces/work/a', localBounds);

      // The other backend has a saved layout from a prior session.
      const remoteBounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({ 'remote-1': [{ route: '/work/remote', bounds: remoteBounds }] }),
        'utf-8',
      );

      await saveWindowSessions('local');
      clearWindowSessionsSnapshot();
      w1.destroy();
      restoreWindowsForBackend('remote-1');

      expect(w1.isDestroyed()).toBe(true);
      const map = readMap();
      expect(map.local).toEqual([{ route: '/work/a', bounds: localBounds }]);
      expect(map['remote-1']).toEqual([{ route: '/work/remote', bounds: remoteBounds }]);

      const live = FakeBrowserWindow.getAllWindows();
      expect(live).toHaveLength(1);
      expect(live[0].webContents.getURL()).toContain('/work/remote');
    });
  });
});
