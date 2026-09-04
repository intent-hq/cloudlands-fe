/**
 * Auto-update renderer broadcast tests.
 *
 * Auto-update events must reach EVERY live workspace window (not only a
 * tracked main-window ref), must skip destroyed windows/webContents, and
 * must never be delivered to the HUD pop-out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const electronMocks = vi.hoisted(() => ({
  getAllWindows: vi.fn((): unknown[] => []),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
}));

import type { BrowserWindow } from 'electron';
import { broadcastToRenderers } from '../main/auto-update-broadcast';
import { registerHudWindow, _resetHudWindowRefForTests } from '../../../main/hud-window';

interface MockWindow {
  isDestroyed: () => boolean;
  on: ReturnType<typeof vi.fn>;
  webContents: {
    isDestroyed: () => boolean;
    getURL: () => string;
    send: ReturnType<typeof vi.fn>;
  };
}

function makeWindow(
  opts: { url?: string; destroyed?: boolean; webContentsDestroyed?: boolean } = {},
): MockWindow {
  return {
    isDestroyed: () => opts.destroyed ?? false,
    on: vi.fn(),
    webContents: {
      isDestroyed: () => opts.webContentsDestroyed ?? false,
      getURL: () => opts.url ?? 'app://workspaces/workspace/x',
      send: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetHudWindowRefForTests();
  electronMocks.getAllWindows.mockReturnValue([]);
});

describe('broadcastToRenderers', () => {
  it('delivers the event to every live window', () => {
    const winA = makeWindow({ url: 'app://workspaces/workspace/a' });
    const winB = makeWindow({ url: 'http://127.0.0.1:5190/workspace/b' });
    const winC = makeWindow({ url: 'app://workspaces/settings' });
    electronMocks.getAllWindows.mockReturnValue([winA, winB, winC]);

    const state = { status: 'available' };
    broadcastToRenderers('auto-update:status-changed', state);

    for (const win of [winA, winB, winC]) {
      expect(win.webContents.send).toHaveBeenCalledTimes(1);
      expect(win.webContents.send).toHaveBeenCalledWith('auto-update:status-changed', state);
    }
  });

  it('supports data-less events (show-toast)', () => {
    const win = makeWindow();
    electronMocks.getAllWindows.mockReturnValue([win]);

    broadcastToRenderers('auto-update:show-toast');

    expect(win.webContents.send).toHaveBeenCalledWith('auto-update:show-toast');
  });

  it('skips destroyed windows and destroyed webContents but still reaches live ones', () => {
    const destroyedWin = makeWindow({ destroyed: true });
    const destroyedContents = makeWindow({ webContentsDestroyed: true });
    const live = makeWindow();
    electronMocks.getAllWindows.mockReturnValue([destroyedWin, destroyedContents, live]);

    broadcastToRenderers('auto-update:progress', { percent: 42 });

    expect(destroyedWin.webContents.send).not.toHaveBeenCalled();
    expect(destroyedContents.webContents.send).not.toHaveBeenCalled();
    expect(live.webContents.send).toHaveBeenCalledWith('auto-update:progress', { percent: 42 });
  });

  it('never delivers to the HUD window (dev and production URLs)', () => {
    const hudDev = makeWindow({ url: 'http://127.0.0.1:5190/hud' });
    const hudProd = makeWindow({ url: 'app://workspaces/hud' });
    const workspace = makeWindow();
    electronMocks.getAllWindows.mockReturnValue([hudDev, hudProd, workspace]);

    broadcastToRenderers('auto-update:show-toast');

    expect(hudDev.webContents.send).not.toHaveBeenCalled();
    expect(hudProd.webContents.send).not.toHaveBeenCalled();
    expect(workspace.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('never delivers to a registered HUD window still on about:blank', () => {
    // Race: the HUD creation path registers the window BEFORE its URL loads,
    // so the URL-based isHudWindow() check alone would miss it.
    const hud = makeWindow({ url: 'about:blank' });
    const workspace = makeWindow();
    registerHudWindow(hud as unknown as BrowserWindow);
    electronMocks.getAllWindows.mockReturnValue([hud, workspace]);

    broadcastToRenderers('auto-update:show-toast');

    expect(hud.webContents.send).not.toHaveBeenCalled();
    expect(workspace.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no windows exist', () => {
    electronMocks.getAllWindows.mockReturnValue([]);
    expect(() => broadcastToRenderers('auto-update:error', { message: 'x' })).not.toThrow();
  });
});

/**
 * Source guard: all main-process auto-update send sites must route through
 * broadcastToRenderers — a direct `webContents.send('auto-update:*')` would
 * reintroduce the single-window (or null-window silent drop) behavior.
 */
describe('auto-update send-site source guard', () => {
  const SRC_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');

  it.each(['features/auto-update/main/auto-update.service.ts', 'main/index.ts'])(
    '%s has no direct auto-update webContents.send site',
    async (relPath) => {
      const content = await fs.readFile(path.join(SRC_ROOT, relPath), 'utf8');
      expect(content).not.toMatch(/webContents\.send\(\s*['"]auto-update:/);
    },
  );
});
