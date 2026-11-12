/**
 * Machine Rail Slice (Labs)
 *
 * A read-through view of the window's machine rail, which the main process
 * owns: the machines this window stays connected to and the one it shows. The
 * renderer dispatches intent (select, add, remove, turn the lab on or off);
 * the saga calls main, and main's reply or push is the only thing that changes
 * this state.
 */

import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { MachineRailState } from '$shared/types/machine-rail';

/** Main's rail state plus renderer-only UI requests. */
export type MachineRailSliceState = MachineRailState & {
  /** Counts requests to open this machine's status menu at its rail item. */
  menuRequests: number;
};

const initialState: MachineRailSliceState = {
  enabled: false,
  homeId: '',
  machineIds: [],
  selectedId: '',
  menuRequests: 0,
};

/** State from `machine-rail:get-state`, a request reply, or a `machine-rail:changed` push. */
export const machineRailStateReceived = createAction<[state: MachineRailState]>(
  'machineRail/stateReceived',
);

export const selectRailMachineRequested = createAction<[id: string]>('machineRail/selectRequested');
export const addRailMachineRequested = createAction<[id: string]>('machineRail/addRequested');
export const removeRailMachineRequested = createAction<[id: string]>('machineRail/removeRequested');
/** Ask main for a new rail order (the same machines, rearranged). */
export const reorderRailMachinesRequested = createAction<[machineIds: string[]]>(
  'machineRail/reorderRequested',
);
export const setMachineRailEnabledRequested = createAction<[enabled: boolean]>(
  'machineRail/setEnabledRequested',
);

/** Open the status menu of a rail machine (switching to it first when it is not shown). */
export const openRailMachineMenuRequested = createAction<[id: string]>(
  'machineRail/openMenuRequested',
);
/** This renderer was asked to open its own machine's status menu. */
export const railMachineMenuRequested = createAction('machineRail/menuRequested');

export const machineRailReducer = createReducer<MachineRailSliceState>(initialState);
machineRailReducer.with(railMachineMenuRequested, (state) => ({
  ...state,
  menuRequests: state.menuRequests + 1,
}));
machineRailReducer.with(machineRailStateReceived, (state, { payload: [next] }) => ({
  menuRequests: state.menuRequests,
  enabled: next.enabled,
  homeId: next.homeId,
  machineIds: [...next.machineIds],
  selectedId: next.selectedId,
}));
