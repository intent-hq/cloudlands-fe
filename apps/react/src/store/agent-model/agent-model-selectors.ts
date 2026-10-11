import { store } from '../index';
import * as projections from '../../../../../src/store/renderer/slices/agent-model/agent-model-projections';
export const selectAgentModelMutations = store.createSelector(projections.getAgentModelMutations);
export const selectAgentModelMutationPending = store.createSelector(
  projections.getAgentModelMutationPending,
);
export const selectAgentModelWriteSnapshot = store.createSelector(
  projections.getAgentModelWriteSnapshot,
);
