import { app, BrowserWindow, screen } from 'electron';
import { getBackendIdForWindow } from '../../../main/window-backend';
import { showRailMachine } from '../../../main/machine-rail-state';
import { isHudWindow } from '../../../main/hud-window';
import { isDevConsoleRoute } from '../../../shared/dev-console-route';
import { isDesktopOverlayRoute } from '../../../shared/desktop-overlay';

interface OwningIdentity {
  backendId: string;
  workspaceId: string;
}

/** The owning backend's workspace window, else any ordinary window of that backend. */
function findDesktopOwningWindow(identity: OwningIdentity): BrowserWindow | undefined {
  const windows = BrowserWindow.getAllWindows().filter((window) => {
    if (window.isDestroyed() || isHudWindow(window) || window.webContents.isLoadingMainFrame())
      return false;
    if (getBackendIdForWindow(window) !== identity.backendId) return false;
    try {
      const { pathname, protocol } = new URL(window.webContents.getURL());
      return (
        (protocol === 'app:' || protocol === 'http:') &&
        !isDevConsoleRoute(pathname) &&
        !isDesktopOverlayRoute(pathname)
      );
    } catch {
      return false;
    }
  });
  return (
    windows.find(
      (window) =>
        new URL(window.webContents.getURL()).pathname ===
        `/workspace/${encodeURIComponent(identity.workspaceId)}`,
    ) ?? windows[0]
  );
}

/** Identity comes from the native session, never a renderer-provided URL. */
export async function openDesktopControllingAgent(identity: {
  backendId: string;
  workspaceId: string;
  agentId: string;
}): Promise<void> {
  const route = `/desktop-control-agent?${new URLSearchParams({
    workspaceId: identity.workspaceId,
    agentId: identity.agentId,
  })}`;
  const target = findDesktopOwningWindow(identity);
  if (target) {
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
    target.webContents.send('navigate', route);
    return;
  }
  // No window of its own: a window that keeps the machine in its rail shows
  // it. A renderer that did not start in time could drop the route, so the
  // agent then opens in a window of its own.
  const rail = showRailMachine(identity.backendId);
  if (rail) {
    if (rail.window.isMinimized()) rail.window.restore();
    rail.window.show();
    rail.window.focus();
    if ((await rail.ready) && !rail.contents.isDestroyed()) {
      rail.contents.send('navigate', route);
      return;
    }
  }
  const { createWindowForSession } = await import('../../../main/window');
  await createWindowForSession(
    { route, bounds: screen.getPrimaryDisplay().workArea },
    false,
    identity.backendId,
  );
}

/**
 * Bring the window that owns a finished desktop session back to the front
 * without navigating it; a window that keeps the owning machine in its rail
 * switches to it. Never opens a window. Returns whether one was raised.
 */
export function focusDesktopOwningWindow(
  identity: OwningIdentity,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const target = findDesktopOwningWindow(identity) ?? showRailMachine(identity.backendId)?.window;
  if (!target) return false;
  if (target.isMinimized()) target.restore();
  // Another app is frontmost after desktop control; a plain focus() only
  // reorders Intent's own windows on macOS.
  if (platform === 'darwin') app.focus({ steal: true });
  target.show();
  target.focus();
  return true;
}
