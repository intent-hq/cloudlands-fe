import { store } from "../../store";

export const selectDeepLinks = store.createSelector((state) => {
  return state.deepLinks;
});

export const selectHomePageInitializerRequest = store.createSelector((state) => {
  return selectDeepLinks.select(state).homePageInitializerRequest;
});

export const selectHasHomePageInitializerRequest = store.createSelector((state) => {
  return selectHomePageInitializerRequest.select(state) !== null;
});

export const selectPendingDeepLinkAction = store.createSelector((state) => {
  return selectDeepLinks.select(state).pendingAction;
});

export const selectDeepLinkProcessing = store.createSelector((state) => {
  return selectDeepLinks.select(state).processing;
});

export const selectDeepLinkError = store.createSelector((state) => {
  return selectDeepLinks.select(state).error;
});