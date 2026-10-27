import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';

export const selectAnnotationEvent = store.createSelector((state) => ({
  lastEvent: state.annotation.lastEvent,
  eventRevision: state.annotation.eventRevision,
}));

export const selectAnnotationDraft = store.createSelector((state) => ({
  ...state.annotation.draft,
  frames: getItems(state.annotation.draft.frames),
}));

export const selectAnnotationDeliveryPending = store.createSelector(
  (state) => state.annotation.deliveryPending,
);

export const selectAnnotationRecipients = store.createSelector((state) =>
  getItems(state.annotation.recipients),
);

export const selectAnnotationWorkspaces = store.createSelector((state) =>
  getItems(state.annotation.workspaces),
);

export const selectAnnotationUncertainMessageId = store.createSelector(
  (state) => state.annotation.uncertainMessageId,
);

export const selectAnnotationSubmission = store.createSelector((state) => {
  const submission = state.annotation.submission;
  return submission ? { ...submission, frames: getItems(submission.frames) } : null;
});
