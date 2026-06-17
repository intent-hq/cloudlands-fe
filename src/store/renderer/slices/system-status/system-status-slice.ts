import { createAction } from "@augmentcode/ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";

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