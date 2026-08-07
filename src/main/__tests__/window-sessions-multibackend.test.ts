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
    destroyed = false;
    bounds: { x: number; y: number; width: number; height: number };
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
    on() {
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

vi.mock('../../features/auto-update/main/auto-update.ipc', () => ({
  updateAutoUpdaterWindow: vi.fn(),
}));

import {
  _resetWindowSessionsCacheForTests,
  captureAndCloseWindowsForBackendSwitch,
  getWindowSessionsPath,
  loadWindowSessions,
  restoreWindowsForBackend,
  saveWindowSessions,
  type WindowSession,
} from '../window';

function seedLiveWindow(
  url: string,
  bounds = { x: 0, y: 0, width: 1200, height: 800 },
): FakeBrowserWindow {
  const w = new FakeBrowserWindow(bounds);
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
    _resetWindowSessionsCacheForTests();
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
      seedLiveWindow('app://workspaces/work/remote', remoteBounds);
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
      seedLiveWindow('app://workspaces/work/r', remoteBounds);
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

    it('no-arg save/load default to the local backend', async () => {
      const bounds = { x: 7, y: 8, width: 1280, height: 820 };
      seedLiveWindow('app://workspaces/work/default', bounds);
      await saveWindowSessions();
      expect(readMap()).toEqual({ local: [{ route: '/work/default', bounds }] });
      expect(loadWindowSessions()).toEqual([{ route: '/work/default', bounds }]);
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
      seedLiveWindow('app://workspaces/work/remote', remoteBounds);
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
