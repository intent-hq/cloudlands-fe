/**
 * Usage Stats Selectors
 */

import { store } from "../../store";

export const selectStatsMode = store.createSelector((state) => state.stats.mode);

export const selectStatsPeriodKey = store.createSelector(
  (state) => state.stats.periodKey,
);

export const selectStatsLoading = store.createSelector(
  (state) => state.stats.loading,
);

export const selectStatsError = store.createSelector((state) => state.stats.error);

export const selectStatsData = store.createSelector((state) => state.stats.data);
