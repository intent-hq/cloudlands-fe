/** Web/mock bridge for the legacy `window:open-new` renderer channel. */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';

// ── window:open-new (cmd-click "open in new window" affordances) ──
// SidebarNav / NewWorkspaceCard fall back to in-window navigation from their
// `.catch`, and openWorkspaceInNewWindow folds both a `{ success:false }`
// envelope and a rejection into `goto(route)`. The legacy Electron
// BrowserWindow spawner is gone, so this handler opens the route as a new
// browser window/tab when the environment allows it and otherwise THROWS — a
// resolved failure would strand the `.catch`-only callers on a silent no-op
// (same "a throw is the honest terminal state" idiom as the
// settings-legacy-bridge feature-codes gate). Registered at import time so
// the affordance works from the very first render.
registerMockIpcHandler('window:open-new', async (arg) => {
  const rawRoute = (arg as { route?: unknown } | undefined)?.route;
  const rawRequestId = (arg as { requestId?: unknown } | undefined)?.requestId;
  const route = typeof rawRoute === 'string' && rawRoute.startsWith('/') ? rawRoute : '/';
  const requestId =
    typeof rawRequestId === 'string' && rawRequestId.length > 0 ? rawRequestId : undefined;
  const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (bridge && typeof bridge.invoke === 'function') {
    const response = (await bridge.invoke('window:open-new', {
      route,
      ...(requestId ? { requestId } : {}),
    })) as { success?: boolean; error?: string } | undefined;
    if (!response?.success) {
      throw new Error(response?.error || 'Opening a new window is not available in this build');
    }
    return response;
  }
  const target = route.startsWith('/hud') ? 'intent-hud' : '_blank';
  const opened =
    typeof window !== 'undefined' ? window.open(`${window.location.origin}${route}`, target) : null;
  if (!opened) {
    throw new Error('Opening a new window is not available in this build');
  }
  opened.opener = null;
  return { success: true };
});
