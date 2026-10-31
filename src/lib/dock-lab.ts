/**
 * Renderer view of the experimental dock Labs setting. Main owns and persists
 * it; this store reads it through `window:get-dock-lab`, follows the
 * `window:dock-lab-changed` push so every window agrees, and writes through
 * `window:set-dock-lab`. Like console-owner-status, it talks to the preload
 * bridge directly because the state is main-process-owned and must not route
 * through the mock IPC router. Without a bridge (web build, tests) the lab
 * stays off.
 */
import { readable } from 'svelte/store';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { m } from '$shared/paraglide/messages.js';
import { notify } from '$lib/components/patterns/notify';

interface DockLabIpcLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, handler: (...args: unknown[]) => void): string;
  offById(channel: string, listenerId: string): void;
}

function getBridge(): DockLabIpcLike | null {
  return (globalThis as { electronAPI?: DockLabIpcLike }).electronAPI ?? null;
}

function parseEnabled(payload: unknown): boolean | null {
  const enabled = (payload as { enabled?: unknown } | null | undefined)?.enabled;
  return typeof enabled === 'boolean' ? enabled : null;
}

export const dockLabEnabled = readable(false, (set) => {
  const bridge = getBridge();
  if (!bridge) return;
  let active = true;
  let receivedChange = false;
  const listenerId = bridge.on(WINDOW_CHANNELS.DOCK_LAB_CHANGED, (payload) => {
    if (!active) return;
    const enabled = parseEnabled(payload);
    if (enabled !== null) {
      receivedChange = true;
      set(enabled);
    }
  });
  void bridge
    .invoke(WINDOW_CHANNELS.GET_DOCK_LAB, {})
    .then((response) => {
      const enabled = parseEnabled(response);
      if (active && !receivedChange && enabled !== null) set(enabled);
    })
    .catch(() => {});
  return () => {
    active = false;
    bridge.offById(WINDOW_CHANNELS.DOCK_LAB_CHANGED, listenerId);
  };
});

/** Asks main to change the setting; the change push updates every window. */
export async function setDockLabEnabled(enabled: boolean): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return;
  try {
    const response = await bridge.invoke(WINDOW_CHANNELS.SET_DOCK_LAB, { enabled });
    if (parseEnabled(response) !== enabled) notify.error(m.settings_gitWorkspace_saveError());
  } catch {
    notify.error(m.settings_gitWorkspace_saveError());
  }
}
