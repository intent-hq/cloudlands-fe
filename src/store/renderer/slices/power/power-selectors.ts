import { store } from '../../store';

export const selectOnBattery = store.createSelector((state): boolean => {
  return state.power?.onBattery ?? false;
});

/** Whether motion should be reduced right now: on battery AND the preference is on. */
export const selectReduceMotionActive = store.createSelector((state): boolean => {
  return (
    (state.power?.onBattery ?? false) && (state.userPreferences?.reduceMotionOnBattery ?? true)
  );
});
