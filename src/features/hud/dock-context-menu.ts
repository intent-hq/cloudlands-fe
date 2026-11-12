import type { DockContextMenuRequest, DockContextMenuResult } from '$shared/dock-context-menu';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';

interface DockMenuBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Right-click on the dock: ask main for its native menu (move, hide). Main owns
 * the dock window, so this talks to the preload bridge directly; without one
 * (web build, component tests) it does nothing.
 */
export async function showDockContextMenu(
  state: DockContextMenuRequest = {},
): Promise<DockContextMenuResult> {
  const bridge = (globalThis as { electronAPI?: DockMenuBridge }).electronAPI;
  try {
    // Svelte props may be reactive proxies; Electron requires cloneable plain data.
    const request: DockContextMenuRequest = {
      machines: state.machines?.map(({ id, label }) => ({ id, label })),
      currentId: state.currentId,
      pending: state.pending,
      error: state.error,
    };
    const result = await bridge?.invoke(WINDOW_CHANNELS.SHOW_DOCK_MENU, request);
    if (result && typeof result === 'object' && 'shown' in result)
      return result as DockContextMenuResult;
  } catch {
    /* Releasing the caller's hold also covers IPC failure. */
  }
  return { shown: false };
}

/**
 * Double-click on the dock header: ask main to bring Intent forward as it was,
 * like a click on the app icon, without navigating it. Without a bridge it does
 * nothing.
 */
export function activateIntentFromDock(): void {
  const bridge = (globalThis as { electronAPI?: DockMenuBridge }).electronAPI;
  void bridge?.invoke(WINDOW_CHANNELS.ACTIVATE_APP, {}).catch(() => {});
}
