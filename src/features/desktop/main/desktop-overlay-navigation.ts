import { BrowserWindow, screen } from 'electron';
import { getBackendIdForWindow } from '../../../main/window-backend';
import { isHudWindow } from '../../../main/hud-window';
import { isDevConsoleRoute } from '../../../shared/dev-console-route';
import { isDesktopOverlayRoute } from '../../../shared/desktop-overlay';

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
  const target =
    windows.find(
      (window) =>
        new URL(window.webContents.getURL()).pathname ===
        `/workspace/${encodeURIComponent(identity.workspaceId)}`,
    ) ?? windows[0];
  if (target) {
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
    target.webContents.send('navigate', route);
    return;
  }
  const { createWindowForSession } = await import('../../../main/window');
  await createWindowForSession(
    { route, bounds: screen.getPrimaryDisplay().workArea },
    false,
    identity.backendId,
  );
}
