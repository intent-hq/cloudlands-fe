/**
 * Machine rail — shared IPC contract (main ⇄ renderer).
 *
 * One window stays connected to several machines. Each machine has its own
 * renderer inside the window; the rail picks which one is shown. Main owns the
 * list and the selection, and every renderer of the window receives the same
 * state. Labels, accents, icons and connection status come from the
 * connections list (`shared/types/connections.ts`), keyed by the same ids.
 */

import type { TabWindowRecord } from './tab-window';

export const MACHINE_RAIL_CHANGED_EVENT = 'machine-rail:changed';

export const MACHINE_RAIL_TOAST_EVENT = 'machine-rail:toast';

/**
 * The shell backdrop a machine's renderer paints under it while the rail is
 * on: `machine-rail:backdrop` params, and (for the machine a frame shows)
 * the frame page's `machine-rail:get-backdrop` result and
 * `machine-rail:backdrop-changed` payload, `null` while there is none.
 * Resolved CSS colours, so the frame page needs no theme of its own.
 */
export interface MachineRailBackdrop {
  /** The shell surface under the page (translucent, or opaque without shell transparency). */
  background: string;
  /** The machine's accent tint over it; `transparent` when it has none. */
  tint: string;
  /** Switch the tint without a cross-fade (reduced motion). */
  reducedMotion: boolean;
}

/** Root attribute of a renderer whose machine is not the one the window shows. */
export const MACHINE_HIDDEN_ATTRIBUTE = 'data-machine-hidden';

export type MachineRailToastKind = 'success' | 'info' | 'warning' | 'error';

/** `machine-rail:forward-toast` params: a toast raised by a machine that is not shown. */
export interface MachineRailForwardToastParams {
  kind: MachineRailToastKind;
  message: string;
}

/** `machine-rail:toast` payload, delivered to the renderer the window shows. */
export interface MachineRailToastEvent extends MachineRailForwardToastParams {
  /** The machine that raised the toast. */
  machineId: string;
}

/** The most machines one window (frame) holds. */
export const MACHINE_RAIL_MAX_MACHINES = 9;

/** `machine-rail:get-state` result and `machine-rail:changed` payload. */
export interface MachineRailState {
  /** The Machine rail setting (Settings › Appearance). While off, a window holds and shows one machine. */
  enabled: boolean;
  /** The machines this window holds, in rail order. Never empty while the window is open. */
  machineIds: string[];
  /** The machine whose renderer the window shows. */
  selectedId: string;
  /**
   * The machine whose renderer is on screen. It trails `selectedId` until the
   * selected renderer has painted, so the previous one stays up until then.
   */
  shownId: string;
  /** A machine the user asked to show whose renderer is still starting; `''` when none. */
  pendingId: string;
  /** Machines in the rail whose daemon reports degraded health. */
  degradedIds: string[];
}

/** `machine-rail:health` params: a renderer reports its own machine's health. */
export interface MachineRailHealthParams {
  degraded: boolean;
}

/** What a window remembers about its rail: the machines in rail order and the one it showed. */
export interface MachineRailSession {
  machineIds: string[];
  selectedId: string;
}

/** One machine a saved frame holds, with the page its renderer showed. */
export interface FrameMachineSession {
  id: string;
  /** App route (path, starts with `/`); missing → the machine's default page. */
  route?: string;
}

/** A saved frame (app window): where it was, its machines in order, and the one it showed. */
export interface FrameSession {
  bounds: { x: number; y: number; width: number; height: number };
  isFullScreen?: boolean;
  /** Never empty. */
  machines: FrameMachineSession[];
  selectedId: string;
  /** A tab window: one machine on its tab window page, showing this tab. */
  tabWindow?: TabWindowRecord;
}

/** On-disk shape of window-frames.json. */
export interface WindowFramesFile {
  version: 1;
  frames: FrameSession[];
}

/**
 * Rail order after adding `id`: unchanged when it is already listed or the
 * rail is full.
 */
export function addRailMachine(machineIds: readonly string[], id: string): string[] {
  if (machineIds.includes(id) || machineIds.length >= MACHINE_RAIL_MAX_MACHINES) {
    return [...machineIds];
  }
  return [...machineIds, id];
}

/** A new rail order: the same machines, or the current order unchanged when `next` is not that. */
export function reorderRailMachines(
  machineIds: readonly string[],
  next: readonly string[],
): string[] {
  const same =
    next.length === machineIds.length &&
    new Set(next).size === next.length &&
    next.every((id) => machineIds.includes(id));
  return same ? [...next] : [...machineIds];
}

/**
 * The machine after `selectedId` in rail order, looping back to the start and
 * skipping those `skip` names (guest hosts); `null` when there is none other.
 */
export function nextRailMachine(
  machineIds: readonly string[],
  selectedId: string,
  skip: (id: string) => boolean,
): string | null {
  const start = machineIds.indexOf(selectedId);
  for (let step = 1; step < machineIds.length; step++) {
    const id = machineIds[(start + step + machineIds.length) % machineIds.length];
    if (id !== selectedId && !skip(id)) return id;
  }
  return null;
}

/**
 * State after removing `id`. Removing the selected machine selects the one
 * after it, else the one before it. Removing the last machine leaves an empty
 * list and no selection: the window then closes.
 */
export function removeRailMachine(
  state: Pick<MachineRailState, 'machineIds' | 'selectedId'>,
  id: string,
): Pick<MachineRailState, 'machineIds' | 'selectedId'> {
  const index = state.machineIds.indexOf(id);
  if (index < 0) return { machineIds: [...state.machineIds], selectedId: state.selectedId };
  const machineIds = state.machineIds.filter((machineId) => machineId !== id);
  if (state.selectedId !== id) return { machineIds, selectedId: state.selectedId };
  return { machineIds, selectedId: machineIds[Math.min(index, machineIds.length - 1)] ?? '' };
}
