import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

export type StoreUtilityState = {
  updatesLocked: boolean;
};

const initialState: StoreUtilityState = {
  updatesLocked: false,
};

export const lockUpdates = createAction("storeUtility/lockUpdates");
export const unlockUpdates = createAction("storeUtility/unlockUpdates");

export const storeUtilityReducer = createReducer<StoreUtilityState>(initialState)
  .with(lockUpdates, (state) => ({
    ...state,
    updatesLocked: true,
  }))
  .with(unlockUpdates, (state) => ({
    ...state,
    updatesLocked: false,
  }));

