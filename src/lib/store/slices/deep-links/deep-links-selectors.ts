import { createSelector } from "../../utils/create-selector";

export const selectDeepLinks = createSelector((state) => {
  return state.deepLinks;
});

export const selectHomePageInitializerRequest = createSelector((state) => {
  return selectDeepLinks.select(state).homePageInitializerRequest;
});

export const selectHasHomePageInitializerRequest = createSelector((state) => {
  return selectHomePageInitializerRequest.select(state) !== null;
});

export const selectPendingDeepLinkAction = createSelector((state) => {
  return selectDeepLinks.select(state).pendingAction;
});

export const selectDeepLinkProcessing = createSelector((state) => {
  return selectDeepLinks.select(state).processing;
});

export const selectDeepLinkError = createSelector((state) => {
  return selectDeepLinks.select(state).error;
});