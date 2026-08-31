import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  getAllWindows: vi.fn((): unknown[] => []),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
}));

import {
  _resetHudWindowRefForTests,
  findExistingHudWindow,
  focusHudWindow,
  isHudWindow,
  isTrackedHudWindow,
  registerHudWindow,
} from '../hud-window';
import type { BrowserWindow } from 'electron';

interface MockWindow {
  backendId?: string;
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  restore: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  webContents: { isDestroyed: () => boolean; getURL: () => string };
  _closedHandlers: Array<() => void>;
  _destroy: () => void;
}

function makeWindow(
  opts: { url?: string; destroyed?: boolean; minimized?: boolean; backendId?: string } = {},
) {
  let destroyed = opts.destroyed ?? false;
  let minimized = opts.minimized ?? false;
  const win: MockWindow = {
    backendId: opts.backendId,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    restore: vi.fn(() => {
      minimized = false;
    }),
    focus: vi.fn(),
    show: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'closed') win._closedHandlers.push(cb);
    }),
    webContents: {
      isDestroyed: () => false,
      getURL: () => opts.url ?? '',
    },
    _closedHandlers: [],
    _destroy: () => {
      destroyed = true;
      win._closedHandlers.forEach((cb) => cb());
    },
  };
  return win;
}

const asBw = (w: MockWindow) => w as unknown as BrowserWindow;

beforeEach(() => {
  vi.clearAllMocks();
  electronMocks.getAllWindows.mockReturnValue([]);
  _resetHudWindowRefForTests();
});

describe('isHudWindow', () => {
  it('matches the /hud route in dev (http) and production (app) URLs', () => {
    expect(isHudWindow(asBw(makeWindow({ url: 'http://127.0.0.1:5190/hud' })))).toBe(true);
    expect(isHudWindow(asBw(makeWindow({ url: 'app://workspaces/hud' })))).toBe(true);
  });

  it('rejects non-HUD, destroyed, unloaded, and unparsable windows', () => {
    expect(isHudWindow(asBw(makeWindow({ url: 'http://127.0.0.1:5190/workspace/x' })))).toBe(false);
    expect(isHudWindow(asBw(makeWindow({ url: 'app://workspaces/hud', destroyed: true })))).toBe(
      false,
    );
    expect(isHudWindow(asBw(makeWindow({ url: '' })))).toBe(false);
    expect(isHudWindow(asBw(makeWindow({ url: 'not a url' })))).toBe(false);
  });
});

describe('registerHudWindow / findExistingHudWindow (per-backend)', () => {
  it('returns the tracked window even while its URL is still about:blank (mid-navigation)', () => {
    const hud = makeWindow({ url: 'about:blank', backendId: 'remote-a' });
    registerHudWindow(asBw(hud));
    expect(findExistingHudWindow('remote-a')).toBe(hud);
    expect(electronMocks.getAllWindows).not.toHaveBeenCalled();
  });

  it('keys the registry off the backend stamp: one HUD per backend coexists', () => {
    const localHud = makeWindow({ url: 'about:blank', backendId: 'local' });
    const remoteHud = makeWindow({ url: 'about:blank', backendId: 'remote-a' });
    registerHudWindow(asBw(localHud));
    registerHudWindow(asBw(remoteHud));
    expect(findExistingHudWindow('local')).toBe(localHud);
    expect(findExistingHudWindow('remote-a')).toBe(remoteHud);
  });

  it('an unstamped registered window buckets to the local backend', () => {
    const hud = makeWindow({ url: 'about:blank' });
    registerHudWindow(asBw(hud));
    expect(findExistingHudWindow('local')).toBe(hud);
  });

  it('returns null for a backend with no HUD even when another backend has one', () => {
    const localHud = makeWindow({ url: 'app://workspaces/hud', backendId: 'local' });
    registerHudWindow(asBw(localHud));
    expect(findExistingHudWindow('remote-a')).toBeNull();
  });

  it('clears only the closed backend bucket when a window closes', () => {
    const localHud = makeWindow({ url: 'http://127.0.0.1:5190/hud', backendId: 'local' });
    const remoteHud = makeWindow({ url: 'app://workspaces/hud', backendId: 'remote-a' });
    registerHudWindow(asBw(localHud));
    registerHudWindow(asBw(remoteHud));
    localHud._destroy();
    expect(findExistingHudWindow('local')).toBeNull();
    expect(findExistingHudWindow('remote-a')).toBe(remoteHud);
  });

  it('falls back to a backend-filtered URL scan when the tracked reference is destroyed', () => {
    const dead = makeWindow({
      url: 'http://127.0.0.1:5190/hud',
      destroyed: true,
      backendId: 'remote-a',
    });
    registerHudWindow(asBw(dead));
    const untracked = makeWindow({ url: 'app://workspaces/hud', backendId: 'remote-a' });
    const otherBackendHud = makeWindow({ url: 'app://workspaces/hud', backendId: 'local' });
    const regular = makeWindow({ url: 'app://workspaces/workspace/x', backendId: 'remote-a' });
    electronMocks.getAllWindows.mockReturnValue([regular, otherBackendHud, untracked]);
    expect(findExistingHudWindow('remote-a')).toBe(untracked);
  });

  it('the URL scan never returns a HUD stamped with a different backend', () => {
    const otherBackendHud = makeWindow({ url: 'app://workspaces/hud', backendId: 'remote-b' });
    electronMocks.getAllWindows.mockReturnValue([otherBackendHud]);
    expect(findExistingHudWindow('remote-a')).toBeNull();
  });

  it('returns null when only non-HUD windows are live', () => {
    const regular = makeWindow({ url: 'http://127.0.0.1:5190/workspace/x', backendId: 'local' });
    electronMocks.getAllWindows.mockReturnValue([regular]);
    expect(findExistingHudWindow('local')).toBeNull();
  });
});

describe('isTrackedHudWindow', () => {
  it('matches registered HUDs from any backend, even on about:blank', () => {
    const localHud = makeWindow({ url: 'about:blank', backendId: 'local' });
    const remoteHud = makeWindow({ url: 'about:blank', backendId: 'remote-a' });
    registerHudWindow(asBw(localHud));
    registerHudWindow(asBw(remoteHud));
    expect(isTrackedHudWindow(asBw(localHud))).toBe(true);
    expect(isTrackedHudWindow(asBw(remoteHud))).toBe(true);
  });

  it('rejects unregistered and closed windows', () => {
    const unregistered = makeWindow({ url: 'app://workspaces/hud' });
    expect(isTrackedHudWindow(asBw(unregistered))).toBe(false);

    const hud = makeWindow({ url: 'app://workspaces/hud', backendId: 'local' });
    registerHudWindow(asBw(hud));
    hud._destroy();
    expect(isTrackedHudWindow(asBw(hud))).toBe(false);
  });
});

describe('focusHudWindow', () => {
  it('restores a minimized HUD before showing + focusing', () => {
    const hud = makeWindow({ url: 'app://workspaces/hud', minimized: true });
    focusHudWindow(asBw(hud));
    expect(hud.restore).toHaveBeenCalledTimes(1);
    expect(hud.show).toHaveBeenCalledTimes(1);
    expect(hud.focus).toHaveBeenCalledTimes(1);
  });

  it('skips restore when not minimized', () => {
    const hud = makeWindow({ url: 'app://workspaces/hud' });
    focusHudWindow(asBw(hud));
    expect(hud.restore).not.toHaveBeenCalled();
    expect(hud.show).toHaveBeenCalledTimes(1);
    expect(hud.focus).toHaveBeenCalledTimes(1);
  });
});
