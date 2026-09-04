import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';

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

export const systemStatusReducer = createReducer<SystemStatusState>(initialState);
