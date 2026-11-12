import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  MACHINE_HIDDEN_ATTRIBUTE,
  type MachineRailForwardToastParams,
  type MachineRailToastKind,
} from '$shared/types/machine-rail';

/**
 * Machine rail (Labs): a window can host one renderer per machine and shows
 * one at a time. A toast raised in a renderer that is not shown would never be
 * seen, so it is also handed to the main process, which shows it in the
 * visible machine's renderer. Does nothing in a shown renderer or outside the
 * desktop app.
 */
export function forwardToastWhenHidden(kind: MachineRailToastKind, message: string): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (!document.documentElement.hasAttribute(MACHINE_HIDDEN_ATTRIBUTE)) return;
  const text = message.trim();
  if (!text) return;
  const params: MachineRailForwardToastParams = { kind, message: text.slice(0, 2000) };
  void window.electronAPI?.invoke(IPC_CHANNELS.MACHINE_RAIL.FORWARD_TOAST, params)?.catch(() => {});
}
