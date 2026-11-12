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

export type MachineRailSliceState = MachineRailState;

const initialState: MachineRailSliceState = {
  enabled: false,
  homeId: '',
  machineIds: [],
  selectedId: '',
  shownId: '',
  pendingId: '',
  degradedIds: [],
};

/** State from `machine-rail:get-state`, a request reply, or a `machine-rail:changed` push. */
export const machineRailStateReceived = createAction<[state: MachineRailState]>(
  'machineRail/stateReceived',
);

export const selectRailMachineRequested = createAction<[id: string]>('machineRail/selectRequested');
export const addRailMachineRequested = createAction<[id: string]>('machineRail/addRequested');
export const removeRailMachineRequested = createAction<[id: string]>('machineRail/removeRequested');
/** A new rail order (home first), from a drag or the keyboard. */
export const reorderRailMachinesRequested = createAction<[machineIds: string[]]>(
  'machineRail/reorderRequested',
);
export const setMachineRailEnabledRequested = createAction<[enabled: boolean]>(
  'machineRail/setEnabledRequested',
);

export const machineRailReducer = createReducer<MachineRailSliceState>(initialState);
machineRailReducer.with(machineRailStateReceived, (_state, { payload: [next] }) => ({
  enabled: next.enabled,
  homeId: next.homeId,
  machineIds: [...next.machineIds],
  selectedId: next.selectedId,
  shownId: next.shownId,
  pendingId: next.pendingId,
  degradedIds: [...next.degradedIds],
}));
