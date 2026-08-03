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
  registerHudWindow,
} from '../hud-window';
import type { BrowserWindow } from 'electron';

interface MockWindow {
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

function makeWindow(opts: { url?: string; destroyed?: boolean; minimized?: boolean } = {}) {
  let destroyed = opts.destroyed ?? false;
  let minimized = opts.minimized ?? false;
  const win: MockWindow = {
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

describe('registerHudWindow / findExistingHudWindow', () => {
  it('returns the tracked window even while its URL is still about:blank (mid-navigation)', () => {
    const hud = makeWindow({ url: 'about:blank' });
    registerHudWindow(asBw(hud));
    expect(findExistingHudWindow()).toBe(hud);
    expect(electronMocks.getAllWindows).not.toHaveBeenCalled();
  });

  it('clears the tracked reference when the window closes', () => {
    const hud = makeWindow({ url: 'http://127.0.0.1:5190/hud' });
    registerHudWindow(asBw(hud));
    hud._destroy();
    expect(findExistingHudWindow()).toBeNull();
  });

  it('falls back to a URL scan when the tracked reference is destroyed', () => {
    const dead = makeWindow({ url: 'http://127.0.0.1:5190/hud', destroyed: true });
    registerHudWindow(asBw(dead));
    const untracked = makeWindow({ url: 'app://workspaces/hud' });
    const regular = makeWindow({ url: 'app://workspaces/workspace/x' });
    electronMocks.getAllWindows.mockReturnValue([regular, untracked]);
    expect(findExistingHudWindow()).toBe(untracked);
  });

  it('returns null when only non-HUD windows are live', () => {
    const regular = makeWindow({ url: 'http://127.0.0.1:5190/workspace/x' });
    electronMocks.getAllWindows.mockReturnValue([regular]);
    expect(findExistingHudWindow()).toBeNull();
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
