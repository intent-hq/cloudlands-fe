/**
 * Multi-backend window/session state (T4).
 *
 * window-sessions.json is now a backend-keyed map (`Record<backendId,
 * WindowSession[]>`) so each backend restores its own window layout when the
 * user switches the active intentd connection. This suite covers:
 *   - per-backend save/restore (one backend's save never clobbers another's),
 *   - lazy migration of a legacy top-level array into the `local` bucket,
 *   - the switch hooks: `captureAndCloseWindowsForBackendSwitch` (persist the
 *     outgoing backend + tear all windows down) and `restoreWindowsForBackend`
 *     (restore the incoming backend, or open a fresh window).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPath = vi.fn();

/** A live BrowserWindow test double: constructable + destroyable + URL-bearing. */
const { FakeBrowserWindow } = vi.hoisted(() => {
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    static focused: FakeBrowserWindow | null = null;
    backendId = 'local';
    destroyed = false;
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
      return false;
    }
    restore = vi.fn();
    show = vi.fn();
    focus = vi.fn(() => {
      FakeBrowserWindow.focused = this;
    });
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.(...args);
    }
  }
  return { FakeBrowserWindow };
});

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => mockGetPath(name),
    dock: undefined,
  },
  BrowserWindow: FakeBrowserWindow,
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
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
}));

import { _resetHudWindowRefForTests, isTrackedHudWindow } from '../hud-window';
import { setMainWindow } from '../state';
import {
  _resetWindowSessionsCacheForTests,
  captureWindowSessionsSnapshot,
  captureAndCloseWindowsForBackendSwitch,
  closeWindowsForBackend,
  clearBackendSwitchWindowTeardownGuard,
  clearWindowSessionsSnapshot,
  createWindow,
  ensureLocalWindowBeforeClosingBackend,
  getWindowSessionsPath,
  getBackendIdForWebContents,
  getFocusedWindowBackendId,
  isBackendSwitchWindowTeardownInProgress,
  listSavedSessionBackendIds,
  loadWindowSessions,
  openOrFocusWindowsForBackend,
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
    FakeBrowserWindow.instances = [];
    FakeBrowserWindow.focused = null;
    _resetWindowSessionsCacheForTests();
    _resetHudWindowRefForTests();
  });

  describe('per-backend save/restore', () => {
    it('saves each backend under its own key without clobbering the others', async () => {
      const localBounds = { x: 10, y: 20, width: 1400, height: 900 };
      seedLiveWindow('app://workspaces/work/local', localBounds);
      await saveWindowSessions('local');

      // Switch to a different set of live windows and save under a remote id.
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

    it('does not dispose during a backend-switch window teardown', async () => {
      const disposer = vi.fn();
      setOnLastWindowClosedForBackend(disposer);
      seedLiveWindow('app://workspaces/work/local', undefined, 'local');
      const remote = seedLiveWindow('app://workspaces/work/remote', undefined, 'remote-1');

      await captureAndCloseWindowsForBackendSwitch('local');
      expect(isBackendSwitchWindowTeardownInProgress()).toBe(true);
      // A close event landing mid-teardown must not dispose the client.
      captureWindowSessionsSnapshot.call(remote as never);
      remote.destroy();
      clearBackendSwitchWindowTeardownGuard();

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

  describe('captureAndCloseWindowsForBackendSwitch', () => {
    it('persists the outgoing backend layout and destroys all windows without clobbering other buckets', async () => {
      // Another backend already has a saved layout on disk.
      const remoteBounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({ 'remote-1': [{ route: '/work/remote', bounds: remoteBounds }] }),
        'utf-8',
      );

      // Two live windows belong to the outgoing (local) backend.
      const localBounds = { x: 10, y: 10, width: 1300, height: 860 };
      const w1 = seedLiveWindow('app://workspaces/work/a', localBounds);
      const w2 = seedLiveWindow('app://workspaces/work/b', localBounds);

      await captureAndCloseWindowsForBackendSwitch('local');

      // Outgoing windows were torn down.
      expect(w1.isDestroyed()).toBe(true);
      expect(w2.isDestroyed()).toBe(true);
      expect(FakeBrowserWindow.getAllWindows()).toHaveLength(0);

      // Outgoing layout captured under `local`; other bucket preserved.
      const map = readMap();
      expect(map.local).toEqual([
        { route: '/work/a', bounds: localBounds },
        { route: '/work/b', bounds: localBounds },
      ]);
      expect(map['remote-1']).toEqual([{ route: '/work/remote', bounds: remoteBounds }]);
    });
  });

  describe('restoreWindowsForBackend', () => {
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

  describe('HUD window across a backend round-trip (A→B→A)', () => {
    it('restores the /hud session when switching away and back', async () => {
      // Backend A (local) has a workspace window and the HUD pop-out open.
      const workBounds = { x: 10, y: 10, width: 1300, height: 860 };
      const hudBounds = { x: 50, y: 50, width: 900, height: 700 };
      seedLiveWindow('app://workspaces/work/a', workBounds);
      seedLiveWindow('app://workspaces/hud', hudBounds);

      // Switch A→B.
      await captureAndCloseWindowsForBackendSwitch('local');
      restoreWindowsForBackend('remote-1');

      // Switch B→A.
      await captureAndCloseWindowsForBackendSwitch('remote-1');
      restoreWindowsForBackend('local');

      // Both of A's windows are back, including the HUD.
      const live = FakeBrowserWindow.getAllWindows();
      const urls = live.map((w) => w.webContents.getURL());
      expect(urls.some((u) => new URL(u).pathname.startsWith('/hud'))).toBe(true);
      expect(urls.some((u) => new URL(u).pathname === '/work/a')).toBe(true);
      expect(live).toHaveLength(2);
    });

    it('survives the mid-switch window-all-closed that fires when the last window is destroyed', async () => {
      // THE user-reported bug (HUD not restored on backend switch): destroying
      // every window inside captureAndCloseWindowsForBackendSwitch() fires
      // Electron's `window-all-closed`. The index.ts handler treated that as
      // the user manually closing everything — on macOS it deleted
      // window-sessions.json (the file the switch had JUST written) and wiped
      // the snapshot cache — so restoreWindowsForBackend() found nothing and
      // opened a fresh default window instead of the saved HUD + workspace
      // layout. The handler now skips the event while
      // isBackendSwitchWindowTeardownInProgress() reports a switch teardown.
      const workBounds = { x: 10, y: 10, width: 1300, height: 860 };
      const hudBounds = { x: 50, y: 50, width: 900, height: 700 };
      seedLiveWindow('app://workspaces/work/a', workBounds);
      seedLiveWindow('app://workspaces/hud', hudBounds);

      // Replicates the macOS window-all-closed handler body, including the
      // teardown guard the fix added to index.ts (AST-verified by
      // shutdown-ordering.test.ts).
      const fireWindowAllClosedDarwin = () => {
        if (isBackendSwitchWindowTeardownInProgress()) return;
        const sessionsPath = getWindowSessionsPath();
        if (fs.existsSync(sessionsPath)) fs.unlinkSync(sessionsPath);
        clearWindowSessionsSnapshot();
      };

      // Switch A→B: the last destroy() inside captureAndClose fires the event.
      await captureAndCloseWindowsForBackendSwitch('local');
      expect(isBackendSwitchWindowTeardownInProgress()).toBe(true);
      fireWindowAllClosedDarwin();
      restoreWindowsForBackend('remote-1');
      expect(isBackendSwitchWindowTeardownInProgress()).toBe(false);

      // Switch B→A.
      await captureAndCloseWindowsForBackendSwitch('remote-1');
      fireWindowAllClosedDarwin();
      restoreWindowsForBackend('local');

      // Both of A's windows are back, including the HUD — the sessions file
      // was not deleted mid-switch.
      const live = FakeBrowserWindow.getAllWindows();
      const urls = live.map((w) => w.webContents.getURL());
      expect(urls.some((u) => new URL(u).pathname.startsWith('/hud'))).toBe(true);
      expect(urls.some((u) => new URL(u).pathname === '/work/a')).toBe(true);
      expect(live).toHaveLength(2);
    });

    it('a genuine last-window close after a completed switch still clears sessions as before', async () => {
      // The guard must be scoped to the switch teardown window only: once
      // restoreWindowsForBackend() has run, a real manual all-windows close
      // must clear the sessions file exactly as it did before the fix.
      seedLiveWindow('app://workspaces/hud', { x: 50, y: 50, width: 900, height: 700 });
      await captureAndCloseWindowsForBackendSwitch('local');
      restoreWindowsForBackend('remote-1');

      // User now manually closes the restored window (darwin handler runs).
      for (const w of FakeBrowserWindow.getAllWindows()) w.destroy();
      expect(isBackendSwitchWindowTeardownInProgress()).toBe(false);
      const sessionsPath = getWindowSessionsPath();
      expect(fs.existsSync(sessionsPath)).toBe(true);
      if (!isBackendSwitchWindowTeardownInProgress()) {
        fs.unlinkSync(sessionsPath);
        clearWindowSessionsSnapshot();
      }
      expect(fs.existsSync(sessionsPath)).toBe(false);
    });

    it('clearBackendSwitchWindowTeardownGuard clears a leaked guard and is idempotent', async () => {
      // The failure-path clear the switch orchestration runs in a finally: if a
      // step between capture (guard set) and restore (guard cleared) throws,
      // this call must release the guard — and calling it again (or after a
      // normal restore already cleared it) must be a harmless no-op.
      seedLiveWindow('app://workspaces/hud', { x: 50, y: 50, width: 900, height: 700 });
      await captureAndCloseWindowsForBackendSwitch('local');
      expect(isBackendSwitchWindowTeardownInProgress()).toBe(true);

      clearBackendSwitchWindowTeardownGuard();
      expect(isBackendSwitchWindowTeardownInProgress()).toBe(false);
      clearBackendSwitchWindowTeardownGuard();
      expect(isBackendSwitchWindowTeardownInProgress()).toBe(false);
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

    it('connects a pooled client for every non-active backend, never the active one', async () => {
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

      expect(connect).toHaveBeenCalledTimes(2);
      expect(connect).toHaveBeenCalledWith('local');
      expect(connect).toHaveBeenCalledWith('remote-2');
      expect(connect).not.toHaveBeenCalledWith('remote-1');
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
      expect(connect).not.toHaveBeenCalled();
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

  describe('capture + restore sequence (T3 switch)', () => {
    it('captures the outgoing backend then restores the incoming one', async () => {
      const localBounds = { x: 10, y: 10, width: 1300, height: 860 };
      const w1 = seedLiveWindow('app://workspaces/work/a', localBounds);

      // Incoming backend has a saved layout from a prior session.
      const remoteBounds = { x: 100, y: 100, width: 1024, height: 768 };
      fs.writeFileSync(
        getWindowSessionsPath(),
        JSON.stringify({ 'remote-1': [{ route: '/work/remote', bounds: remoteBounds }] }),
        'utf-8',
      );

      await captureAndCloseWindowsForBackendSwitch('local');
      // ...T3 swaps the client + flips activeId here...
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
