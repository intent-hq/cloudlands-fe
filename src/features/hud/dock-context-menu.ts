import { WINDOW_CHANNELS } from '$shared/ipc/channels';

interface DockMenuBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Right-click on the dock: ask main for its native menu (move, hide). Main owns
 * the dock window, so this talks to the preload bridge directly; without one
 * (web build, component tests) it does nothing.
 */
export function showDockContextMenu(): void {
  const bridge = (globalThis as { electronAPI?: DockMenuBridge }).electronAPI;
  void bridge?.invoke(WINDOW_CHANNELS.SHOW_DOCK_MENU, {}).catch(() => {});
}
