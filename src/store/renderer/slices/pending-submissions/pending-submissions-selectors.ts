import { store } from '../../store';
import * as projection from './pending-submissions-projections';
export const selectPendingSubmissionEntry = store.createSelector(
  projection.getPendingSubmissionEntry,
);
export const selectPendingSubmissionDisplay = store.createSelector(
  projection.getPendingSubmissionDisplay,
);
export const selectSubmissionIsCurrent = store.createSelector(projection.getSubmissionIsCurrent);
export const selectAgentSubmissionDisplay = store.createSelector(
  projection.getAgentSubmissionDisplay,
);
export const selectSubmissionObserved = store.createSelector(projection.getSubmissionObserved);
export const selectQueueMutationBlocked = store.createSelector(projection.getQueueMutationBlocked);
export const selectPendingSubmissionsState = store.createSelector(
  (state) => state.pendingSubmissions,
);
