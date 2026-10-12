import { store } from '../index';
import { getShouldRequestAgentLineStats } from '../../../../../src/store/renderer/slices/changes/changes-projections';

export const selectShouldRequestAgentLineStats = store.createSelector(
  getShouldRequestAgentLineStats,
);
