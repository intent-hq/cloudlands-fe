// React binding of the canonical authority projections.
import { store } from '@/store';
import * as projections from '../../../../../src/store/renderer/slices/host-execution/host-execution-projections';
export const selectHostExecutionReadContext = store.createSelector(
  projections.getHostExecutionReadContext,
);
export const selectHostExecutionContext = store.createSelector(projections.getHostExecutionContext);
export const selectIsHostMember = store.createSelector(projections.getIsHostMember);
export const selectHostExecutionGeneration = store.createSelector(
  projections.getHostExecutionGeneration,
);
