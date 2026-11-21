import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => {}),
  getFocusedWindow: vi.fn(() => null as unknown),
  openSignInWindow: vi.fn(),
  viewed: new Map<unknown, string | undefined>(),
  frames: [] as unknown[],
}));

vi.mock('electron', () => ({
  shell: { openExternal: mocks.openExternal },
  BrowserWindow: { getFocusedWindow: mocks.getFocusedWindow },
}));
vi.mock('../features/browser/main/sign-in-window', () => ({
  openSignInWindow: mocks.openSignInWindow,
}));
vi.mock('../features/system/main/system.ipc', () => ({
  getViewedWorkspaceId: (window: unknown) => mocks.viewed.get(window),
}));
vi.mock('./frames', () => ({
  framesByRecentFocus: () => mocks.frames,
  isFrame: (window: unknown) => mocks.frames.includes(window),
}));
vi.mock('./window-backend', () => ({
  getShownRendererWebContents: (window: { contents: unknown }) => window.contents,
}));

import { openExternal, openWebUrlFromOs } from './open-external';

function frame(workspaceId: string | undefined) {
  const window = {
    contents: { send: vi.fn() },
    isMinimized: () => false,
    restore: vi.fn(),
    focus: vi.fn(),
  };
  mocks.viewed.set(window, workspaceId);
  mocks.frames.push(window);
  return window;
}

describe('openExternal', () => {
  beforeEach(() => {
    mocks.frames.length = 0;
    mocks.viewed.clear();
    mocks.getFocusedWindow.mockReturnValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('hands every URL to the OS without INTENT_NO_SYSTEM_BROWSER', async () => {
    const window = frame('ws-1');
    await openExternal('https://example.com/');
    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com/');
    expect(window.contents.send).not.toHaveBeenCalled();
  });

  it('keeps web links in Intent on Intent OS (INTENT_OS=1 implies INTENT_NO_SYSTEM_BROWSER)', async () => {
    vi.stubEnv('INTENT_OS', '1');
    const window = frame('ws-1');
    mocks.getFocusedWindow.mockReturnValue(window);
    await openExternal('https://example.com/os');
    expect(window.contents.send).toHaveBeenCalledWith('browser:open-link', {
      workspaceId: 'ws-1',
      url: 'https://example.com/os',
    });
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  describe('with INTENT_NO_SYSTEM_BROWSER=1', () => {
    beforeEach(() => vi.stubEnv('INTENT_NO_SYSTEM_BROWSER', '1'));

    it('opens a web URL in a browser panel of the focused window workspace', async () => {
      const recent = frame('ws-recent');
      const focused = frame('ws-focused');
      mocks.getFocusedWindow.mockReturnValue(focused);
      await openExternal('https://example.com/a');
      expect(focused.contents.send).toHaveBeenCalledWith('browser:open-link', {
        workspaceId: 'ws-focused',
        url: 'https://example.com/a',
      });
      expect(focused.focus).toHaveBeenCalled();
      expect(recent.contents.send).not.toHaveBeenCalled();
      expect(mocks.openExternal).not.toHaveBeenCalled();
    });

    it('uses the most recent window that shows a workspace', async () => {
      const home = frame(undefined);
      const root = frame('__root__');
      const older = frame('ws-older');
      mocks.getFocusedWindow.mockReturnValue(home);
      await openExternal('http://localhost:3000/');
      expect(home.contents.send).not.toHaveBeenCalled();
      expect(root.contents.send).not.toHaveBeenCalled();
      expect(older.contents.send).toHaveBeenCalledWith('browser:open-link', {
        workspaceId: 'ws-older',
        url: 'http://localhost:3000/',
      });
    });

    it('falls back to the sign-in window when no window shows a workspace', async () => {
      frame(undefined);
      await openExternal('https://example.com/');
      expect(mocks.openSignInWindow).toHaveBeenCalledWith('https://example.com/');
      expect(mocks.openExternal).not.toHaveBeenCalled();
    });

    it('falls back to the sign-in window when the window cannot take the link', async () => {
      const window = frame('ws-1');
      window.contents.send.mockImplementation(() => {
        throw new Error('Render frame was disposed');
      });
      await openExternal('https://example.com/');
      expect(mocks.openSignInWindow).toHaveBeenCalledWith('https://example.com/');
    });

    it('keeps non-web URLs on the OS handler', async () => {
      frame('ws-1');
      await openExternal('mailto:someone@example.com');
      expect(mocks.openExternal).toHaveBeenCalledWith('mailto:someone@example.com');
      expect(mocks.openSignInWindow).not.toHaveBeenCalled();
    });

    it('routes an OS-sent page (--open-url) to the workspace panel', async () => {
      const window = frame('ws-1');
      await openWebUrlFromOs('https://example.com/login');
      expect(window.contents.send).toHaveBeenCalledWith('browser:open-link', {
        workspaceId: 'ws-1',
        url: 'https://example.com/login',
      });
      expect(mocks.openSignInWindow).not.toHaveBeenCalled();
    });
  });

  it('opens an OS-sent page in the sign-in window without INTENT_NO_SYSTEM_BROWSER', async () => {
    const window = frame('ws-1');
    await openWebUrlFromOs('https://example.com/login');
    expect(mocks.openSignInWindow).toHaveBeenCalledWith('https://example.com/login');
    expect(window.contents.send).not.toHaveBeenCalled();
  });
});
