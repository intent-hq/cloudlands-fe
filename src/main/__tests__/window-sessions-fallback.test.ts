/**
 * Regression guard for the non-macOS window-all-closed session-persistence bug.
 *
 * Context: when `window-all-closed` fires on Windows/Linux, every
 * BrowserWindow has already been destroyed and `BrowserWindow.getAllWindows()`
 * returns an empty array. A save that only serialized the live windows would
 * write nothing, so the just-closed layout would be lost on next start.
 *
 * The saver keeps the most recent non-empty list of frames (updated on every
 * save and via `captureWindowSessionsSnapshot()` on window close) and writes
 * it when no window is live.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  registerWindowTitleListener: vi.fn(),
}));

import {
  _resetWindowSessionsCacheForTests,
  captureWindowSessionsSnapshot,
  clearWindowSessionsSnapshot,
  discardSavedWindowFrames,
  getWindowFramesPath,
  saveAllWindowSessions,
} from '../window';

interface FakeWindow {
  isDestroyed: () => boolean;
  isFullScreen: () => boolean;
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
    isFullScreen: () => false,
    webContents: { getURL: () => url },
    getBounds: () => bounds,
  };
}

describe('saveAllWindowSessions — empty getAllWindows() fallback', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-sessions-test-'));
    mockGetPath.mockReset();
    mockGetPath.mockReturnValue(tmpDir);
    mockGetAllWindows.mockReset();
    _resetWindowSessionsCacheForTests();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const frame = (
    route: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => ({
    bounds,
    machines: [{ id: 'local', route }],
    selectedId: 'local',
  });
  const readFrames = () => JSON.parse(fs.readFileSync(getWindowFramesPath(), 'utf-8')).frames;

  it('persists the last-known frames when getAllWindows() returns empty', async () => {
    const bounds = { x: 10, y: 20, width: 1400, height: 900 };
    mockGetAllWindows.mockReturnValue([makeWindow('app://workspaces/work/abc', bounds)]);
    await saveAllWindowSessions();
    expect(readFrames()).toEqual([frame('/work/abc', bounds)]);

    // Delete the file to prove the fallback write actually happens.
    fs.unlinkSync(getWindowFramesPath());

    // Simulate window-all-closed on non-macOS: no live windows remain.
    mockGetAllWindows.mockReturnValue([]);
    await saveAllWindowSessions();

    expect(readFrames()).toEqual([frame('/work/abc', bounds)]);
  });

  it('captureWindowSessionsSnapshot() primes the cache so a later empty-windows save still persists', async () => {
    const bounds = { x: 100, y: 200, width: 1000, height: 700 };
    const window = makeWindow('app://workspaces/work/snap', bounds);
    mockGetAllWindows.mockReturnValue([window]);
    captureWindowSessionsSnapshot.call(window as never);

    mockGetAllWindows.mockReturnValue([]);
    await saveAllWindowSessions();

    expect(readFrames()).toEqual([frame('/work/snap', bounds)]);
  });

  it('does not write a frames file when there is no snapshot and no live windows', async () => {
    mockGetAllWindows.mockReturnValue([]);
    await saveAllWindowSessions();
    expect(fs.existsSync(getWindowFramesPath())).toBe(false);
  });

  it('clearWindowSessionsSnapshot() keeps a later save from writing the cached frames', async () => {
    const bounds = { x: 50, y: 60, width: 1200, height: 800 };
    mockGetAllWindows.mockReturnValue([makeWindow('app://workspaces/work/mac', bounds)]);
    captureWindowSessionsSnapshot();
    clearWindowSessionsSnapshot();

    mockGetAllWindows.mockReturnValue([]);
    await saveAllWindowSessions();

    expect(fs.existsSync(getWindowFramesPath())).toBe(false);
  });

  it('a discarded layout stays empty when a pending save runs after it', async () => {
    const bounds = { x: 50, y: 60, width: 1200, height: 800 };
    mockGetAllWindows.mockReturnValue([makeWindow('app://workspaces/work/mac', bounds)]);
    await saveAllWindowSessions();

    // macOS: the user closed every window.
    mockGetAllWindows.mockReturnValue([]);
    discardSavedWindowFrames();
    await saveAllWindowSessions();

    expect(readFrames()).toEqual([]);
  });
});
