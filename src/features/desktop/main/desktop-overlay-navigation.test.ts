import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  windows: [] as any[],
  create: vi.fn(),
  focus: vi.fn(),
  showRailMachine: vi.fn((): any => null),
}));
vi.mock('electron', () => ({
  app: { focus: mocks.focus },
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
vi.mock('../../../main/machine-rail-state', () => ({ showRailMachine: mocks.showRailMachine }));
import {
  focusDesktopOwningWindow,
  openDesktopControllingAgent,
} from './desktop-overlay-navigation';

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
  mocks.focus.mockReset();
  mocks.showRailMachine.mockReset().mockReturnValue(null);
});

/** A window that keeps the owning machine in its rail, as a hidden machine renderer. */
function railMachine(ready: Promise<void> = Promise.resolve()) {
  const rail = window('local', '/workspace/home');
  const contents = { isDestroyed: () => false, send: vi.fn() };
  mocks.windows.push(rail);
  mocks.showRailMachine.mockImplementation((backendId: string) =>
    backendId === identity.backendId ? { window: rail, contents, ready } : null,
  );
  return { rail, contents };
}
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

it('refocuses the owning workspace window without navigating, stealing focus on macOS', () => {
  const other = window('remote-a', '/workspace/other');
  const target = window('remote-a', '/workspace/space%2F%23a');
  mocks.windows.push(window('remote-b', '/workspace/space%2F%23a'), other, target);
  expect(focusDesktopOwningWindow(identity, 'darwin')).toBe(true);
  expect(target.restore).toHaveBeenCalledOnce();
  expect(mocks.focus).toHaveBeenCalledWith({ steal: true });
  expect(target.show).toHaveBeenCalledOnce();
  expect(target.focus).toHaveBeenCalledOnce();
  expect(target.webContents.send).not.toHaveBeenCalled();
  expect(other.focus).not.toHaveBeenCalled();
});
it('refocuses without app-level focus stealing on Windows', () => {
  const target = window('remote-a', '/workspace/space%2F%23a');
  mocks.windows.push(target);
  expect(focusDesktopOwningWindow(identity, 'win32')).toBe(true);
  expect(mocks.focus).not.toHaveBeenCalled();
  expect(target.focus).toHaveBeenCalledOnce();
});
it('never opens a window to refocus when the owning backend has none', () => {
  mocks.windows.push(
    window('remote-b', '/workspace/space%2F%23a'),
    window('remote-a', '/desktop-overlay?kind=glow'),
  );
  expect(focusDesktopOwningWindow(identity, 'darwin')).toBe(false);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.focus).not.toHaveBeenCalled();
});

it('switches a rail to the owning machine and navigates it once ready, instead of opening a window', async () => {
  let markReady: () => void = () => {};
  const { rail, contents } = railMachine(new Promise<void>((resolve) => (markReady = resolve)));
  const opened = openDesktopControllingAgent(identity);
  await Promise.resolve();
  expect(mocks.showRailMachine).toHaveBeenCalledWith('remote-a');
  expect(rail.focus).toHaveBeenCalledOnce();
  expect(contents.send).not.toHaveBeenCalled();
  markReady();
  await opened;
  expect(contents.send).toHaveBeenCalledWith(
    'navigate',
    '/desktop-control-agent?workspaceId=space%2F%23a&agentId=agent%26a',
  );
  expect(rail.webContents.send).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
it('prefers a window of the owning machine over switching a rail', async () => {
  const { contents } = railMachine();
  const target = window('remote-a', '/workspace/space%2F%23a');
  mocks.windows.push(target);
  await openDesktopControllingAgent(identity);
  expect(target.webContents.send).toHaveBeenCalledOnce();
  expect(mocks.showRailMachine).not.toHaveBeenCalled();
  expect(contents.send).not.toHaveBeenCalled();
});
it('refocuses by switching a rail to the owning machine, without navigating', () => {
  const { rail, contents } = railMachine();
  expect(focusDesktopOwningWindow(identity, 'darwin')).toBe(true);
  expect(mocks.showRailMachine).toHaveBeenCalledWith('remote-a');
  expect(mocks.focus).toHaveBeenCalledWith({ steal: true });
  expect(rail.focus).toHaveBeenCalledOnce();
  expect(contents.send).not.toHaveBeenCalled();
});
