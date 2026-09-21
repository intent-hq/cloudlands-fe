import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';

export type PowerState = {
  /** Whether the machine is currently running on battery (not charging / no AC). */
  onBattery: boolean;
};

export const initialState: PowerState = {
  onBattery: false,
};

export const setOnBattery = createAction<[onBattery: boolean]>('power/setOnBattery');

export const powerReducer = createReducer<PowerState>(initialState);
powerReducer.with(setOnBattery, (state, { payload: [onBattery] }) => {
  if (onBattery === state.onBattery) return state;
  return { ...state, onBattery };
});
