/**
 * Bridge call for the cycle-open-windows action key.
 *
 * Kept out of action-key-registry.ts on purpose: the registry is imported by
 * Svelte components (labels/icons for the settings panel), and the
 * intent/no-component-async-data-fetch lint rule treats any directly imported
 * module whose source references the IPC bridge as an async wrapper — which
 * would flag the components' registry reads. Isolating the invoke here keeps
 * the registry bridge-free.
 */
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';

export interface WindowCycleResult {
  cycled: boolean;
  windowCount: number;
}

/**
 * Invoke the main-process window-cycle IPC (`window:cycle-focus`). Resolves
 * undefined without a bridge (browser dev build).
 */
export function cycleOpenWindows(): Promise<WindowCycleResult | undefined> {
  return invoke<WindowCycleResult | undefined>(IPC_CHANNELS.WINDOW.CYCLE_FOCUS);
}
