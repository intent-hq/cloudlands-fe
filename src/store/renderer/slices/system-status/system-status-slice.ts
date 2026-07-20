import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";

export type SystemStatusState = {
  nodeVersionOk: boolean | null;
  nodeVersion: string | undefined;
  auggieInstalled: boolean;
  binaryInstallAvailable: boolean;
};

export const initialState: SystemStatusState = {
  nodeVersionOk: null,
  nodeVersion: undefined,
  auggieInstalled: false,
  binaryInstallAvailable: false,
};

export const setSystemStatus = createAction<[status: SystemStatusState]>(
  "systemStatus/setSystemStatus"
);

export const systemStatusReducer = createReducer<SystemStatusState>(initialState).with(
  setSystemStatus,
  (state, { payload: [status] }) => ({
    ...state,
    ...status,
  })
);