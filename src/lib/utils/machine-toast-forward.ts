import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  MACHINE_HIDDEN_ATTRIBUTE,
  type MachineRailForwardToastParams,
  type MachineRailToastKind,
} from '$shared/types/machine-rail';

/**
 * Machine rail: false in a renderer whose machine is not the one its window
 * shows. Its current workspace is then not in front of the user.
 */
export function isMachineShown(): boolean {
  if (typeof document === 'undefined') return true;
  return !document.documentElement.hasAttribute(MACHINE_HIDDEN_ATTRIBUTE);
}

/**
 * Machine rail: a window can host one renderer per machine and shows
 * one at a time. A toast raised in a renderer that is not shown would never be
 * seen, so it is also handed to the main process, which shows it in the
 * visible machine's renderer. Does nothing in a shown renderer or outside the
 * desktop app.
 */
export function forwardToastWhenHidden(kind: MachineRailToastKind, message: string): void {
  if (typeof window === 'undefined' || isMachineShown()) return;
  const text = message.trim();
  if (!text) return;
  const params: MachineRailForwardToastParams = { kind, message: text.slice(0, 2000) };
  void window.electronAPI?.invoke(IPC_CHANNELS.MACHINE_RAIL.FORWARD_TOAST, params)?.catch(() => {});
}
