/**
 * Machine rail (Labs) — shared IPC contract (main ⇄ renderer).
 *
 * One window stays connected to several machines. Each machine has its own
 * renderer inside the window; the rail picks which one is shown. Main owns the
 * list and the selection, and every renderer of the window receives the same
 * state. Labels, accents, icons and connection status come from the
 * connections list (`shared/types/connections.ts`), keyed by the same ids.
 */

export const MACHINE_RAIL_CHANGED_EVENT = 'machine-rail:changed';

export const MACHINE_RAIL_TOAST_EVENT = 'machine-rail:toast';

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

/** The most machines one window keeps in its rail, the window's own included. */
const MACHINE_RAIL_MAX_MACHINES = 9;

/** `machine-rail:get-state` result and `machine-rail:changed` payload. */
export interface MachineRailState {
  /** The Labs setting. While off, a window shows only its own machine. */
  enabled: boolean;
  /** The machine the window itself is bound to. Always first; never removed. */
  homeId: string;
  /** Rail order: `homeId` first, then the machines added to this window. */
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

/** What a window session remembers about its rail (the home machine is implied). */
export interface MachineRailSession {
  machineIds: string[];
  selectedId: string;
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

/**
 * A new rail order: the same machines with home still first, or the current
 * order unchanged when `next` is not that.
 */
export function reorderRailMachines(
  machineIds: readonly string[],
  next: readonly string[],
): string[] {
  const same =
    next.length === machineIds.length &&
    new Set(next).size === next.length &&
    next.every((id) => machineIds.includes(id));
  return same && next[0] === machineIds[0] ? [...next] : [...machineIds];
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
 * State after removing `id`. The home machine stays; removing the selected
 * machine selects the home machine.
 */
export function removeRailMachine(
  state: Pick<MachineRailState, 'homeId' | 'machineIds' | 'selectedId'>,
  id: string,
): Pick<MachineRailState, 'machineIds' | 'selectedId'> {
  if (id === state.homeId) {
    return { machineIds: [...state.machineIds], selectedId: state.selectedId };
  }
  return {
    machineIds: state.machineIds.filter((machineId) => machineId !== id),
    selectedId: state.selectedId === id ? state.homeId : state.selectedId,
  };
}

/**
 * A saved rail made safe to restore: only machines that are still saved, no
 * duplicates, home first, capped, and a selection that is in the list.
 */
export function normalizeRailSession(
  homeId: string,
  session: unknown,
  isSavedMachine: (id: string) => boolean,
): Pick<MachineRailState, 'machineIds' | 'selectedId'> {
  const raw = (session ?? {}) as { machineIds?: unknown; selectedId?: unknown };
  const machineIds = [homeId];
  if (Array.isArray(raw.machineIds)) {
    for (const id of raw.machineIds) {
      if (machineIds.length >= MACHINE_RAIL_MAX_MACHINES) break;
      if (typeof id !== 'string' || machineIds.includes(id) || !isSavedMachine(id)) continue;
      machineIds.push(id);
    }
  }
  const selectedId =
    typeof raw.selectedId === 'string' && machineIds.includes(raw.selectedId)
      ? raw.selectedId
      : homeId;
  return { machineIds, selectedId };
}
