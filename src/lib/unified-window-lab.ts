/**
 * Renderer view of the experimental Unified window Labs setting. Main owns and
 * persists it (it decides at launch whether to restore the Unified window); this
 * readable follows `window:unified-window-lab-changed` so every window agrees, and
 * writes through `window:set-unified-window-lab`. Same bridge pattern as the dock
 * lab; without a bridge (web build, tests) the lab stays off.
 */
import { readable } from 'svelte/store';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { m } from '$shared/paraglide/messages.js';
import { notify } from '$lib/components/patterns/notify';

interface LabIpcLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, handler: (...args: unknown[]) => void): string;
  offById(channel: string, listenerId: string): void;
}

function getBridge(): LabIpcLike | null {
  return (globalThis as { electronAPI?: LabIpcLike }).electronAPI ?? null;
}

function parseEnabled(payload: unknown): boolean | null {
  const enabled = (payload as { enabled?: unknown } | null | undefined)?.enabled;
  return typeof enabled === 'boolean' ? enabled : null;
}

export const unifiedWindowLabEnabled = readable(false, (set) => {
  const bridge = getBridge();
  if (!bridge) return;
  let active = true;
  let receivedChange = false;
  const listenerId = bridge.on(WINDOW_CHANNELS.UNIFIED_WINDOW_LAB_CHANGED, (payload) => {
    if (!active) return;
    const enabled = parseEnabled(payload);
    if (enabled !== null) {
      receivedChange = true;
      set(enabled);
    }
  });
  void bridge
    .invoke(WINDOW_CHANNELS.GET_UNIFIED_WINDOW_LAB, {})
    .then((response) => {
      const enabled = parseEnabled(response);
      if (active && !receivedChange && enabled !== null) set(enabled);
    })
    .catch(() => {});
  return () => {
    active = false;
    bridge.offById(WINDOW_CHANNELS.UNIFIED_WINDOW_LAB_CHANGED, listenerId);
  };
});

/** Asks main to change the setting; a rejected or mismatched save shows the shared error. */
export async function setUnifiedWindowLabEnabled(enabled: boolean): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return;
  try {
    const response = await bridge.invoke(WINDOW_CHANNELS.SET_UNIFIED_WINDOW_LAB, { enabled });
    if (parseEnabled(response) === enabled) return;
  } catch {
    // Fall through to the shared save error.
  }
  notify.error(m.settings_gitWorkspace_saveError());
}
