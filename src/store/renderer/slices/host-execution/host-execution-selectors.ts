// Compatibility binding for Svelte consumers; remove at Svelte cutover.
import { store } from '../../store';
import * as projections from './host-execution-projections';
export const selectHostExecutionReadContext = store.createSelector(
  projections.getHostExecutionReadContext,
);
export const selectHostExecutionContext = store.createSelector(projections.getHostExecutionContext);
export const selectIsHostMember = store.createSelector(projections.getIsHostMember);
export const selectHostExecutionGeneration = store.createSelector(
  projections.getHostExecutionGeneration,
);
