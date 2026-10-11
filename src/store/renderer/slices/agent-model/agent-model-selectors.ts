import { store } from '../../store';
import * as projections from './agent-model-projections';
export const selectAgentModelMutations = store.createSelector(projections.getAgentModelMutations);
export const selectAgentModelMutationPending = store.createSelector(
  projections.getAgentModelMutationPending,
);
export const selectAgentModelWriteSnapshot = store.createSelector(
  projections.getAgentModelWriteSnapshot,
);
