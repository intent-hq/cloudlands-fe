import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ windows: [] as any[], create: vi.fn() }));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => mocks.windows },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
}));
vi.mock('../../../main/window-backend', () => ({
  getBackendIdForWindow: (window: any) => window.backend,
}));
vi.mock('../../../main/hud-window', () => ({
  isHudWindow: (window: any) => window.url.includes('/hud'),
}));
vi.mock('../../../main/window', () => ({ createWindowForSession: mocks.create }));
import { openDesktopControllingAgent } from './desktop-overlay-navigation';

function window(backend: string, path: string) {
  return {
    backend,
    url: `app://workspaces${path}`,
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      getURL: () => `app://workspaces${path}`,
      isLoadingMainFrame: () => false,
      send: vi.fn(),
    },
  };
}
const identity = { backendId: 'remote-a', workspaceId: 'space/#a', agentId: 'agent&a' };
beforeEach(() => {
  mocks.windows.length = 0;
  mocks.create.mockReset();
});
it('targets the owning backend/workspace and excludes overlay and diagnostic windows', async () => {
  const wrongBackend = window('remote-b', '/workspace/space%2F%23a');
  const overlay = window('remote-a', '/desktop-overlay?kind=controls');
  const hud = window('remote-a', '/hud');
  const console = window('remote-a', '/dev-console');
  const other = window('remote-a', '/workspace/other');
  const target = window('remote-a', '/workspace/space%2F%23a');
  mocks.windows.push(wrongBackend, overlay, hud, console, other, target);
  await openDesktopControllingAgent(identity);
  expect(target.restore).toHaveBeenCalledOnce();
  expect(target.focus).toHaveBeenCalledOnce();
  const [event, route] = target.webContents.send.mock.calls[0];
  expect(event).toBe('navigate');
  const parsed = new URL(route, 'https://example.test');
  expect(parsed.pathname).toBe('/desktop-control-agent');
  expect(parsed.searchParams.get('workspaceId')).toBe(identity.workspaceId);
  expect(parsed.searchParams.get('agentId')).toBe(identity.agentId);
  expect(
    mocks.windows.filter((w) => w !== target).every((w) => w.focus.mock.calls.length === 0),
  ).toBe(true);
});
it('opens a correctly bound window with the exact navigation target when only overlays survive', async () => {
  mocks.windows.push(
    window('remote-a', '/desktop-overlay?kind=controls'),
    window('remote-b', '/workspace/other'),
  );
  await openDesktopControllingAgent(identity);
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      route: '/desktop-control-agent?workspaceId=space%2F%23a&agentId=agent%26a',
    }),
    false,
    'remote-a',
  );
});
it('does not lose navigation to an uninitialized or loading renderer', async () => {
  const blank = window('remote-a', '/');
  blank.webContents.getURL = () => 'about:blank';
  const loading = window('remote-a', '/workspace/space%2F%23a');
  loading.webContents.isLoadingMainFrame = () => true;
  mocks.windows.push(blank, loading);
  await openDesktopControllingAgent(identity);
  expect(blank.webContents.send).not.toHaveBeenCalled();
  expect(loading.webContents.send).not.toHaveBeenCalled();
  expect(mocks.create).toHaveBeenCalledOnce();
});
