import { app, BrowserWindow, screen } from 'electron';
import { isFrame, rendererFor, shownMachine } from '../../../main/frames';
import { showRailMachine } from '../../../main/machine-rail-state';
import { isDevConsoleRoute } from '../../../shared/dev-console-route';
import { isDesktopOverlayRoute } from '../../../shared/desktop-overlay';

interface OwningIdentity {
  backendId: string;
  workspaceId: string;
}

interface OwningRenderer {
  window: BrowserWindow;
  contents: Electron.WebContents;
}

/**
 * The owning backend's workspace view in a frame that shows that backend,
 * else any such frame's view of it.
 */
function findDesktopOwningWindow(identity: OwningIdentity): OwningRenderer | undefined {
  const renderers = BrowserWindow.getAllWindows().flatMap((window): OwningRenderer[] => {
    if (!isFrame(window) || shownMachine(window) !== identity.backendId) return [];
    const contents = rendererFor(window, identity.backendId);
    if (!contents || contents.isDestroyed() || contents.isLoadingMainFrame()) return [];
    try {
      const { pathname, protocol } = new URL(contents.getURL());
      const page =
        (protocol === 'app:' || protocol === 'http:') &&
        !isDevConsoleRoute(pathname) &&
        !isDesktopOverlayRoute(pathname);
      return page ? [{ window, contents }] : [];
    } catch {
      return [];
    }
  });
  return (
    renderers.find(
      ({ contents }) =>
        new URL(contents.getURL()).pathname ===
        `/workspace/${encodeURIComponent(identity.workspaceId)}`,
    ) ?? renderers[0]
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
    if (target.window.isMinimized()) target.window.restore();
    target.window.show();
    target.window.focus();
    target.contents.send('navigate', route);
    return;
  }
  // No frame shows the machine: a frame that holds it shows it. A renderer that did not start in time could drop the route, so the
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
  const target =
    findDesktopOwningWindow(identity)?.window ?? showRailMachine(identity.backendId)?.window;
  if (!target) return false;
  if (target.isMinimized()) target.restore();
  // Another app is frontmost after desktop control; a plain focus() only
  // reorders Intent's own windows on macOS.
  if (platform === 'darwin') app.focus({ steal: true });
  target.show();
  target.focus();
  return true;
}
