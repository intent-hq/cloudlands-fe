import { store } from '@/store';
import * as projection from '../../../../../src/store/renderer/slices/pending-submissions/pending-submissions-projections';
export const selectPendingSubmissionEntry = store.createSelector(
  projection.getPendingSubmissionEntry,
);
export const selectSubmissionIsCurrent = store.createSelector(projection.getSubmissionIsCurrent);
export const selectSubmissionObserved = store.createSelector(projection.getSubmissionObserved);
export const selectQueueMutationBlocked = store.createSelector(projection.getQueueMutationBlocked);
export const selectAgentSubmissionDisplay = store.createSelector(
  projection.getAgentSubmissionDisplay,
);
export const selectAgentSubmissionEntry = store.createSelector(
  (state, agentId: string, workspaceId: string) => {
    const scope = state.pendingSubmissions.byAgentId[agentId]?.scope;
    return scope?.workspaceId === workspaceId
      ? projection.getPendingSubmissionEntry(state, scope)
      : undefined;
  },
);
