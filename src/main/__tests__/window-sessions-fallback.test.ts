/**
 * Regression guard for the non-macOS window-all-closed session-persistence bug.
 *
 * Context: when `window-all-closed` fires on Windows/Linux, every
 * BrowserWindow has already been destroyed and `BrowserWindow.getAllWindows()`
 * returns an empty array. Before this fix, `saveWindowSessions()` serialized
 * the (empty) live-window list and silently wrote nothing, so the sessions
 * file from the previous launch was left stale and the just-closed layout
 * was lost on next start.
 *
 * The fix keeps an in-memory snapshot of the most recent non-empty session
 * list (updated on every successful save and explicitly via
 * `captureWindowSessionsSnapshot()` on window close) and writes that snapshot
 * as a fallback when the live list is empty.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAllWindows = vi.fn();
const mockGetPath = vi.fn();

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => mockGetPath(name),
    dock: undefined,
  },
  BrowserWindow: {
    getAllWindows: () => mockGetAllWindows(),
  },
  screen: { getPrimaryDisplay: vi.fn() },
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

import {
  _resetWindowSessionsCacheForTests,
  captureWindowSessionsSnapshot,
  clearWindowSessionsSnapshot,
  getWindowSessionsPath,
  saveWindowSessions,
} from '../window';

interface FakeWindow {
  isDestroyed: () => boolean;
  webContents: { getURL: () => string };
  getBounds: () => { x: number; y: number; width: number; height: number };
}

function makeWindow(
  url: string,
  bounds: { x: number; y: number; width: number; height: number } = {
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
  },
): FakeWindow {
  return {
    isDestroyed: () => false,
    webContents: { getURL: () => url },
    getBounds: () => bounds,
  };
}

describe('saveWindowSessions — empty getAllWindows() fallback', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-sessions-test-'));
    mockGetPath.mockReset();
    mockGetPath.mockReturnValue(tmpDir);
    mockGetAllWindows.mockReset();
    _resetWindowSessionsCacheForTests();
  });

  it('persists the last-known snapshot when getAllWindows() returns empty', async () => {
    // First save while a window still exists populates the in-memory cache.
    const bounds = { x: 10, y: 20, width: 1400, height: 900 };
    mockGetAllWindows.mockReturnValue([makeWindow('app://workspaces/work/abc', bounds)]);
    await saveWindowSessions('local');

    const sessionsPath = getWindowSessionsPath();
    expect(fs.existsSync(sessionsPath)).toBe(true);
    const firstSave = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
    // Sessions are persisted as a backend-keyed map, keyed by the passed id.
    expect(firstSave).toEqual({ local: [{ route: '/work/abc', bounds }] });

    // Delete the file to prove the fallback write actually happens.
    fs.unlinkSync(sessionsPath);

    // Simulate window-all-closed on non-macOS: no live windows remain.
    mockGetAllWindows.mockReturnValue([]);
    await saveWindowSessions('local');

    expect(fs.existsSync(sessionsPath)).toBe(true);
    const fallbackSave = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
    expect(fallbackSave).toEqual(firstSave);
  });

  it('captureWindowSessionsSnapshot() primes the cache so a later empty-windows save still persists', async () => {
    const bounds = { x: 100, y: 200, width: 1000, height: 700 };
    mockGetAllWindows.mockReturnValue([makeWindow('app://workspaces/work/snap', bounds)]);
    captureWindowSessionsSnapshot();

    // All windows are gone by the time saveWindowSessions() runs (non-macOS
    // window-all-closed); the pre-close snapshot must still be written.
    mockGetAllWindows.mockReturnValue([]);
    await saveWindowSessions('local');

    const saved = JSON.parse(fs.readFileSync(getWindowSessionsPath(), 'utf-8'));
    expect(saved).toEqual({ local: [{ route: '/work/snap', bounds }] });
  });

  it('does not write a sessions file when there is no snapshot and no live windows', async () => {
    mockGetAllWindows.mockReturnValue([]);
    await saveWindowSessions('local');
    expect(fs.existsSync(getWindowSessionsPath())).toBe(false);
  });

  it('clearWindowSessionsSnapshot() prevents the fallback from resurrecting a deleted sessions file', async () => {
    // Simulate the macOS manual all-windows-closed path:
    //   1. A window is live and its layout is captured into the in-memory cache.
    //   2. The sessions file is intentionally deleted (window-all-closed on darwin).
    //   3. clearWindowSessionsSnapshot() wipes the in-memory cache.
    //   4. A later saveWindowSessions() trigger (e.g. a pending debounced saver)
    //      must NOT recreate window-sessions.json from the stale snapshot.
    const bounds = { x: 50, y: 60, width: 1200, height: 800 };
    mockGetAllWindows.mockReturnValue([makeWindow('app://workspaces/work/mac', bounds)]);
    captureWindowSessionsSnapshot();

    const sessionsPath = getWindowSessionsPath();
    // Prime on-disk file so we can observe the intentional deletion.
    fs.writeFileSync(sessionsPath, JSON.stringify([{ route: '/work/mac', bounds }]), 'utf-8');
    fs.unlinkSync(sessionsPath);
    clearWindowSessionsSnapshot();

    mockGetAllWindows.mockReturnValue([]);
    await saveWindowSessions('local');

    expect(fs.existsSync(sessionsPath)).toBe(false);
  });
});
